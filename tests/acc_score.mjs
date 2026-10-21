// tests/acc_score.mjs — 契合分數引擎 engine/score.mjs 的驗收。orchestrator 所有（issue #1）。
//
// 規格抄自設計稿 D4「契合分數怎麼算」與 plan 第二節（owner 2026-10-21 定案），寫死在這裡，不從產品讀：
//   1. 每段分數是 −2..+2 的整數；沒有分數（跳過）的段落不算，不是當 0 算。
//   2. 一個議題要有 ≥ 2 位候選人在這個選區提出段落才計分；只有一人提出的是「加分題」，不計分。
//   3. 標成重要的議題，那一段權重 2，其他 1。
//   4. 候選人分數 = round(50 × 加權平均)，落在 −100..+100；沒有任何計分段落 → null。
//      捨入是遠離 0 的對稱捨入（±12.5 → ±13），−0 寫成 0（orchestrator 裁決 #1：分數全部翻號，結果要剛好翻號）。
//   5. n = 計分段落數（不加權）；n < 3 → lowConfidence。
//   6. 可能範圍 [lo, hi]：bootstrap 1000 次、取第 10 與第 90 百分位；必須 lo ≤ score ≤ hi；
//      所有分數相同時 lo = hi = score；亂數用傳入的 rng（預設 Math.random），同一個 rng 序列結果相同。
//   7. top = 分數最高的候選人（並列全收），null 不算。
//   8. verdict(lean, result)：lean 為 null／'undecided'／'private' → 'none'；top 是空的 → 'none'
//      （orchestrator 裁決 #1：沒有任何計分段落時說「不同」是錯的結論）；lean 在 top 裡 → 'same'；否則 'different'。
//   候選人的鍵是姓名（orchestrator 裁決 #1：cands/ 與 reveal/ 都不帶 id，號次抽籤前是 null 會撞），傾向也存姓名。
//
// API（issue #1 定的介面）：
//   score({ passages: [{ id, issueId, candidateId }], ratings: { [passageId]: -2..2 }, important: [issueId] }, { rng }?)
//     → { candidates: [{ candidateId, score, n, lo, hi, lowConfidence }], top: [candidateId] }
//   verdict(lean, result) → 'same' | 'different' | 'none'
//   分數超出 −2..2 或不是整數 → 丟錯。
//
// 每個案例都挑成「對的實作和最像的錯實作答案不同」：加分題算進去、跳過當 0、忽略權重、並列只取一個。
import { section, check, ok, eq, importOrNull, withSeed } from './harness.js';

const mod = await importOrNull('../engine/score.mjs');

// 選區：A、B、C 三人。childcare(A,B)、transit(A,B,C)、housing(B,C)、pets 只有 C → 加分題。
const P = [
  { id: 'p1', issueId: 'childcare', candidateId: 'A' },
  { id: 'p2', issueId: 'childcare', candidateId: 'B' },
  { id: 'p3', issueId: 'transit',   candidateId: 'A' },
  { id: 'p4', issueId: 'transit',   candidateId: 'B' },
  { id: 'p5', issueId: 'transit',   candidateId: 'C' },
  { id: 'p6', issueId: 'housing',   candidateId: 'B' },
  { id: 'p7', issueId: 'housing',   candidateId: 'C' },
  { id: 'p8', issueId: 'pets',      candidateId: 'C' },
];
const BASE = { p1: 2, p2: -1, p3: 1, p4: 0, p5: -2, p6: 1, p7: 2, p8: 2 };

const run = (ratings, important = [], seed = 7) =>
  withSeed(seed, () => mod.score({ passages: P, ratings, important }));
const byId = r => Object.fromEntries(r.candidates.map(c => [c.candidateId, c]));
const need = () => (mod && typeof mod.score === 'function' && typeof mod.verdict === 'function') ? null
  : 'TODO: engine/score.mjs 還沒有 export score 與 verdict';

section('契合分數（#1）');

check('基本分數：A +75、B 0、C 0（加分題 pets 不算）', () => {
  const t = need(); if (t) return t;
  const c = byId(run(BASE));
  // 錯實作「加分題也算」：C = round(50 × (−2+2+2)/3) = 33
  const errs = [eq(c.A.score, 75, 'A'), eq(c.B.score, 0, 'B'), eq(c.C.score, 0, 'C（若是 33，加分題被算進去了）')].filter(x => x !== true);
  return errs.length ? errs.join('；') : ok(true, `A ${c.A.score}、B ${c.B.score}、C ${c.C.score}`);
});

check('重要議題 ×2：transit 標重要 → A +67、B 0、C −33', () => {
  const t = need(); if (t) return t;
  const c = byId(run(BASE, ['transit']));
  // 錯實作「忽略權重」：A 75、C 0
  const errs = [eq(c.A.score, 67, 'A'), eq(c.B.score, 0, 'B'), eq(c.C.score, -33, 'C（若是 0，權重沒有作用）')].filter(x => x !== true);
  return errs.length ? errs.join('；') : ok(true, `A ${c.A.score}、B ${c.B.score}、C ${c.C.score}`);
});

check('跳過的段落不算（不是當 0）：只打 p1=+2 → A +100、n 1、lowConfidence', () => {
  const t = need(); if (t) return t;
  const c = byId(run({ p1: 2, p2: 0, p4: 0 }));
  // 錯實作「跳過當 0」：A = round(50 × (2+0)/2) = 50
  const errs = [eq(c.A.score, 100, 'A（若是 50，跳過被當成 0）'), eq(c.A.n, 1, 'A 的 n'), eq(c.A.lowConfidence, true, 'A lowConfidence')].filter(x => x !== true);
  return errs.length ? errs.join('；') : ok(true, `A ${c.A.score}，n ${c.A.n}，lowConfidence ${c.A.lowConfidence}`);
});

check('沒有計分段落的候選人 → score null，不進 top', () => {
  const t = need(); if (t) return t;
  const r = run({ p1: 2, p2: 0, p8: 2 });   // C 只有加分題 p8 有分數
  const c = byId(r);
  if (c.C.score !== null) return `C 只有加分題有分數，應為 null，實際 ${c.C.score}`;
  if (r.top.includes('C')) return `top 不應含 score 為 null 的 C：${JSON.stringify(r.top)}`;
  return ok(true, `C null，top ${JSON.stringify(r.top)}`);
});

check('並列全收；權重能翻轉 top', () => {
  const t = need(); if (t) return t;
  const ratings = { p1: 2, p3: -1, p2: 0, p4: 1 };   // A (2−1)/2 → 25；B (0+1)/2 → 25
  const tie = run(ratings), flip = run(ratings, ['childcare']);   // A (4−1)/3 → 50；B (0+1)/3 → 17
  const tt = [...tie.top].sort().join(','), ft = flip.top.join(',');
  if (tt !== 'A,B') return `並列時 top 應為 A,B，實際 ${tt}（只取一個是最像的錯實作）`;
  if (ft !== 'A') return `childcare 標重要後 top 應為 A，實際 ${ft}`;
  return ok(true, `並列 ${tt} → 加權後 ${ft}`);
});

check('分數上下限：全 +2 → +100，全 −2 → −100', () => {
  const t = need(); if (t) return t;
  const all = v => Object.fromEntries(P.map(p => [p.id, v]));
  const hi = byId(run(all(2))), lo = byId(run(all(-2)));
  const errs = ['A', 'B', 'C'].flatMap(k => [eq(hi[k].score, 100, k + ' 全 +2'), eq(lo[k].score, -100, k + ' 全 −2')]).filter(x => x !== true);
  return errs.length ? errs.join('；') : ok(true, '三人都 +100 / −100');
});

check('可能範圍：lo ≤ score ≤ hi；分數全相同時 lo = hi = score；同一個種子結果相同', () => {
  const t = need(); if (t) return t;
  const a = byId(run(BASE, [], 11)).A, b = byId(run(BASE, [], 11)).A;
  if (!(a.lo <= a.score && a.score <= a.hi)) return `A：lo ${a.lo}、score ${a.score}、hi ${a.hi} 不滿足 lo ≤ score ≤ hi`;
  if (a.lo !== b.lo || a.hi !== b.hi) return `同種子兩次結果不同：[${a.lo},${a.hi}] vs [${b.lo},${b.hi}]（rng 沒有走 Math.random 或傳入的 rng）`;
  const same = byId(run({ p2: 1, p4: 1, p6: 1 })).B;
  if (!(same.lo === 50 && same.hi === 50 && same.score === 50)) return `B 三段都 +1：應 lo = hi = score = 50，實際 [${same.lo}, ${same.score}, ${same.hi}]`;
  // 範圍要真的有寬度：A 的兩段是 +2 與 +1，重抽會出現 50 或 100，10–90 百分位不會縮成一點。
  if (!(a.hi > a.lo)) return `A 的段落分數不同（+2、+1），範圍卻沒有寬度：[${a.lo}, ${a.hi}]`;
  return ok(true, `A ${a.score} ∈ [${a.lo}, ${a.hi}]；B 全 +1 → [${same.lo}, ${same.hi}]`);
});

check('捨入對稱：±12.5 → ±13，翻號結果剛好翻號', () => {
  const t = need(); if (t) return t;
  // 另一個選區：D、E 兩人四個議題都有提出。D 四段 +1、−1、−1、0 → 50 × (−1/4) = −12.5。
  const Q = ['a', 'b', 'c', 'd'].flatMap(i => [{ id: 'D' + i, issueId: i, candidateId: 'D' }, { id: 'E' + i, issueId: i, candidateId: 'E' }]);
  const neg = { Da: 1, Db: -1, Dc: -1, Dd: 0, Ea: 0, Eb: 0, Ec: 0, Ed: 0 };
  const pos = Object.fromEntries(Object.entries(neg).map(([k, v]) => [k, -v || 0]));
  const s = rr => byId(withSeed(3, () => mod.score({ passages: Q, ratings: rr, important: [] })));
  const n = s(neg), p = s(pos);
  // 最像的錯實作 Math.round：−12.5 → −12、+12.5 → +13，翻號後不對稱
  const errs = [eq(n.D.score, -13, 'D 總和 −1/4（若是 −12，用了 Math.round）'), eq(p.D.score, 13, 'D 翻號後'),
    eq(Object.is(n.E.score, -0) ? '-0' : n.E.score, 0, 'E 全 0（不能是 −0）')].filter(x => x !== true);
  return errs.length ? errs.join('；') : ok(true, `−12.5 → ${n.D.score}，+12.5 → ${p.D.score}`);
});

check('分數超出 −2..2 或不是整數會丟錯', () => {
  const t = need(); if (t) return t;
  // 先證明合法分數不丟錯：一個永遠丟錯的實作，否則這條也會是綠的（BE #1 回報）。
  for (const v of [-2, -1, 0, 1, 2, null]){ try { run({ p1: v }); } catch (e){ return `合法分數 ${JSON.stringify(v)} 也丟錯：${e.message}`; } }
  const bad = [3, -3, 1.5, '2'];
  const missed = bad.filter(v => { try { run({ p1: v }); return true; } catch { return false; } });
  return missed.length ? `沒有丟錯：${missed.map(v => JSON.stringify(v)).join('、')}` : ok(true, `${bad.length} 種壞分數都丟錯`);
});

check('verdict：same / different / none，並列時傾向在 top 裡算 same', () => {
  const t = need(); if (t) return t;
  const r = run(BASE);                                    // top = [A]
  const tie = run({ p1: 2, p3: -1, p2: 0, p4: 1 });       // top = [A, B]
  const empty = run({ p8: 2 });                           // 只打了加分題 → top 是空的
  if (empty.top.length) return `只打加分題時 top 應為空，實際 ${JSON.stringify(empty.top)}`;
  const cases = [['A', r, 'same'], ['B', r, 'different'], [null, r, 'none'], ['undecided', r, 'none'], ['private', r, 'none'], ['B', tie, 'same'], ['A', empty, 'none']];
  const errs = cases.map(([lean, res, want]) => eq(mod.verdict(lean, res), want, `verdict(${JSON.stringify(lean)})`)).filter(x => x !== true);
  return errs.length ? errs.join('；') : ok(true, `${cases.length} 個案例都對`);
});
