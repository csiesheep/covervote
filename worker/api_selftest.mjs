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

  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])){
  const out = await run();
  for (const [s, n, m] of out) console.log(`${s}  ${n}${m ? '\n      ' + m : ''}`);
  const fail = out.filter(x => x[0] === 'FAIL').length;
  console.log(JSON.stringify({ pass: out.length - fail, fail }));
  process.exit(fail ? 1 : 0);
}
