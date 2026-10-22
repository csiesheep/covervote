// worker/errors_selftest.mjs — BE 自己的檢查：issue #47（API 例外不再變成 Cloudflare 1101）。BE 所有。
//   node worker/errors_selftest.mjs     （還沒接進 npm run test:be：package.json 不在 #47 的範圍）
// import 時什麼都不跑（tests/acc_modules.js 會 import worker/ 底下每個檔）。
// 期望值從 issue #47 的文字抄：503、`{ error: 'unavailable' }`、JSON、`cache-control: no-store`、`retry-after: 30`、
// console.error 一行「固定字串＋例外類別與訊息」、不得含 IP／request body／段落或候選人資訊、POST 不得部分寫入後又回錯。
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export async function run(){
  const { handleApi } = await import('./api.mjs');
  const { memStore } = await import('./memstore.mjs');
  const { d1Store } = await import('./d1store.mjs');
  const { loadData } = await import('../tools/build_public.mjs');
  const data = loadData();
  const race = data.races.find(r => data.passages.some(p => p.race === r.id)).id;
  const p0 = data.passages.find(p => p.race === race);
  const name0 = data.candidates.find(c => c.id === p0.candidateId).name;
  const T = new Date('2026-11-10T12:00:00+08:00');
  const SITE = 'https://games.csiesheep.com/covervote/api/';
  const IP = '203.0.113.77';

  const reqs = {
    'POST guess': () => new Request(SITE + 'guess', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': IP },
      body: JSON.stringify({ race, class: 'ABC234', guesses: [{ passage: p0.id, name: name0 }] }) }),
    'POST play': () => new Request(SITE + 'play', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': IP },
      body: JSON.stringify({ race, verdict: 'same', class: 'ABC234' }) }),
    'GET stats': () => new Request(SITE + 'stats/' + race, { headers: { 'cf-connecting-ip': IP } }),
    'GET health': () => new Request(SITE + 'health/' + race, { headers: { 'cf-connecting-ip': IP } }),
    'GET class': () => new Request(SITE + 'class/ABC234/' + race, { headers: { 'cf-connecting-ip': IP } }),
  };
  // 例外訊息故意夾帶 IP、段落 id、候選人 id 與姓名：log 要留下類別與訊息，但這些要被遮掉。
  const NASTY = `D1_ERROR: boom ${IP} ${p0.id} ${p0.candidateId} ${name0} 2001:db8::7`;
  class D1Error extends Error { constructor(m){ super(m); this.name = 'D1Error'; } }
  // memStore 包一層：指定的方法丟錯，其他照常；writes 記下實際寫進去的鍵。
  const broken = which => {
    const s = memStore();
    const w = { ...s };
    for (const m of which) w[m] = async () => { throw new D1Error(NASTY); };
    return { store: w, inner: s };
  };

  const out = [];
  const t = async (name, fn) => { try { const r = await fn(); out.push([r === true ? 'PASS' : 'FAIL', name, r === true ? '' : r]); } catch (e){ out.push(['FAIL', name, '丟出例外（就是 1101）：' + e.name + ': ' + e.message]); } };
  const capture = async fn => {
    const printed = { error: [], other: [] };
    const orig = {}; for (const m of ['log', 'info', 'warn', 'error', 'debug']){ orig[m] = console[m]; console[m] = (...a) => printed[m === 'error' ? 'error' : 'other'].push(a.map(String).join(' ')); }
    try { return { r: await fn(), printed }; } finally { Object.assign(console, orig); }
  };
  const check503 = async (r) => {
    if (!(r instanceof Response)) return `回的不是 Response：${r}`;
    if (r.status !== 503) return `status ${r.status}（應 503）`;
    const ct = r.headers.get('content-type') || '', cc = r.headers.get('cache-control'), ra = r.headers.get('retry-after');
    if (!ct.startsWith('application/json')) return `content-type ${ct}`;
    if (cc !== 'no-store') return `cache-control ${cc}`;
    if (ra !== '30') return `retry-after ${ra}`;
    const body = await r.text();
    if (body !== JSON.stringify({ error: 'unavailable' })) return `body ${body}（應 {"error":"unavailable"}，不帶任何例外內容）`;
    return true;
  };
  const checkLog = printed => {
    if (printed.error.length !== 1) return `console.error 應一行，印了 ${printed.error.length} 行：${JSON.stringify(printed.error)}`;
    const line = printed.error[0];
    if (!line.includes('D1Error')) return `log 沒有例外類別：${line}`;
    if (!line.includes('boom')) return `log 沒有例外訊息：${line}`;
    for (const bad of [IP, '2001:db8::7', p0.id, p0.candidateId, name0]) if (line.includes(bad)) return `log 含 ${bad}：${line}`;
    return true;
  };

  // ---- 每個端點 × 每種壞法 → 503 JSON，不是丟出 ----
  const modes = { 'get／getMany 丟錯': ['get', 'getMany'], 'incr／incrMany 丟錯': ['incr', 'incrMany'] };
  for (const [mode, which] of Object.entries(modes)){
    for (const [ep, mk] of Object.entries(reqs)){
      const reads = ep.startsWith('GET');
      if (reads !== mode.startsWith('get')) continue;   // GET 只讀、POST 只寫：各自壞在會碰到的方法上
      await t(`${ep}：store ${mode} → 503 JSON（no-store、retry-after 30、body 不帶例外）、log 一行且遮掉 IP／段落／候選人`, async () => {
        const { store, inner } = broken(which);
        const { r, printed } = await capture(() => handleApi(mk(), { store, now: T, data }));
        const a = await check503(r); if (a !== true) return a;
        const b = checkLog(printed); if (b !== true) return b;
        return inner.keys().length === 0 || `壞掉的 store 還是寫進了：${inner.keys().join(',')}`;
      });
    }
  }

  // ---- 不壞時照常，log 一行都沒有（503 的路徑不能吃掉正常回應）----
  await t('store 正常 → 五個端點照常（POST 204、GET 200），console.error 0 行', async () => {
    const s = memStore(); const got = [];
    const { printed } = await capture(async () => { for (const [ep, mk] of Object.entries(reqs)) got.push(ep + ' ' + (await handleApi(mk(), { store: s, now: T, data })).status); });
    if (got.join() !== ['POST guess 204', 'POST play 204', 'GET stats 200', 'GET health 200', 'GET class 200'].join()) return got.join('、');
    return printed.error.length === 0 || `印了 ${printed.error.join(' | ')}`;
  });
  await t('不是 /covervote/api/ 的路徑照舊回 null（交給靜態檔），壞掉的 store 也不碰', async () => {
    const { store } = broken(['get', 'getMany', 'incr', 'incrMany']);
    const r = await handleApi(new Request('https://games.csiesheep.com/covervote/index.html'), { store, now: T, data });
    return r === null || `回了 ${r?.status}`;
  });
  await t('4xx 照舊（壞 store 時 405／415／404 不變成 503）', async () => {
    const { store } = broken(['get', 'getMany', 'incr', 'incrMany']);
    const got = [(await handleApi(new Request(SITE + 'play'), { store, now: T, data })).status,
      (await handleApi(new Request(SITE + 'play', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' }), { store, now: T, data })).status,
      (await handleApi(new Request(SITE + 'stats/nope'), { store, now: T, data })).status];
    return got.join() === '405,415,404' || got.join('/');
  });

  // ---- POST 不得部分寫入後又回錯 ----
  await t('D1：一次 POST 的所有計數走同一個 db.batch（一個交易）；batch 丟錯 → 503，沒有任何單獨的寫入', async () => {
    let batches = 0, runs = 0, batchSizes = [];
    const stmt = { bind(){ return this; }, async run(){ runs++; }, async first(){ return null; }, async all(){ return { results: [] }; } };
    const ok = { prepare: () => ({ ...stmt }), batch: async xs => { batches++; batchSizes.push(xs.length); return []; } };
    const r1 = await handleApi(reqs['POST guess'](), { store: d1Store(ok), now: T, data });
    if (r1.status !== 204 || batches !== 1 || runs !== 0) return `正常時應 204、1 個 batch、0 個單獨 run；實際 ${r1.status}、${batches}、${runs}`;
    if (batchSizes[0] < 3) return `探針母體不足：guess 帶班級應至少寫 3 個鍵，batch 只有 ${batchSizes[0]} 個`;
    const bad = { prepare: () => ({ ...stmt }), batch: async () => { throw new D1Error('D1_ERROR: batch failed'); } };
    batches = 0; runs = 0;
    const { r, printed } = await capture(() => handleApi(reqs['POST play'](), { store: d1Store(bad), now: T, data }));
    const a = await check503(r); if (a !== true) return a;
    if (printed.error.length !== 1) return `log ${printed.error.length} 行`;
    return runs === 0 || `batch 失敗後還有 ${runs} 個單獨的寫入`;
  });
  await t('沒有 incrMany 的 store（只有 incr）→ 503、一個鍵都不寫（不退回逐鍵寫，那會寫一半）', async () => {
    const s = memStore(); let n = 0;
    const half = { get: s.get, getMany: s.getMany, async incr(k, v){ if (++n > 1) throw new D1Error('second write failed'); return s.incr(k, v); } };
    const { r } = await capture(() => handleApi(reqs['POST play'](), { store: half, now: T, data }));
    const a = await check503(r); if (a !== true) return a;
    return s.keys().length === 0 || `寫了一半：${s.keys().join(',')}`;
  });

  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])){
  const out = await run();
  for (const [s, n, m] of out) console.log(`${s}  ${n}${m ? '\n      ' + m : ''}`);
  const fail = out.filter(x => x[0] === 'FAIL').length;
  console.log(JSON.stringify({ pass: out.length - fail, fail }));
  process.exit(fail ? 1 : 0);
}
