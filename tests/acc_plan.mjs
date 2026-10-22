// tests/acc_plan.mjs — 出題計畫 site/data.js 的 buildPlan：議題順序與牌序都要隨機、但同一局穩定。orchestrator 所有（issue #24）。
//
// owner 裁決（2026-10-21，原話）：「議題每次隨機」。由來：orchestrator 發現議題順序是固定的（照資料檔順序，每位玩家都一樣），
// 會有順序效應——前幾題最認真看、後面草率或中途離開。
// 規格：
//   1. 同一個 seed → 完全相同的計畫（重新整理、回上一步不會換題）。
//   2. 不同 seed → 議題順序不同：50 個 seed 裡，第一題至少出現 3 種不同議題。
//   3. 每個計分議題恰好出現一次；加分題（只有一人提出）不進輪次。
//   4. 每一輪內的牌序（甲乙丙）也隨 seed 變，而且不同輪之間獨立：同一個 seed 下「甲」不總是同一位候選人。
import { section, check, ok, importOrNull } from './harness.js';

const mod = await importOrNull('../site/data.js');
const STRICT_24 = true;   // #24 land 時翻

// 三位候選人 A、B、C，五個議題都三人提出，外加一個只有 C 提出的加分題。
const ISSUES = ['i1', 'i2', 'i3', 'i4', 'i5'];
const P = ISSUES.flatMap(i => ['A', 'B', 'C'].map(c => ({ id: `${i}-${c}`, issueId: i, candidateId: c }))).concat([{ id: 'x-C', issueId: 'solo', candidateId: 'C' }]);
const plan = s => mod.buildPlan(P, s);
const order = pl => pl.rounds.map(r => r.issueId).join(',');

section('出題計畫（#24）');

check('同一個 seed → 相同計畫；每個計分議題恰好一次；加分題不進輪次', () => {
  if (!mod?.buildPlan) return 'site/data.js 沒有 export buildPlan';
  const a = plan(12345), b = plan(12345);
  if (JSON.stringify(a) !== JSON.stringify(b)) return '同一個 seed 兩次結果不同（重新整理會換題）';
  const ids = a.rounds.map(r => r.issueId).sort().join(',');
  if (ids !== ISSUES.join(',')) return `輪次的議題應為 ${ISSUES.join(',')}，實際 ${ids}`;
  if (a.rounds.some(r => r.issueId === 'solo')) return '加分題不應進輪次';
  return ok(true, `${a.rounds.length} 輪、加分題 ${a.bonus.length} 段`);
});

check('不同 seed → 議題順序不同（50 個 seed 裡第一題至少 3 種）', () => {
  if (!mod?.buildPlan) return 'site/data.js 沒有 export buildPlan';
  const firsts = new Set(), orders = new Set();
  for (let s = 1; s <= 50; s++){ const pl = plan(s * 7919); firsts.add(pl.rounds[0].issueId); orders.add(order(pl)); }
  if (firsts.size < 3) return (STRICT_24 ? '' : 'TODO: ') + `議題順序沒有隨機：50 個 seed 的第一題只有 ${firsts.size} 種（${[...firsts].join('、')}），共 ${orders.size} 種順序`;
  return ok(true, `第一題 ${firsts.size} 種、順序 ${orders.size} 種`);
});

// #28：選單順序照 cands/ 的順序（先藍後綠再其他，由 build 排好），不再隨機（owner 2026-10-21：「請向投給誰 先藍後綠再其他」）。
const STRICT_28P = false;
check('menuOrder 照 cands/ 給的順序，不隨 seed 變', () => {
  if (!mod?.menuOrder) return 'site/data.js 沒有 export menuOrder';
  const cs = [{ name: '丙', number: null }, { name: '甲', number: null }, { name: '乙', number: null }];
  const want = '丙,甲,乙';
  const outs = new Set();
  for (let s = 1; s <= 20; s++) outs.add(mod.menuOrder(cs, null, s * 31).join(','));
  if (outs.size !== 1 || !outs.has(want)) return (STRICT_28P ? '' : 'TODO: ') + `應永遠是 ${want}（cands/ 的順序），實際 ${outs.size} 種：${[...outs].slice(0, 3).join(' | ')}`;
  return ok(true, `20 個 seed 都是 ${want}`);
});

check('每輪的牌序隨 seed 變，且不同輪之間獨立', () => {
  if (!mod?.buildPlan) return 'site/data.js 沒有 export buildPlan';
  const firstSeat = new Set();
  let sameAcrossRounds = 0;
  for (let s = 1; s <= 50; s++){
    const pl = plan(s * 104729);
    firstSeat.add(pl.rounds[0].cards[0].candidateId);
    const jia = pl.rounds.map(r => r.cards[0].candidateId);
    if (new Set(jia).size === 1) sameAcrossRounds++;
  }
  if (firstSeat.size < 3) return `第一輪的「甲」在 50 個 seed 裡只出現 ${firstSeat.size} 位候選人`;
  // 五輪的甲都同一人的機率是 (1/3)^4 ≈ 1.2%；50 次裡超過 5 次就是各輪沒有獨立打亂。
  if (sameAcrossRounds > 5) return `50 個 seed 裡有 ${sameAcrossRounds} 次五輪的「甲」都是同一人（各輪的牌序沒有獨立）`;
  return ok(true, `第一輪的甲出現 ${firstSeat.size} 位；五輪甲同一人 ${sameAcrossRounds}/50`);
});
