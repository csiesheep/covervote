// worker/security_selftest.mjs — BE 自己的檢查：issue #32（程式審查的後端項）裡 tests/acc_security.mjs 沒涵蓋的邊。BE 所有。
//   node worker/security_selftest.mjs     （還沒接進 npm run test:be：package.json 不在 #32 的範圍）
// import 時什麼都不跑（tests/acc_modules.js 會 import worker/ 底下每個檔）。
// 期望值從 issue #32 與 tests/acc_security.mjs 檔頭的文字抄：415、403、429、8 KB、`https://games.csiesheep.com`、
// 「沒有 Origin 照常」、「以 CF-Connecting-IP 當鍵、只交給綁定、不寫進任何儲存、不記錄」、「一人一議題一段」、
// 「題目檔順序與作者無關」。不從 api.mjs／build_public.mjs 讀常數。
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export async function run(){
  const { handleApi } = await import('./api.mjs');
  const { memStore } = await import('./memstore.mjs');
  const { loadData, racePayload } = await import('../tools/build_public.mjs');
  const { validate } = await import('../data/schema.mjs');
  const data = loadData();
  const race = data.races.find(r => data.passages.some(p => p.race === r.id)).id;
  const T = new Date('2026-11-10T12:00:00+08:00');
  const SITE = 'https://games.csiesheep.com';
  const IP = '203.0.113.77';   // TEST-NET-3，不是任何真人的位址

  const post = (route, body, { ct = 'application/json', origin, ip, base = SITE, stream } = {}) => {
    const headers = {};
    if (ct !== null) headers['content-type'] = ct;
    if (origin !== undefined) headers.origin = origin;
    if (ip) headers['cf-connecting-ip'] = ip;
    const init = { method: 'POST', headers };
    if (stream){ init.body = stream; init.duplex = 'half'; }
    else init.body = typeof body === 'string' ? body : JSON.stringify(body);
    return new Request(`${base}/covervote/api/${route}`, init);
  };
  const playBody = { race, verdict: 'same' };
  const plays = async s => (await (await handleApi(new Request(`${SITE}/covervote/api/stats/${race}`), { store: s, now: T, data })).json()).plays;
  const call = (req, s, extra = {}) => handleApi(req, { store: s, now: T, data, ...extra });

  const out = [];
  const t = async (name, fn) => { try { const r = await fn(); out.push([r === true ? 'PASS' : 'FAIL', name, r === true ? '' : r]); } catch (e){ out.push(['FAIL', name, e.message]); } };

  // ---- content-type ----
  await t('content-type：application/json（含 charset、大小寫）→ 204；text/plain、沒有、application/jsonx、form → 415 且不計', async () => {
    const s = memStore();
    const okCts = ['application/json', 'application/json; charset=utf-8', 'Application/JSON;charset=UTF-8'];
    const badCts = ['text/plain', null, 'application/jsonx', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'text/plain; x=application/json'];
    const good = []; for (const ct of okCts) good.push((await call(post('play', playBody, { ct }), s)).status);
    if (good.some(x => x !== 204)) return `合法 content-type 被擋：${okCts.map((c, i) => `${c}→${good[i]}`).join('、')}`;
    const bad = []; for (const ct of badCts) bad.push((await call(post('play', playBody, { ct }), s)).status);
    if (bad.some(x => x !== 415)) return `應 415：${badCts.map((c, i) => `${JSON.stringify(c)}→${bad[i]}`).join('、')}`;
    const g = (await call(post('guess', { race, guesses: [] }, { ct: 'text/plain' }), s)).status;
    if (g !== 415) return `guess 也要擋：text/plain → ${g}`;
    const n = await plays(s);
    return n === okCts.length || `應只計 ${okCts.length} 局，計了 ${n}`;
  });

  // ---- Origin ----
  await t('Origin：本站、沒有 Origin → 204；外站、看起來像本站的外站、http 本站、"null" → 403 且不計', async () => {
    const s = memStore();
    const allow = [SITE, undefined];
    const deny = ['https://evil.example', 'https://games.csiesheep.com.evil.example', 'http://games.csiesheep.com', 'null', 'https://csiesheep.com', 'https://games.csiesheep.com:8443'];
    const a = []; for (const o of allow) a.push((await call(post('play', playBody, { origin: o }), s)).status);
    if (a.some(x => x !== 204)) return `該放行的被擋：${allow.map((o, i) => `${o ?? '(沒有)'}→${a[i]}`).join('、')}`;
    const d = []; for (const o of deny) d.push((await call(post('play', playBody, { origin: o }), s)).status);
    if (d.some(x => x !== 403)) return `應 403：${deny.map((o, i) => `${o}→${d[i]}`).join('、')}`;
    const n = await plays(s);
    return n === allow.length || `應只計 ${allow.length} 局，計了 ${n}`;
  });
  await t('Origin：跟請求同源（本機 wrangler dev 的 http://localhost:8787）→ 204；別的 localhost 埠 → 403', async () => {
    const s = memStore();
    const base = 'http://localhost:8787';
    const same = (await call(post('play', playBody, { base, origin: base }), s)).status;
    const other = (await call(post('play', playBody, { base, origin: 'http://localhost:9999' }), s)).status;
    return (same === 204 && other === 403) || `同源 ${same}（應 204）、別的埠 ${other}（應 403）`;
  });
  await t('GET 不看 Origin、不看 content-type（外站讀匯總照常 200）', async () => {
    const r = await call(new Request(`${SITE}/covervote/api/stats/${race}`, { headers: { origin: 'https://evil.example' } }), memStore());
    return r.status === 200 || `status ${r.status}`;
  });

  // ---- limiter ----
  await t('limiter：鍵是 CF-Connecting-IP；放行 → 204 計數；拒絕 → 429 不計；GET 不呼叫 limiter', async () => {
    const s = memStore(); const keys = [];
    let allowNext = true;
    const limiter = { limit: async ({ key }) => { keys.push(key); return { success: allowNext }; } };
    const r1 = await call(post('play', playBody, { ip: IP }), s, { limiter });
    allowNext = false;
    const r2 = await call(post('play', playBody, { ip: IP }), s, { limiter });
    const r3 = await call(post('guess', { race, guesses: [] }, { ip: IP }), s, { limiter });
    await call(new Request(`${SITE}/covervote/api/stats/${race}`, { headers: { 'cf-connecting-ip': IP } }), s, { limiter });
    if (r1.status !== 204 || r2.status !== 429 || r3.status !== 429) return `放行 ${r1.status}（應 204）、拒絕 play ${r2.status}、guess ${r3.status}（應 429）`;
    if (keys.length !== 3 || keys.some(k => k !== IP)) return `limiter 應被呼叫 3 次、鍵都是 ${IP}，實際 ${JSON.stringify(keys)}`;
    const n = await plays(s);
    return n === 1 || `應只計 1 局，計了 ${n}`;
  });
  await t('limiter：415／403 先擋，不耗限額（外站灌不掉本站訪客的額度）', async () => {
    let n = 0; const limiter = { limit: async () => { n++; return { success: true }; } };
    const s = memStore();
    await call(post('play', playBody, { ct: 'text/plain', ip: IP }), s, { limiter });
    await call(post('play', playBody, { origin: 'https://evil.example', ip: IP }), s, { limiter });
    return n === 0 || `limiter 被呼叫 ${n} 次`;
  });
  await t('limiter：IP 不進 store 的任何鍵或值、不印到 console', async () => {
    const s = memStore();
    const printed = [];
    const orig = {}; for (const m of ['log', 'info', 'warn', 'error', 'debug']){ orig[m] = console[m]; console[m] = (...a) => printed.push(a.map(String).join(' ')); }
    try {
      const limiter = { limit: async () => ({ success: true }) };
      const deny = { limit: async () => ({ success: false }) };
      const p0 = data.passages.find(p => p.race === race);
      const nm = data.candidates.find(c => c.id === p0.candidateId).name;
      await call(post('guess', { race, class: 'ABC234', guesses: [{ passage: p0.id, name: nm }] }, { ip: IP }), s, { limiter });
      await call(post('play', { ...playBody, class: 'ABC234' }, { ip: IP }), s, { limiter });
      await call(post('play', playBody, { ip: IP }), s, { limiter: deny });
      await call(post('play', playBody, { ip: IP }), s, { limiter: { limit: async () => { throw new Error('binding 壞了 ' + IP); } } });
    } finally { Object.assign(console, orig); }
    if (s.keys().length === 0) return '探針母體是空的：store 一個鍵都沒有，等於沒檢查';
    // memStore 的值只收整數（memstore.mjs 的 add 會丟 TypeError），所以掃鍵就是掃全部內容。
    if (s.keys().some(k => k.includes(IP))) return `store 的鍵含 IP：${s.keys().filter(k => k.includes(IP)).join(',')}`;
    const leak = printed.filter(l => l.includes(IP));
    return leak.length === 0 || `console 印出 IP：${leak[0]}`;
  });
  await t('limiter 本身丟例外 → 放行（fail open，計數照常），不回 500', async () => {
    const s = memStore();
    const warn = console.warn; const printed = []; console.warn = (...a) => printed.push(a.join(' '));
    let r; try { r = await call(post('play', playBody, { ip: IP }), s, { limiter: { limit: async () => { throw new Error('x'); } } }); }
    finally { console.warn = warn; }
    if (printed.length !== 1) return `應印一行固定的警告，印了 ${printed.length} 行`;
    const n = await plays(s);
    return (r.status === 204 && n === 1) || `status ${r.status}、計了 ${n} 局`;
  });
  await t('沒有 limiter（本機、測試）→ 照常 204', async () => {
    const r = await call(post('play', playBody), memStore());
    return r.status === 204 || `status ${r.status}`;
  });

  // ---- body 上限（沒有 content-length 的串流）----
  await t('沒有 content-length 的串流 body：超過 8 KB 立刻 413，不把後面的 chunk 讀完；不計', async () => {
    const CHUNK = 1024, TOTAL = 1024;   // 宣稱 1 MB，讀超過 ~9 KB 就算沒有立刻停
    let pulled = 0, cancelled = false;
    const stream = new ReadableStream({
      pull(c){ if (pulled >= TOTAL){ c.close(); return; } pulled++; c.enqueue(new Uint8Array(CHUNK).fill(0x20)); },
      cancel(){ cancelled = true; },
    }, { highWaterMark: 0 });
    const req = post('play', null, { stream });
    if (req.headers.get('content-length') !== null) return `探針自己錯：帶了 content-length ${req.headers.get('content-length')}`;
    const s = memStore();
    const r = await call(req, s);
    if (r.status !== 413) return `status ${r.status}（應 413）`;
    if (pulled > 12) return `讀了 ${pulled} 個 1 KB chunk 才停（應在 ~9 個內）`;
    if (s.keys().length) return `存了 ${s.keys().join(',')}`;
    return cancelled || `讀了 ${pulled} 個 chunk 後沒有 cancel 串流`;
  });
  await t('沒有 content-length 的串流 body：8 KB 以內照常 204', async () => {
    const body = new TextEncoder().encode(JSON.stringify(playBody));
    let sent = false;
    const stream = new ReadableStream({ pull(c){ if (sent){ c.close(); return; } sent = true; c.enqueue(body.slice(0, 5)); c.enqueue(body.slice(5)); } });
    const r = await call(post('play', null, { stream }), memStore());
    return r.status === 204 || `status ${r.status}`;
  });
  await t('串流 body 剛好 8192 bytes → 204；8193 → 413', async () => {
    const mk = n => { const base = JSON.stringify({ race, verdict: 'same', pad: '' }); return JSON.stringify({ race, verdict: 'same', pad: 'x'.repeat(n - base.length) }); };
    const st = str => { const b = new TextEncoder().encode(str); let i = 0; return new ReadableStream({ pull(c){ if (i >= b.length){ c.close(); return; } c.enqueue(b.slice(i, i + 1000)); i += 1000; } }); };
    const a = mk(8192), b = mk(8193);
    if (a.length !== 8192 || b.length !== 8193) return `探針自己算錯：${a.length}/${b.length}`;
    const ra = await call(post('play', null, { stream: st(a) }), memStore());
    const rb = await call(post('play', null, { stream: st(b) }), memStore());
    return (ra.status === 204 && rb.status === 413) || `8192 → ${ra.status}（應 204）、8193 → ${rb.status}（應 413）`;
  });

  // ---- validate：一人一議題一段 ----
  await t('validate()：同一位候選人在同一議題有兩段 → 報錯（點名兩段）；真資料 → 0 個錯', async () => {
    const real = validate(data);
    if (real.length) return `真資料就有錯：${real.slice(0, 3).join('；')}`;
    const p = data.passages.find(x => x.race === race);
    const dup = { ...p, id: p.id + '-dup' };
    const errs = validate({ ...data, passages: [...data.passages, dup] });
    const hit = errs.filter(e => e.includes(p.id) && e.includes(dup.id));
    if (!hit.length) return `沒有點名 ${p.id} 與 ${dup.id} 的錯：${JSON.stringify(errs)}`;
    // 最像的錯實作是只看 (選區, 議題)：真資料 0 錯就排除它——前提是真資料裡真的有「同議題、兩位候選人各一段」，這裡確認母體。
    const other = data.passages.find(x => x.race === race && x.issueId === p.issueId && x.candidateId !== p.candidateId);
    if (!other) return '探針母體不足：找不到同議題的另一位候選人';
    return true;
  });

  // ---- 題目檔順序 ----
  await t('race payload 的段落順序與資料檔列順序無關（同一份資料洗三種順序，輸出一樣）', async () => {
    const rc = data.races.find(r => r.id === race);
    const ids = ps => racePayload(rc, ps, data.elections).passages.map(p => p.id).join(',');
    const base = ids(data.passages);
    const rev = ids([...data.passages].reverse());
    const byAuthor = ids([...data.passages].sort((a, b) => a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0));
    const dataOrder = data.passages.filter(p => p.race === race).map(p => p.id).join(',');
    if (base === dataOrder) return '輸出就是資料檔的順序';
    return (base === rev && base === byAuthor) || `輸入順序不同，輸出就不同：\n        ${base}\n        ${rev}\n        ${byAuthor}`;
  });
  await t('每個選區：議題第一段不全是同一人；相鄰同作者 15%–85%（照 acc_security 的門檻，逐選區列）', async () => {
    const author = Object.fromEntries(data.passages.map(p => [p.id, p.candidateId]));
    const bad = []; let checked = 0;
    for (const rc of data.races){
      const ps = racePayload(rc, data.passages, data.elections).passages;
      if (ps.length < 6 || new Set(ps.map(p => author[p.id])).size < 2) continue;
      checked++;
      const firsts = new Map(); for (const p of ps) if (!firsts.has(p.issueId)) firsts.set(p.issueId, author[p.id]);
      let same = 0; for (let i = 1; i < ps.length; i++) if (author[ps[i].id] === author[ps[i - 1].id]) same++;
      const rate = same / (ps.length - 1);
      if (new Set(firsts.values()).size === 1 && firsts.size >= 3) bad.push(`${rc.id} 第一段全同人`);
      else if (rate <= 0.15 || rate >= 0.85) bad.push(`${rc.id} 相鄰同作者 ${Math.round(rate * 100)}%`);
    }
    if (!checked) return '探針母體是空的';
    return bad.length === 0 || bad.join('；');
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
