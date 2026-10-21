// data/schema.mjs — 資料欄位的唯一定義與驗證。BE 所有。
//
// 一場「選舉」(elections.json) 有多個「選區」(races.json)，每個選區有候選人(candidates.json)
// 與政見段落(passages.json)；段落的 issueId 都要在議題表(issues.json：[{ id, label }])裡。
// 候選人有 number（抽籤後的號次，正整數；未抽籤 null），同選區號次與姓名都不得重複（姓名是前端的鍵）。race id = `<electionId>.<office>.<district>`，所以 2028 總統、立委
// 或任何一場補選都只是多加幾列，不用改結構。
//
// 段落欄位照 plan 第四節：id, race, issueId, candidateId, original, masked, plain,
// sourceUrl, sourceDate, sourceType, length, guessStats。
// 只有 PUBLIC_PASSAGE_FIELDS 可以進開票前的前端 payload（tools/build_public.mjs）；
// 其他欄位（candidateId、original、sourceUrl、sourceDate、sourceType、guessStats）
// 都能直接或間接指出作者，只能在開票後出現。

export const OFFICES = ['mayor', 'county-magistrate', 'president', 'legislator', 'councilor'];
export const SOURCE_TYPES = ['gazette', 'campaign', 'facebook', 'press-rewritten'];
export const LENGTH_MIN = 60;   // plan 第一節：段落長度統一在 60–120 字
export const LENGTH_MAX = 120;

export const PASSAGE_FIELDS = ['id', 'race', 'issueId', 'candidateId', 'original', 'masked', 'plain',
  'sourceUrl', 'sourceDate', 'sourceType', 'length', 'guessStats'];
export const PUBLIC_PASSAGE_FIELDS = ['id', 'issueId', 'masked', 'plain', 'length'];

// 長度以 masked 的字數算（Unicode code point），不含空白。
export const textLength = s => [...String(s).replace(/\s/g, '')].length;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validate({ elections, races, candidates, passages, issues }){
  const errs = [];
  const ids = new Map();
  const uniq = (table, id) => {
    const key = table + ':' + id;
    if (ids.has(key)) errs.push(`${table} id 重複：${id}`);
    ids.set(key, true);
  };
  // 議題（issues.json）：[{ id, label }]，議題顯示名的唯一一份（orchestrator 裁決 #1／#3：FE 不自己放對照表）。
  if (!Array.isArray(issues)) errs.push('沒有 issues 表（data/issues.json）');
  const issueIds = new Set((issues || []).map(i => i.id));
  for (const i of issues || []){
    uniq('issue', i.id);
    if (!i.label) errs.push(`issue ${i.id}: 沒有 label`);
  }
  const electionIds = new Set(elections.map(e => e.id));
  for (const e of elections){
    uniq('election', e.id);
    if (!DATE.test(e.voteDate || '')) errs.push(`election ${e.id}: voteDate 不是 YYYY-MM-DD`);
  }
  const raceIds = new Set(races.map(r => r.id));
  for (const r of races){
    uniq('race', r.id);
    if (!electionIds.has(r.electionId)) errs.push(`race ${r.id}: electionId ${r.electionId} 不存在`);
    if (!OFFICES.includes(r.office)) errs.push(`race ${r.id}: office ${r.office} 不在 ${OFFICES.join('/')}`);
    if (r.id !== `${r.electionId}.${r.office}.${r.district}`) errs.push(`race ${r.id}: id 應為 electionId.office.district`);
  }
  const candById = new Map(candidates.map(c => [c.id, c]));
  const numberSeen = new Map();   // `${raceId}#${number}` → candidate id
  const nameSeen = new Map();     // `${raceId}#${name}` → candidate id
  for (const c of candidates){
    uniq('candidate', c.id);
    if (!raceIds.has(c.raceId)) errs.push(`candidate ${c.id}: raceId ${c.raceId} 不存在`);
    if (!c.name) errs.push(`candidate ${c.id}: 沒有 name`);
    // 姓名是前端的鍵（orchestrator 裁決 #1：cands/、reveal/ 不帶 id，契合分數與傾向都用姓名對）：同選區不得重複。
    else {
      const k = c.raceId + '#' + c.name;
      if (nameSeen.has(k)) errs.push(`candidate ${c.id}: 姓名「${c.name}」與 ${nameSeen.get(k)} 在 ${c.raceId} 重複（姓名是前端的鍵）`);
      else nameSeen.set(k, c.id);
    }
    // number：抽籤後的號次（正整數），抽籤前 null。欄位一定要在：缺欄位和「還沒抽籤」分不出來。
    if (!('number' in c)) errs.push(`candidate ${c.id}: 缺 number（未抽籤寫 null）`);
    else if (c.number !== null){
      if (!Number.isInteger(c.number) || c.number < 1) errs.push(`candidate ${c.id}: number ${JSON.stringify(c.number)} 應為正整數或 null`);
      else {
        const k = c.raceId + '#' + c.number;
        if (numberSeen.has(k)) errs.push(`candidate ${c.id}: number ${c.number} 與 ${numberSeen.get(k)} 在 ${c.raceId} 重複`);
        else numberSeen.set(k, c.id);
      }
    }
  }
  for (const p of passages){
    uniq('passage', p.id);
    const missing = PASSAGE_FIELDS.filter(f => !(f in p));
    if (missing.length) errs.push(`passage ${p.id}: 缺欄位 ${missing.join(', ')}`);
    const extra = Object.keys(p).filter(f => !PASSAGE_FIELDS.includes(f));
    if (extra.length) errs.push(`passage ${p.id}: 多出欄位 ${extra.join(', ')}`);
    if (!raceIds.has(p.race)) errs.push(`passage ${p.id}: race ${p.race} 不存在`);
    if (Array.isArray(issues) && !issueIds.has(p.issueId)) errs.push(`passage ${p.id}: issueId ${p.issueId} 不在 data/issues.json`);
    const c = candById.get(p.candidateId);
    if (!c) errs.push(`passage ${p.id}: candidateId ${p.candidateId} 不存在`);
    else if (c.raceId !== p.race) errs.push(`passage ${p.id}: 候選人 ${p.candidateId} 不在 ${p.race}`);
    if (!SOURCE_TYPES.includes(p.sourceType)) errs.push(`passage ${p.id}: sourceType ${p.sourceType} 不在 ${SOURCE_TYPES.join('/')}`);
    if (!DATE.test(p.sourceDate || '')) errs.push(`passage ${p.id}: sourceDate 不是 YYYY-MM-DD`);
    const n = textLength(p.masked);
    if (p.length !== n) errs.push(`passage ${p.id}: length 寫 ${p.length}，masked 實際 ${n} 字`);
    if (n < LENGTH_MIN || n > LENGTH_MAX) errs.push(`passage ${p.id}: masked ${n} 字，不在 ${LENGTH_MIN}–${LENGTH_MAX}`);
    const g = p.guessStats;
    if (!g || !Number.isInteger(g.answers) || !Number.isInteger(g.correct) || g.correct > g.answers)
      errs.push(`passage ${p.id}: guessStats 應為 { answers, correct } 且 correct ≤ answers`);
  }
  return errs;
}
