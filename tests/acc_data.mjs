// tests/acc_data.mjs — 六都題目資料的驗收。orchestrator 所有（issue #2）。
//
// 規格（owner 2026-10-21 定案走 A：v1 只做六都，11/1 上線用競選來源，11/15 補公報）：
//   - 六個選區、id 照 `<electionId>.<office>.<district>`（TEAM.md 約束）。
//   - 每個選區：計分議題（≥ 2 位候選人提出）≥ COUNTED_ISSUES_MIN 個；每位有段落的候選人計分段落 ≥ PER_CAND_MIN。
//   - 每位候選人每個議題只收一段。
//   - 遮蔽：masked 與 plain 不得出現同選區任何候選人的全名或名、任何政黨名稱。
//   - 出處：sourceUrl 是 https，不是假網址；正式資料裡沒有測試用的候選人。
//
// 三態：資料還沒進來時，覆蓋類的檢查是 TODO；遮蔽類的檢查現在就是真的（母體是現有段落）。
// STRICT 在 #2 land 的那一次翻成 true：之後某一都的資料被刪掉，要紅，不是安靜地退回 TODO。
import { section, check, ok, nonEmpty } from './harness.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STRICT = false;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const races = src('races.json'), candidates = src('candidates.json'), passages = src('passages.json');

const RACES = ['taipei', 'newtaipei', 'taoyuan', 'taichung', 'tainan', 'kaohsiung'].map(d => `2026-local.mayor.${d}`);
const COUNTED_ISSUES_MIN = 6;
const PER_CAND_MIN = 3;
const PARTIES = ['中國國民黨', '國民黨', '民主進步黨', '民進黨', '台灣民眾黨', '臺灣民眾黨', '民眾黨', '時代力量', '台灣基進', '臺灣基進',
  '親民黨', '綠黨', '社會民主黨', '新黨', '無黨團結聯盟', '台灣團結聯盟', '臺灣團結聯盟', '台聯', '小民參政歐巴桑聯盟',
  'KMT', 'DPP', 'TPP', 'NPP'];
const FAKE_URL = /example\.(invalid|com|org)|localhost/i;

const notYet = what => STRICT ? what : 'TODO: ' + what;
const nameTokens = c => { const n = [...c.name]; return n.length >= 3 ? [c.name, n.slice(1).join('')] : [c.name]; };

section('六都資料（#2）');

check('六個選區都在', () => {
  const have = new Set(races.map(r => r.id));
  const missing = RACES.filter(id => !have.has(id));
  return missing.length ? notYet(`還沒有 ${missing.length} 個選區：${missing.join('、')}`) : ok(true, `6 個選區：${RACES.map(r => r.split('.').pop()).join('、')}`);
});

for (const raceId of RACES){
  const d = raceId.split('.').pop();
  check(`${d}：計分議題 ≥ ${COUNTED_ISSUES_MIN}、每位候選人計分段落 ≥ ${PER_CAND_MIN}`, () => {
    const ps = passages.filter(p => p.race === raceId);
    if (!ps.length) return notYet(`${raceId} 沒有段落`);
    const byIssue = new Map();
    for (const p of ps){ if (!byIssue.has(p.issueId)) byIssue.set(p.issueId, new Set()); byIssue.get(p.issueId).add(p.candidateId); }
    const counted = [...byIssue].filter(([, s]) => s.size >= 2).map(([i]) => i);
    const cands = [...new Set(ps.map(p => p.candidateId))];
    const thin = cands.map(c => [c, ps.filter(p => p.candidateId === c && counted.includes(p.issueId)).length]).filter(([, n]) => n < PER_CAND_MIN);
    const errs = [];
    if (counted.length < COUNTED_ISSUES_MIN) errs.push(`計分議題只有 ${counted.length} 個（${counted.join('、') || '無'}）`);
    if (thin.length) errs.push(`計分段落不足：${thin.map(([c, n]) => `${c} ${n} 段`).join('、')}`);
    return errs.length ? notYet(errs.join('；')) : ok(true, `${cands.length} 位候選人、${counted.length} 個計分議題、${ps.length} 段`);
  });
}

check('每位候選人每個議題只收一段', () => {
  const ne = nonEmpty(passages.length, 'data/passages.json 的段落'); if (ne !== true) return ne;
  const seen = new Map(), dup = [];
  for (const p of passages){ const k = `${p.race}|${p.issueId}|${p.candidateId}`; if (seen.has(k)) dup.push(`${seen.get(k)} 與 ${p.id}`); else seen.set(k, p.id); }
  return dup.length ? `同一人同一議題有多段：${dup.slice(0, 6).join('；')}` : ok(true, `${passages.length} 段，沒有重複`);
});

check('遮蔽：masked 與 plain 沒有同選區候選人的名字、沒有政黨名', () => {
  const ne = nonEmpty(passages.length, 'data/passages.json 的段落'); if (ne !== true) return ne;
  const leaks = [];
  for (const p of passages){
    const names = candidates.filter(c => c.raceId === p.race).flatMap(nameTokens);
    if (!names.length) return `選區 ${p.race} 沒有候選人，名字檢查的母體是空的`;
    for (const field of ['masked', 'plain']){
      const text = String(p[field] || '');
      for (const tok of [...names, ...PARTIES]) if (text.includes(tok)) leaks.push(`${p.id}.${field} 含「${tok}」`);
    }
  }
  return leaks.length ? `${leaks.length} 處洩漏：${leaks.slice(0, 8).join('；')}` : ok(true, `${passages.length} 段 × 2 欄都沒有名字或黨名`);
});

check('出處是 https 而且不是假網址；沒有測試候選人', () => {
  const ne = nonEmpty(passages.length, 'data/passages.json 的段落'); if (ne !== true) return ne;
  const badUrl = passages.filter(p => !/^https:\/\//.test(p.sourceUrl || '') || FAKE_URL.test(p.sourceUrl)).map(p => `${p.id} ${p.sourceUrl}`);
  const fakeCand = candidates.filter(c => /測試/.test(c.name) || /^c-test/.test(c.id)).map(c => c.id);
  const errs = [];
  if (badUrl.length) errs.push(`出處不合格 ${badUrl.length} 段：${badUrl.slice(0, 4).join('；')}`);
  if (fakeCand.length) errs.push(`還有測試候選人：${fakeCand.join('、')}`);
  return errs.length ? notYet(errs.join('；')) : ok(true, `${passages.length} 段出處都是 https 真網址`);
});
