// tools/build_public.mjs — 產生 public/：covervote Worker 上傳的靜態站。BE 所有。
//
//   node tools/build_public.mjs [outDir]     預設 public/
//
// 版面：站台在 <outDir>/covervote/，路徑等於網址（games.csiesheep.com/covervote/…），
// 靜態檔由 Cloudflare 直接送、不經 Worker。複製 site/ 裡的頁面與 engine/，再寫：
//   covervote/race/<raceId>.json     每個選區開票前的題目資料：race { id, label, voteDate, dataAsOf }，
//                                    段落只有 PUBLIC_PASSAGE_FIELDS
//   covervote/issues.json            議題顯示名 [{ id, label }]（data/issues.json，FE 不自己放對照表）
//   covervote/cands/<raceId>.json    開票前的候選人名單 { race, candidates: [{ number, name, inPlay }] }，照號次、null 排最後
//                                    （owner 裁決 2026-10-21：獨立檔、只有號次與姓名、不帶任何段落對應；
//                                    inPlay = 這一都至少有一段，orchestrator 裁決 #6，猜作者選單只放 inPlay 的人）
//   covervote/reveal/<raceId>.json   開票檔 { race, passages: [{ id, candidate: { number, name }, original,
//                                    sourceUrl, sourceDate, sourceType }] }，開票時才 fetch
//                                    （orchestrator 裁決 #1：檔案公開可抓，v1 接受）
//   covervote/engine/                engine/ 原樣複製，頁面 `import './engine/score.mjs'`
//   covervote/version.txt            HEAD 的完整 SHA
//
// 開票前的 payload（race/、cands/）不得含任何能指出作者的東西（tests/acc_payload.mjs 守這條）。
// 三種檔都用白名單一欄一欄挑，不用展開整列：資料表多一欄，不會自己跑上前端。

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validate, PUBLIC_PASSAGE_FIELDS } from '../data/schema.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));

export function loadData(){
  return { elections: read('elections.json'), races: read('races.json'),
           candidates: read('candidates.json'), passages: read('passages.json'), issues: read('issues.json') };
}

const pick = (obj, keys) => Object.fromEntries(keys.map(k => [k, obj[k]]));

// race 帶 voteDate（該場選舉的投票日，倒數用）與 dataAsOf（這個選區段落 sourceDate 的最大值；沒有段落 → null）。
// 兩者都不指向作者（orchestrator 裁決 #3）。
export function racePayload(race, passages, elections = []){
  const ps = passages.filter(p => p.race === race.id);
  const election = elections.find(e => e.id === race.electionId);
  const dataAsOf = ps.reduce((m, p) => (m === null || p.sourceDate > m) ? p.sourceDate : m, null);
  return {
    race: { id: race.id, label: race.label, voteDate: election ? election.voteDate : null, dataAsOf },
    passages: ps.map(p => pick(p, PUBLIC_PASSAGE_FIELDS)),
  };
}

export const issuesPayload = issues => issues.map(i => ({ id: i.id, label: i.label }));

// 號次小的在前；null（未抽籤）排最後，null 之間照 data/candidates.json 的列順序（sort 是穩定的）。
const byNumber = (a, b) => (a.number === null) - (b.number === null) || (a.number ?? 0) - (b.number ?? 0);

// inPlay：這位候選人在這一都至少有一段（orchestrator 裁決 #6：猜作者選單只放有段落的人，
// 放進沒有段落的人會稀釋猜測、壓低猜中率，讓遮蔽看起來比實際好）。只是布林，不說哪一段是誰的。
export function candsPayload(race, candidates, passages){
  if (!Array.isArray(passages)) throw new Error('candsPayload 需要 passages 才算得出 inPlay');
  const hasPassage = new Set(passages.filter(p => p.race === race.id).map(p => p.candidateId));
  return {
    race: { id: race.id, label: race.label },
    candidates: candidates.filter(c => c.raceId === race.id).sort(byNumber)
      .map(c => ({ number: c.number, name: c.name, inPlay: hasPassage.has(c.id) })),
  };
}

export function revealPayload(race, passages, candidates){
  const byId = new Map(candidates.map(c => [c.id, c]));
  return {
    race: { id: race.id, label: race.label },
    passages: passages.filter(p => p.race === race.id).map(p => {
      const c = byId.get(p.candidateId);
      return { id: p.id, candidate: { number: c.number, name: c.name }, original: p.original,
               sourceUrl: p.sourceUrl, sourceDate: p.sourceDate, sourceType: p.sourceType };
    }),
  };
}

export function build(outDir = path.join(ROOT, 'public')){
  const data = loadData();
  const errs = validate(data);
  if (errs.length) throw new Error('資料驗證失敗：\n  ' + errs.join('\n  '));

  const site = path.join(outDir, 'covervote');
  fs.rmSync(outDir, { recursive: true, force: true });
  for (const d of ['race', 'cands', 'reveal']) fs.mkdirSync(path.join(site, d), { recursive: true });
  fs.cpSync(path.join(ROOT, 'site'), site, { recursive: true });
  fs.cpSync(path.join(ROOT, 'engine'), path.join(site, 'engine'), { recursive: true });

  const write = (dir, race, obj) => fs.writeFileSync(path.join(site, dir, race.id + '.json'), JSON.stringify(obj) + '\n');
  for (const race of data.races){
    write('race', race, racePayload(race, data.passages, data.elections));
    write('cands', race, candsPayload(race, data.candidates, data.passages));
    write('reveal', race, revealPayload(race, data.passages, data.candidates));
  }
  fs.writeFileSync(path.join(site, 'issues.json'), JSON.stringify(issuesPayload(data.issues)) + '\n');
  let sha = 'unknown';
  try { sha = execSync('git rev-parse HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
  fs.writeFileSync(path.join(site, 'version.txt'), sha + '\n');
  return { site, races: data.races.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])){
  const out = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
  const r = build(out);
  console.log(`build: ${r.races} 個選區 → ${path.relative(process.cwd(), r.site) || r.site}`);
}
