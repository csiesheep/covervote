// tools/cands_selftest.mjs — BE 自己的檢查（#37）：cands/ 的每位候選人帶粗分組 group，細黨名不外流。BE 所有。
//   node tools/cands_selftest.mjs     （npm run test:be）
//
// 期望值從 issue #37 的裁決文字抄，不從 build_public.mjs 讀規則：
//   orchestrator 裁決（#37）：「只分三組 group ∈ {kmt, dpp, oth}；小黨、無黨籍一律 oth；data 裡細的 party 值不得出現在任何前端檔」。
//   不可協商：「race/、reveal/ 不加政黨；cands/ 順序（先藍後綠再其他）不變」。
// 資料用自造的小表，不讀 data/：要能放進正式資料裡沒有的刁鑽 party 值（原型上的名字、缺欄位、剛好叫 oth 的黨）。
import { candsPayload, racePayload, revealPayload } from './build_public.mjs';

const race = { id: 'x.mayor.t', label: '測試市', electionId: 'x' };
// 每一列手寫期望的 group（照裁決的文字：kmt → kmt、dpp → dpp、其他任何值或沒有 party → oth）
const rows = [
  { id: 'c1', raceId: race.id, name: '甲', number: 3,    party: 'dpp',         want: 'dpp' },
  { id: 'c2', raceId: race.id, name: '乙', number: 1,    party: 'tpp',         want: 'oth' },
  { id: 'c3', raceId: race.id, name: '丙', number: 2,    party: 'kmt',         want: 'kmt' },
  { id: 'c4', raceId: race.id, name: '丁', number: null, party: 'independent', want: 'oth' },
  { id: 'c5', raceId: race.id, name: '戊', number: 4,    party: 'constructor', want: 'oth' },
  { id: 'c6', raceId: race.id, name: '己', number: 5,    party: 'toString',    want: 'oth' },
  { id: 'c7', raceId: race.id, name: '庚', number: 6,                          want: 'oth' },
  { id: 'c8', raceId: race.id, name: '辛', number: 7,    party: 'oth',         want: 'oth' },
  { id: 'c9', raceId: race.id, name: '壬', number: 8,    party: '__proto__',   want: 'oth' },
  { id: 'z1', raceId: 'y.mayor.u', name: '別都', number: 1, party: 'kmt',      want: 'kmt' },
];
const candidates = rows.map(({ want, ...c }) => c);
const passages = [
  { id: 'p1', race: race.id, issueId: 'i1', candidateId: 'c1', original: 'o', masked: 'm', plain: 'p', length: 1,
    sourceUrl: 'https://example.org/1', sourceDate: '2026-10-01', sourceType: 'web' },
  { id: 'p2', race: race.id, issueId: 'i1', candidateId: 'c2', original: 'o', masked: 'm', plain: 'p', length: 1,
    sourceUrl: 'https://example.org/2', sourceDate: '2026-10-02', sourceType: 'web' },
];
// 裁決的順序（#28／#29，手排）：kmt（丙）→ dpp（甲）→ 其他照號次、null 最後：乙1 戊4 己5 庚6 辛7 壬8 丁null
const WANT_ORDER = '丙,甲,乙,戊,己,庚,辛,壬,丁';
const FINE = ['tpp', 'independent', 'constructor', 'toString', '__proto__'];   // 'oth' 本身就是合法的 group 值，不算細黨名

const fails = [];
const check = (name, fn) => { try { const r = fn(); if (r !== true) fails.push(`${name}：${r}`); } catch (e) { fails.push(`${name}：丟出 ${e.message}`); } };

const out = candsPayload(race, candidates, passages);
const text = JSON.stringify(out);

check('每位候選人有 group，值照裁決', () => {
  const bad = [];
  for (const r of rows.filter(r => r.raceId === race.id)){
    const c = out.candidates.find(x => x.name === r.name);
    if (!c) { bad.push(`${r.name} 不在名單`); continue; }
    if (c.group !== r.want) bad.push(`${r.name}（party ${JSON.stringify(r.party)}）group ${JSON.stringify(c.group)} ≠ ${r.want}`);
  }
  return bad.length ? bad.join('；') : true;
});
check('group 只有 kmt／dpp／oth 三種', () => {
  const vals = [...new Set(out.candidates.map(c => c.group))].filter(g => !['kmt', 'dpp', 'oth'].includes(g));
  return vals.length ? `出現 ${vals.map(v => String(JSON.stringify(v))).join('、')}` : true;
});
check('候選人欄位只有 number、name、inPlay、group', () => {
  const extra = [...new Set(out.candidates.flatMap(c => Object.keys(c)))].filter(k => !['number', 'name', 'inPlay', 'group'].includes(k));
  return extra.length ? `多了 ${extra.join('、')}` : true;
});
check('細黨名與 party 欄位都不出現在 cands/', () => {
  const hits = FINE.filter(f => text.includes(`"${f}"`));
  if (text.includes('"party"')) hits.push('party 欄位');
  return hits.length ? `出現 ${hits.join('、')}` : true;
});
check('順序照舊：先藍、後綠、再其他（組內號次、null 最後）', () => {
  const got = out.candidates.map(c => c.name).join(',');
  return got === WANT_ORDER ? true : `${got} ≠ ${WANT_ORDER}`;
});
check('inPlay 照舊', () => {
  const got = out.candidates.filter(c => c.inPlay).map(c => c.name).sort().join(',');
  return got === '乙,甲' ? true : `inPlay 的人是 ${got}，應為 乙,甲`;
});
check('race/ 與 reveal/ 沒有任何政黨資訊', () => {
  const t = JSON.stringify(racePayload(race, passages, [])) + JSON.stringify(revealPayload(race, passages, candidates));
  const hits = ['"group"', '"party"', '"kmt"', '"dpp"', '"oth"', ...FINE.map(f => `"${f}"`)].filter(s => t.includes(s));
  return hits.length ? `出現 ${hits.join('、')}` : true;
});

if (fails.length){ console.log('cands_selftest FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('cands_selftest OK（7 項）');
