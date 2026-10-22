// worker/api_selftest.mjs — BE 自己的檢查：tests/acc_api.mjs 沒涵蓋的 #4 規則（防濫用、快取、fail closed）。BE 所有。
//   node worker/api_selftest.mjs     （npm run test:be）
// import 時什麼都不跑（tests/acc_modules.js 會 import worker/ 底下每個檔）。
// 期望值從 issue #4 的文字抄：8 KB、該選區段落數、405、no-store；不從 api.mjs 讀。
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export async function run(){
  const { handleApi } = await import('./api.mjs');
  const { memStore } = await import('./memstore.mjs');
  const { loadData } = await import('../tools/build_public.mjs');
  const data = loadData();
  const race = data.races[0].id;
  const ps = data.passages.filter(p => p.race === race);
  const nameOf = Object.fromEntries(data.candidates.map(c => [c.id, c.name]));
  const BASE = 'https://games.csiesheep.com/covervote/api/';
  const T = new Date('2026-11-10T12:00:00+08:00');
  const call = (store, method, p, body, opt = {}) => handleApi(new Request(BASE + p, method === 'GET' || method === 'DELETE' ? { method } :
    { method, body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    { store, now: opt.now || T, data: opt.data || data });
  const health = async s => (await (await call(s, 'GET', 'health/' + race)).json()).passages;
  const out = [];
  const t = async (name, fn) => { try { const r = await fn(); out.push([r === true ? 'PASS' : 'FAIL', name, r === true ? '' : r]); } catch (e){ out.push(['FAIL', name, e.message]); } };

  await t('body 超過 8 KB → 413，而且不計', async () => {
    const s = memStore();
    const pad = 'x'.repeat(8 * 1024);
    const r = await call(s, 'POST', 'guess', { race, guesses: [{ passage: ps[0].id, name: nameOf[ps[0].candidateId] }], pad });
    if (r.status !== 413) return `status ${r.status}`;
    return s.keys().length === 0 || `存了 ${s.keys().join(',')}`;
  });
  await t('body 剛好 8 KB 以內 → 204', async () => {
    const s = memStore();
    const base = JSON.stringify({ race, verdict: 'same', pad: '' });
    const body = JSON.stringify({ race, verdict: 'same', pad: 'x'.repeat(8 * 1024 - base.length) });
    if (new TextEncoder().encode(body).length !== 8192) return `探針自己算錯：${body.length}`;
    const r = await call(s, 'POST', 'play', body);
    return r.status === 204 || `status ${r.status}`;
  });
  await t('一次 guess 的筆數 > 該選區段落數 → 400，而且不計', async () => {
    const s = memStore();
    const guesses = [...ps, ps[0]].map(p => ({ passage: p.id, name: nameOf[p.candidateId] }));
    const r = await call(s, 'POST', 'guess', { race, guesses });
    if (r.status !== 400) return `${guesses.length} 筆（段落 ${ps.length}）status ${r.status}`;
    return s.keys().length === 0 || `存了 ${s.keys().join(',')}`;
  });
  await t('筆數 = 段落數 → 204', async () => {
    const r = await call(memStore(), 'POST', 'guess', { race, guesses: ps.map(p => ({ passage: p.id, name: nameOf[p.candidateId] })) });
    return r.status === 204 || `status ${r.status}`;
  });
  await t('同一個請求裡同一段只算一次', async () => {
    const s = memStore(), [a] = ps;
    const n = Math.min(ps.length, 2);
    await call(s, 'POST', 'guess', { race, guesses: Array.from({ length: n }, () => ({ passage: a.id, name: nameOf[a.candidateId] })) });
    const h = (await health(s)).find(x => x.id === a.id);
    return h.answers === 1 || `answers ${h.answers}`;
  });
  await t('method 不對 → 405', async () => {
    const s = memStore();
    const got = [(await call(s, 'GET', 'guess')).status, (await call(s, 'GET', 'play')).status,
      (await call(s, 'POST', 'stats/' + race, {})).status, (await call(s, 'DELETE', 'health/' + race)).status];
    return got.every(x => x === 405) || `GET guess/GET play/POST stats/DELETE health → ${got.join('/')}`;
  });
  await t('不認得的選區：POST 400、GET 404；不認得的端點 404', async () => {
    const s = memStore();
    const got = [(await call(s, 'POST', 'play', { race: 'nope', verdict: 'same' })).status, (await call(s, 'GET', 'stats/nope')).status,
      (await call(s, 'GET', 'health/nope')).status, (await call(s, 'GET', 'whatever')).status];
    return got.join() === '400,404,404,404' || got.join('/');
  });
  await t('壞 verdict、壞 JSON → 400，不計', async () => {
    const s = memStore();
    const got = [(await call(s, 'POST', 'play', { race, verdict: 'maybe' })).status, (await call(s, 'POST', 'play', '{oops')).status];
    if (got.join() !== '400,400') return got.join('/');
    return s.keys().length === 0 || `存了 ${s.keys().join(',')}`;
  });
  await t('GET 回應 cache-control: no-store（快取會讓禁止期前的 verdicts 活過 11/18 00:00）', async () => {
    const s = memStore();
    const hs = [(await call(s, 'GET', 'stats/' + race)).headers.get('cache-control'), (await call(s, 'GET', 'health/' + race)).headers.get('cache-control')];
    return hs.every(h => h === 'no-store') || hs.join(' / ');
  });
  await t('選舉沒有 pollBlackoutFrom → 當作禁止期（fail closed）', async () => {
    const s = memStore();
    for (let i = 0; i < 60; i++) await call(s, 'POST', 'play', { race, verdict: 'same' });
    const broken = { ...data, elections: data.elections.map(e => ({ ...e, pollBlackoutFrom: undefined })) };
    const st = await (await call(s, 'GET', 'stats/' + race, null, { data: broken })).json();
    return (st.blackout === true && !('verdicts' in st)) || JSON.stringify(st);
  });
  await t('禁止期的界線：11/17 23:59:59 有 verdicts、11/18 00:00:00 沒有、11/28 16:00:00 恢復', async () => {
    const s = memStore();
    for (let i = 0; i < 60; i++) await call(s, 'POST', 'play', { race, verdict: 'none' });
    const at = async iso => (await (await call(s, 'GET', 'stats/' + race, null, { now: new Date(iso) })).json());
    const [a, b, c] = [await at('2026-11-17T23:59:59+08:00'), await at('2026-11-18T00:00:00+08:00'), await at('2026-11-28T16:00:00+08:00')];
    return ('verdicts' in a && !('verdicts' in b) && 'verdicts' in c) || JSON.stringify([a, b, c]);
  });

  // ── 課堂版（#10）：tests/acc_class.mjs 沒涵蓋的部分。期望值從 issue #10 與 acc_class.mjs 檔頭的文字抄：
  //    6 碼、A–Z 去掉 I、O、2–9（去掉 0、1）；班級門檻 5；禁止期規則與 #4 相同；格式不對 → 全站照計、班級不計、GET 400。
  const classGet = async (s, code, opt = {}) => call(s, 'GET', `class/${code}/${opt.race || race}`, null, opt);
  const classKeys = s => s.keys().filter(k => k.startsWith('c:'));
  await t('班級代碼字元集邊界：每個合法字元都收，0、1、I、O、小寫、長度 5／7、非字串、前後空白都不進 store', async () => {
    const s = memStore();
    // 合法：A–H、J–N、P–Z、2–9 每個字元至少出現一次（32 個字元，拆成 6 碼一組）
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    if (alphabet.length !== 32) return `探針自己算錯：字元集 ${alphabet.length} 個`;
    const good = []; for (let i = 0; i < alphabet.length; i += 6) good.push((alphabet.slice(i, i + 6) + 'AAAAAA').slice(0, 6));
    const bad = ['ABC230', 'ABC231', 'ABC23I', 'ABC23O', 'abc234', 'Abc234', 'ABC23', 'ABC2345', ' ABC234', 'ABC234 ', 'ABC234\n', 'ABC-34', 'ÄBC234', 123456, ['ABC234'], { code: 'ABC234' }, null, ''];
    for (const c of [...good, ...bad]) await call(s, 'POST', 'play', { race, verdict: 'same', class: c });
    const st = await (await call(s, 'GET', 'stats/' + race)).json();
    if (st.plays !== good.length + bad.length) return `全站局數應為 ${good.length + bad.length}（格式不對也照計），實際 ${st.plays}`;
    const codes = [...new Set(classKeys(s).map(k => k.split(':')[1]))].sort();
    const want = [...good].sort();
    if (codes.join() !== want.join()) return `store 裡的班級代碼應為 ${want.join(',')}，實際 ${codes.join(',')}`;
    for (const g of good){ const j = await (await classGet(s, g)).json(); if (j.plays !== 1) return `${g} 的班級局數應為 1，實際 ${j.plays}`; }
    return true;
  });
  await t('班級 GET：格式不對 400（小寫、含 0／1／I／O、長度不對、URL 編碼的空白）；合法代碼＋不認得的選區 404；POST 405；no-store', async () => {
    const s = memStore();
    const st = [];
    for (const c of ['abc234', 'ABC230', 'ABC23I', 'ABC23', 'ABC2345', '%20ABC234']) st.push((await classGet(s, c)).status);
    if (st.some(x => x !== 400)) return `格式不對應全 400，實際 ${st.join('/')}`;
    const unknown = (await classGet(s, 'ABC234', { race: 'nope' })).status;
    if (unknown !== 404) return `不認得的選區應 404，實際 ${unknown}`;
    const post = (await call(s, 'POST', `class/ABC234/${race}`, {})).status;
    if (post !== 405) return `POST 應 405，實際 ${post}`;
    const r = await classGet(s, 'ABC234');
    if (r.status !== 200) return `合法代碼應 200，實際 ${r.status}`;
    if (r.headers.get('cache-control') !== 'no-store') return `cache-control ${r.headers.get('cache-control')}`;
    const j = await r.json();
    if (j.class !== 'ABC234' || j.race !== race || j.plays !== 0 || j.guesses?.answers !== 0 || j.guesses?.correct !== 0 || 'verdicts' in j) return JSON.stringify(j);
    return s.keys().length === 0 || `GET 不應寫 store，存了 ${s.keys().join(',')}`;
  });
  await t('班級禁止期的界線：11/17 23:59:59 有 verdicts、11/18 00:00:00 沒有、11/28 16:00:00 恢復；沒有 pollBlackoutFrom → 沒有', async () => {
    const s = memStore();
    for (let i = 0; i < 6; i++) await call(s, 'POST', 'play', { race, verdict: 'different', class: 'KLM678' });
    const at = async opt => (await (await classGet(s, 'KLM678', opt)).json());
    const broken = { ...data, elections: data.elections.map(e => ({ ...e, pollBlackoutFrom: undefined })) };
    const [a, b, c, d] = [await at({ now: new Date('2026-11-17T23:59:59+08:00') }), await at({ now: new Date('2026-11-18T00:00:00+08:00') }),
      await at({ now: new Date('2026-11-28T16:00:00+08:00') }), await at({ data: broken })];
    const okA = a.verdicts?.different === 6 && a.verdicts?.same === 0 && a.verdicts?.none === 0;
    return (okA && !('verdicts' in b) && c.verdicts?.different === 6 && !('verdicts' in d) && b.plays === 6 && d.plays === 6) || JSON.stringify([a, b, c, d]);
  });
  await t('班級猜作者：同段只算一次、名單外的名字不算、全站 health 照樣算進；別的選區看不到這班的數字', async () => {
    const s = memStore(), [a, b] = ps;
    const other = data.races.find(r => r.id !== race)?.id;
    if (!b || !other) return '探針母體不足：需要 ≥ 2 段與 ≥ 2 個選區';
    await call(s, 'POST', 'guess', { race, class: 'RST345', guesses: [
      { passage: a.id, name: nameOf[a.candidateId] }, { passage: a.id, name: nameOf[a.candidateId] }, { passage: b.id, name: '不在名單上的人' }] });
    await call(s, 'POST', 'play', { race, verdict: 'none', class: 'RST345' });
    const j = await (await classGet(s, 'RST345')).json();
    if (j.guesses?.answers !== 1 || j.guesses?.correct !== 1 || j.plays !== 1) return `本選區應 答題 1 對 1、局數 1，實際 ${JSON.stringify(j)}`;
    const ha = (await health(s)).find(x => x.id === a.id);
    if (ha.answers !== 1 || ha.correct !== 1) return `全站 health 應算進這一筆，實際 ${JSON.stringify(ha)}`;
    const o = await (await classGet(s, 'RST345', { race: other })).json();
    return (o.plays === 0 && o.guesses?.answers === 0) || `別的選區不應有這班的數字：${JSON.stringify(o)}`;
  });
  await t('帶班級但選區不認得／verdict 壞掉 → 400，全站與班級都不計', async () => {
    const s = memStore();
    const got = [(await call(s, 'POST', 'play', { race: 'nope', verdict: 'same', class: 'ABC234' })).status,
      (await call(s, 'POST', 'play', { race, verdict: 'maybe', class: 'ABC234' })).status,
      (await call(s, 'POST', 'guess', { race: 'nope', class: 'ABC234', guesses: [] })).status];
    if (got.join() !== '400,400,400') return got.join('/');
    return s.keys().length === 0 || `存了 ${s.keys().join(',')}`;
  });

  // #33（orchestrator 裁決）：第四種 verdict 'tie'。期望值從 issue #33 的文字抄（四個鍵、舊值照收），數字是手排的局數。
  await t('#33 POST 接受 tie、舊的 same／different／none 照收；stats 的 verdicts 正好四個鍵、各自的數字對', async () => {
    const s = memStore();
    const plan = { tie: 20, same: 15, different: 10, none: 5 };   // 共 50 局 = 門檻
    const bad = [];
    for (const [v, n] of Object.entries(plan)) for (let i = 0; i < n; i++){
      const st = (await call(s, 'POST', 'play', { race, verdict: v })).status;
      if (st !== 204) bad.push(`${v} ${st}`);
    }
    if (bad.length) return `應 204：${[...new Set(bad)].join('、')}`;
    const j = await (await call(s, 'GET', 'stats/' + race)).json();
    if (j.plays !== 50) return `plays 應 50，實際 ${j.plays}`;
    const keys = Object.keys(j.verdicts || {}).sort().join(',');
    if (keys !== 'different,none,same,tie') return `verdicts 的鍵應為 different,none,same,tie，實際 ${keys || '（沒有 verdicts）'}`;
    const wrong = Object.entries(plan).filter(([v, n]) => j.verdicts[v] !== n).map(([v, n]) => `${v} 應 ${n} 實際 ${j.verdicts[v]}`);
    return wrong.length ? wrong.join('；') : true;
  });
  await t('#33 班級的 verdicts 也有 tie；大小寫不對、近似字（TIE、tied）→ 400 且不計', async () => {
    const s = memStore();
    for (const v of ['tie', 'tie', 'tie', 'same', 'different']) await call(s, 'POST', 'play', { race, verdict: v, class: 'WXY234' });
    const j = await (await classGet(s, 'WXY234')).json();
    const want = { same: 1, different: 1, none: 0, tie: 3 };
    const norm = o => o && JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));
    if (norm(j.verdicts) !== norm(want)) return `班級 verdicts 應 ${JSON.stringify(want)}，實際 ${JSON.stringify(j.verdicts)}`;
    const s2 = memStore();
    const got = [(await call(s2, 'POST', 'play', { race, verdict: 'TIE' })).status, (await call(s2, 'POST', 'play', { race, verdict: 'tied', class: 'WXY234' })).status];
    if (got.join() !== '400,400') return `應 400/400，實際 ${got.join('/')}`;
    return s2.keys().length === 0 || `存了 ${s2.keys().join(',')}`;
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
