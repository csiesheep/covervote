// engine/score.mjs — 契合分數。BE 所有（orchestrator 裁決 #1：engine/ 歸 BE，FE 只呼叫、不自己算）。
//
// 純 ES module：不 import 任何東西（不碰 node:、不碰 DOM）。build 把 engine/ 複製到 covervote/engine/，
// 頁面直接載入 covervote/engine/score.mjs。
// （註解裡不要寫出「import 加引號路徑」的字樣：tools/check_public_imports.mjs 用正規式掃，會把註解當成 import。）
// 規格（issue #1；驗收 tests/acc_score.mjs 檔頭的 8 條，設計稿 D4「契合分數怎麼算」）：
//   1. 每段分數是 −2..+2 的整數；沒有分數（跳過）的段落不算，不是當 0 算。
//   2. 一個議題要有 ≥ 2 位候選人提出段落才計分；只有一人提出的是「加分題」，不計分。
//      「提出」看的是傳進來的 passages（同一個選區），不看玩家打了哪幾段。
//   3. 標成重要的議題，那一段權重 2，其他 1。
//   4. 候選人分數 = round(50 × 加權平均)，落在 −100..+100；沒有任何計分段落 → null。
//   5. n = 計分段落數（不加權）；n < 3 → lowConfidence。
//   6. 可能範圍 [lo, hi]：bootstrap 1000 次、取第 10 與第 90 百分位，再保證 lo ≤ score ≤ hi。
//   7. top = 分數最高的候選人（並列全收），null 不算。
//   8. verdict(lean, result)：lean 為 null／'undecided'／'private' → 'none'；lean 在 top 裡 → 'same'；否則 'different'。
//      orchestrator 裁決（#33）：top 有 ≥ 2 人且含 lean → 'tie'（「你的人跟另一位一樣契合」不是「名字蓋起來你還是選他」，
//      算進 same 會把全體統計的 same 灌高）。top 只有 1 人照舊 same／different；不含 lean 的並列照舊 'different'。
//
// orchestrator 裁決（#1，回 BE 的提問）：
//   - 捨入：遠離 0 的對稱捨入（−12.5 → −13、+12.5 → +13），−0 寫成 0；bootstrap 每次重抽用同一個捨入。
//   - 百分位：nearest-rank（1000 次排序後第 100 與第 900 個），再把 score 夾進 [lo, hi]。
//   - ratings[id] 為 null 當作跳過。
//   - top 為空時 verdict 回 'none'。
//   - 候選人的鍵：FE 用姓名當 candidateId、傾向也存姓名（cands/、reveal/ 都不帶 id）。
//     引擎只把它當不透明的字串，不假設長相；同選區姓名不重複由 data/schema.mjs 的 validate() 守。

export const WEIGHT_IMPORTANT = 2;
export const MIN_PROPOSERS = 2;        // 規則 2
export const LOW_CONFIDENCE_N = 3;     // 規則 5
export const BOOTSTRAP_RUNS = 1000;    // 規則 6
export const PCT_LO = 0.10, PCT_HI = 0.90;
const NO_LEAN = new Set(['undecided', 'private']);

// 遠離 0 的對稱捨入；結果是 −0 時回 0。
export function roundHalfAway(x){
  const r = Math.sign(x) * Math.round(Math.abs(x));
  return r === 0 ? 0 : r;
}

const toScore = (sumWR, sumW) => roundHalfAway(50 * sumWR / sumW);

function checkRating(id, v){
  if (!Number.isInteger(v) || v < -2 || v > 2)
    throw new Error(`score: 段落 ${id} 的分數 ${JSON.stringify(v)} 不是 −2..2 的整數`);
}

// 第 p 百分位（nearest-rank），sorted 已排序、非空。
function percentile(sorted, p){
  const k = Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length)));
  return sorted[k - 1];
}

export function score({ passages = [], ratings = {}, important = [] } = {}, opts = {}){
  const rng = (opts && opts.rng) || Math.random;   // 呼叫時才讀 Math.random（可被種子替換）
  const imp = new Set(important);

  // 先驗所有分數（含加分題、含不在 passages 裡的 id）：壞資料不准安靜地被忽略。
  for (const [id, v] of Object.entries(ratings || {})) if (v !== null && v !== undefined) checkRating(id, v);

  // 規則 2：每個議題有幾位候選人提出。
  const proposers = new Map();
  const order = [];
  for (const p of passages){
    if (!proposers.has(p.issueId)) proposers.set(p.issueId, new Set());
    proposers.get(p.issueId).add(p.candidateId);
    if (!order.includes(p.candidateId)) order.push(p.candidateId);
  }
  const counted = issueId => proposers.get(issueId).size >= MIN_PROPOSERS;

  // 每位候選人的計分段落：[ { r, w } ]。
  const items = new Map(order.map(c => [c, []]));
  for (const p of passages){
    const r = ratings ? ratings[p.id] : undefined;
    if (r === undefined || r === null) continue;      // 規則 1：跳過不算
    if (!counted(p.issueId)) continue;                // 規則 2：加分題不計分
    items.get(p.candidateId).push({ r, w: imp.has(p.issueId) ? WEIGHT_IMPORTANT : 1 });
  }

  const candidates = order.map(candidateId => {
    const xs = items.get(candidateId);
    const n = xs.length;
    if (!n) return { candidateId, score: null, n: 0, lo: null, hi: null, lowConfidence: true };
    let sWR = 0, sW = 0;
    for (const { r, w } of xs){ sWR += w * r; sW += w; }
    const s = toScore(sWR, sW);
    // 規則 6：有放回重抽 n 段（帶權重），算同一個分數，重複 BOOTSTRAP_RUNS 次。
    const boot = new Array(BOOTSTRAP_RUNS);
    for (let b = 0; b < BOOTSTRAP_RUNS; b++){
      let bWR = 0, bW = 0;
      for (let i = 0; i < n; i++){
        const x = xs[Math.min(n - 1, Math.floor(rng() * n))];
        bWR += x.w * x.r; bW += x.w;
      }
      boot[b] = toScore(bWR, bW);
    }
    boot.sort((a, b) => a - b);
    const lo = Math.min(percentile(boot, PCT_LO), s);
    const hi = Math.max(percentile(boot, PCT_HI), s);
    return { candidateId, score: s, n, lo, hi, lowConfidence: n < LOW_CONFIDENCE_N };
  });

  // 規則 7：最高分，並列全收；null 不算。
  const scored = candidates.filter(c => c.score !== null);
  const best = scored.length ? Math.max(...scored.map(c => c.score)) : null;
  const top = scored.filter(c => c.score === best).map(c => c.candidateId);
  return { candidates, top };
}

export function verdict(lean, result){
  if (lean === null || lean === undefined || NO_LEAN.has(lean)) return 'none';
  const top = (result && result.top) || [];
  if (!top.length) return 'none';   // orchestrator 裁決 #1：沒有任何計分段落，說「不同」是錯的結論
  if (!top.includes(lean)) return 'different';
  return top.length >= 2 ? 'tie' : 'same';   // orchestrator 裁決 #33：並列且含傾向是「一樣契合」，不是 same
}
