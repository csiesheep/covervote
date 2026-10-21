// tests/acc_api.mjs — 後端端點：猜作者匯總、局數與「傾向 vs 契合」匯總、11/18 自動下架。orchestrator 所有（issue #4）。
//
// 規格（owner 2026-10-21 定案，TEAM.md「產品不可協商的約束」）：
//   - 不上傳個人傾向；全體「傾向 vs 契合」只收匯總計數，未滿 50 局不顯示（MIN_CELL）。
//   - 選罷法第 53 條：pollBlackoutFrom（data/elections.json）起到投票截止（voteDate 16:00 +08:00）止，
//     不回傳任何與候選人支持有關的匯總（same/different/none）；局數、段落猜中率照常。
//   - `internal=1` 的請求一律不計（線上檢查不灌數字）。
//   - 遮蔽健康度：每段 answers、correct、rate、random（1/該選區有段落的候選人數）；
//     answers ≥ 200 且 rate > random + 0.20 → flagged（plan 第三節）。
//
// 介面（issue #4 定的，BE 照做）：
//   worker/api.mjs        export async function handleApi(request, { store, now, data }) → Response | null（不是 /covervote/api/ 就回 null）
//   worker/memstore.mjs   export function memStore() → { incr(key, n=1), get(key) → number, keys() → string[] }（測試與本機用；
//                         incr／get 可以回 Promise，正式環境的 D1 版本一定是非同步的；keys() 只有 memStore 需要）
//   data = loadData()（tools/build_public.mjs），now = Date 物件。
//   POST /covervote/api/guess        body { race, guesses: [{ passage, name }] } → 204
//   POST /covervote/api/play         body { race, verdict: 'same'|'different'|'none' } → 204
//   GET  /covervote/api/health/<race> → { race, passages: [{ id, answers, correct, rate, random, flagged }] }
//   GET  /covervote/api/stats/<race>  → { race, plays, blackout, verdicts? }   verdicts = { same, different, none }，
//        blackout 時或 plays < 50 時沒有 verdicts 這個鍵。
//   不認得的段落、別的選區的段落、不在名單上的姓名：忽略，不計。body 裡多出的欄位（例如 lean）：忽略，不存。
import { section, check, ok, eq, importOrNull } from './harness.js';
import { loadData } from '../tools/build_public.mjs';

const api = await importOrNull('../worker/api.mjs');
const mem = await importOrNull('../worker/memstore.mjs');
const data = loadData();

const MIN_CELL = 50, FLAG_MIN = 200, FLAG_MARGIN = 0.20;
const STRICT_4 = true;   // #4 land（2026-10-21）時翻：之後模組消失要紅，不是 TODO
const need = () => (api?.handleApi && mem?.memStore) ? null : (STRICT_4 ? '' : 'TODO: ') + 'worker/api.mjs（handleApi）與 worker/memstore.mjs（memStore）不見了';

const BASE = 'https://games.csiesheep.com/covervote/api/';
const T_BEFORE = new Date('2026-11-10T12:00:00+08:00');
const T_IN = new Date('2026-11-20T12:00:00+08:00');
const T_LAST = new Date('2026-11-28T15:59:00+08:00');
const T_AFTER = new Date('2026-11-28T16:01:00+08:00');

const race = data.races[0]?.id;
const ps = data.passages.filter(p => p.race === race);
const name = Object.fromEntries(data.candidates.map(c => [c.id, c.name]));
const others = p => data.candidates.filter(c => c.raceId === race && c.id !== p.candidateId).map(c => c.name);

const call = async (store, method, path, body, now = T_BEFORE, qs = '') => {
  const req = new Request(BASE + path + qs, method === 'GET' ? { method } : { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  return api.handleApi(req, { store, now, data });
};
const json = async r => JSON.parse(await r.text());

section('後端端點（#4）');
check('母體：選區至少有 2 段、2 位候選人', () => {
  if (!race) return '母體是空的：data/races.json 沒有選區';
  if (ps.length < 2) return `母體太小：${race} 只有 ${ps.length} 段`;
  return ok(true, `${race}：${ps.length} 段`);
});

// check() 是同步的；非同步的檢查先跑完，把結果交給 check 讀。
const results = {};
const run = async (key, fn) => { try { results[key] = await fn(); } catch (e){ results[key] = (e && e.message) || String(e); } };

if (!need() && ps.length >= 2){
  await run('guess', async () => {
    const s = mem.memStore(), [a, b] = ps;
    // a 猜對 3 次、猜錯 1 次；b 猜對 1 次。外加一個不存在的段落與一個不在名單的姓名，都不能計。
    for (let i = 0; i < 3; i++) await call(s, 'POST', 'guess', { race, guesses: [{ passage: a.id, name: name[a.candidateId] }] });
    await call(s, 'POST', 'guess', { race, guesses: [{ passage: a.id, name: others(a)[0] }, { passage: b.id, name: name[b.candidateId] }] });
    await call(s, 'POST', 'guess', { race, guesses: [{ passage: 'p-nope', name: name[a.candidateId] }, { passage: a.id, name: '不存在的人' }] });
    const h = await json(await call(s, 'GET', 'health/' + race));
    const ha = h.passages.find(x => x.id === a.id), hb = h.passages.find(x => x.id === b.id);
    const errs = [eq(ha?.answers, 4, `${a.id} answers（不存在的段落、不在名單的姓名不能計）`), eq(ha?.correct, 3, `${a.id} correct`),
      eq(hb?.answers, 1, `${b.id} answers`), eq(hb?.correct, 1, `${b.id} correct`)].filter(x => x !== true);
    return errs.length ? errs.join('；') : ok(true, `${a.id} 3/4、${b.id} 1/1`);
  });

  await run('internal', async () => {
    const s = mem.memStore(), [a] = ps;
    await call(s, 'POST', 'guess', { race, guesses: [{ passage: a.id, name: name[a.candidateId] }] }, T_BEFORE, '?internal=1');
    await call(s, 'POST', 'play', { race, verdict: 'same' }, T_BEFORE, '?internal=1');
    const h = await json(await call(s, 'GET', 'health/' + race)), st = await json(await call(s, 'GET', 'stats/' + race));
    const errs = [eq(h.passages.find(x => x.id === a.id)?.answers, 0, 'internal=1 的猜測'), eq(st.plays, 0, 'internal=1 的局')].filter(x => x !== true);
    return errs.length ? errs.join('；') : ok(true, 'internal=1 的猜測與局都沒計');
  });

  await run('cell', async () => {
    const s = mem.memStore();
    for (let i = 0; i < MIN_CELL - 1; i++) await call(s, 'POST', 'play', { race, verdict: i % 2 ? 'same' : 'different' });
    const under = await json(await call(s, 'GET', 'stats/' + race));
    await call(s, 'POST', 'play', { race, verdict: 'none' });
    const at = await json(await call(s, 'GET', 'stats/' + race));
    if (under.plays !== MIN_CELL - 1) return `49 局後 plays 應為 49，實際 ${under.plays}`;
    if ('verdicts' in under) return `未滿 ${MIN_CELL} 局不應回傳 verdicts，實際 ${JSON.stringify(under.verdicts)}`;
    if (!at.verdicts) return `滿 ${MIN_CELL} 局應回傳 verdicts，實際沒有`;
    const errs = [eq(at.verdicts.same, 24, 'same'), eq(at.verdicts.different, 25, 'different'), eq(at.verdicts.none, 1, 'none')].filter(x => x !== true);
    return errs.length ? errs.join('；') : ok(true, `49 局沒有 verdicts；50 局 ${JSON.stringify(at.verdicts)}`);
  });

  await run('blackout', async () => {
    const s = mem.memStore();
    for (let i = 0; i < 60; i++) await call(s, 'POST', 'play', { race, verdict: 'same' });
    const at = async t => json(await call(s, 'GET', 'stats/' + race, null, t));
    const [b, i, l, a] = [await at(T_BEFORE), await at(T_IN), await at(T_LAST), await at(T_AFTER)];
    const errs = [];
    if (!b.verdicts || b.blackout) errs.push(`11/10 應有 verdicts、blackout false，實際 ${JSON.stringify(b)}`);
    for (const [lbl, x] of [['11/20', i], ['11/28 15:59', l]]){
      if ('verdicts' in x) errs.push(`${lbl} 在禁止期，不得回傳 verdicts：${JSON.stringify(x.verdicts)}`);
      if (x.blackout !== true) errs.push(`${lbl} blackout 應為 true`);
      if (x.plays !== 60) errs.push(`${lbl} 局數照常，應為 60，實際 ${x.plays}`);
    }
    if (!a.verdicts || a.blackout) errs.push(`11/28 16:01 投票截止後應重新回傳 verdicts，實際 ${JSON.stringify(a)}`);
    // 原始回應文字也不得含 same/different 的數字（防止藏在別的鍵裡）
    const raw = await (await call(s, 'GET', 'stats/' + race, null, T_IN)).text();
    if (/same|different/.test(raw)) errs.push(`禁止期的原始回應含 same/different：${raw}`);
    return errs.length ? errs.join('；') : ok(true, '11/10 有、11/20 與 11/28 15:59 沒有、16:01 恢復；局數照常');
  });

  await run('nostore', async () => {
    const s = mem.memStore(), [a] = ps;
    await call(s, 'POST', 'play', { race, verdict: 'same', lean: '某某某' });
    await call(s, 'POST', 'guess', { race, guesses: [{ passage: a.id, name: name[a.candidateId] }], lean: '某某某', ua: 'x' });
    const keys = s.keys();
    if (!keys.length) return 'store 是空的：play 與 guess 都沒有存任何東西，這條查不出什麼';
    const leak = keys.filter(k => /某某某|(^|[:|])(lean|ua)([:|]|$)/.test(k));   // 只認整段的 lean／ua：/ua/ 會撞到 taoyuan（BE #4 回報）
    return leak.length ? `store 的鍵含個人欄位：${leak.join('、')}` : ok(true, `${keys.length} 個鍵，沒有 lean／ua`);
  });

  await run('flag', async () => {
    const s = mem.memStore(), [a, b] = ps;
    const nC = data.candidates.filter(c => c.raceId === race).length;
    const random = 1 / new Set(ps.map(p => p.candidateId)).size;
    // a：200 次、猜中率 random + 0.25 → flagged；b：199 次、猜中率 100% → 樣本不足，不 flagged。
    const hitA = Math.ceil(200 * (random + 0.25));
    for (let i = 0; i < 200; i++) await call(s, 'POST', 'guess', { race, guesses: [{ passage: a.id, name: i < hitA ? name[a.candidateId] : others(a)[0] }] });
    for (let i = 0; i < 199; i++) await call(s, 'POST', 'guess', { race, guesses: [{ passage: b.id, name: name[b.candidateId] }] });
    const h = await json(await call(s, 'GET', 'health/' + race));
    const ha = h.passages.find(x => x.id === a.id), hb = h.passages.find(x => x.id === b.id);
    const errs = [];
    if (Math.abs(ha.random - random) > 1e-9) errs.push(`random 應為 1/${1 / random}（有段落的候選人數），實際 ${ha.random}（名單 ${nC} 人）`);
    if (ha.flagged !== true) errs.push(`${a.id} 200 次、rate ${ha.rate} > ${random} + ${FLAG_MARGIN}，應 flagged`);
    if (hb.flagged !== false) errs.push(`${b.id} 只有 199 次，不應 flagged（樣本不足）`);
    return errs.length ? errs.join('；') : ok(true, `${a.id} rate ${ha.rate.toFixed(2)} flagged；${b.id} 199 次不 flagged`);
  });

  await run('nonapi', async () => {
    const r = await api.handleApi(new Request('https://games.csiesheep.com/covervote/index.html'), { store: mem.memStore(), now: T_BEFORE, data });
    return r === null ? ok(true, '非 /api/ 路徑回 null，交給靜態檔') : `非 /api/ 路徑應回 null，實際 ${r && r.status}`;
  });
}

// section 放在 await 之後、check 之前：放在前面的話，別的檔案（acc_modules）在 await 期間改掉 section，這裡的列會掛錯組名（BE #4 回報）。
section('後端端點（#4）');
const show = key => () => need() || (key in results ? results[key] : 'TODO: 母體不足，沒有跑');
check('猜作者匯總：猜對猜錯分開計；不存在的段落與不在名單的姓名不計', show('guess'));
check('internal=1 的猜測與局不計', show('internal'));
check(`「傾向 vs 契合」未滿 ${MIN_CELL} 局不顯示，滿了才顯示`, show('cell'));
check('選罷法 53 條：11/18 00:00 到 11/28 16:00 不回傳 verdicts，局數照常', show('blackout'));
check('不存個人欄位（lean、ua）', show('nostore'));
check(`遮蔽健康度：answers ≥ ${FLAG_MIN} 且 rate > random + ${FLAG_MARGIN} 才 flagged`, show('flag'));
check('非 /api/ 的路徑交還給靜態檔', show('nonapi'));
