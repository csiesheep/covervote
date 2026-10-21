// tools/build_public.mjs — 產生 public/：covervote Worker 上傳的靜態站。BE 所有。
//
//   node tools/build_public.mjs [outDir]     預設 public/
//
// 版面：站台在 <outDir>/covervote/，路徑等於網址（games.csiesheep.com/covervote/…），
// 靜態檔由 Cloudflare 直接送、不經 Worker。只複製 site/ 裡的頁面，再寫：
//   covervote/race/<raceId>.json   每個選區開票前的題目資料（只有 PUBLIC_PASSAGE_FIELDS）
//   covervote/version.txt          HEAD 的完整 SHA
//
// 開票前的 payload 不得含任何能指出作者的東西（tests/acc_payload.mjs 守這條）。
// 開票用的 passageId → candidateId 對照不在這裡產生，之後另外設計。

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validate, PUBLIC_PASSAGE_FIELDS } from '../data/schema.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));

export function loadData(){
  return { elections: read('elections.json'), races: read('races.json'),
           candidates: read('candidates.json'), passages: read('passages.json') };
}

const pick = (obj, keys) => Object.fromEntries(keys.map(k => [k, obj[k]]));

export function racePayload(race, passages){
  return {
    race: { id: race.id, label: race.label },
    passages: passages.filter(p => p.race === race.id).map(p => pick(p, PUBLIC_PASSAGE_FIELDS)),
  };
}

export function build(outDir = path.join(ROOT, 'public')){
  const data = loadData();
  const errs = validate(data);
  if (errs.length) throw new Error('資料驗證失敗：\n  ' + errs.join('\n  '));

  const site = path.join(outDir, 'covervote');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(site, 'race'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'site'), site, { recursive: true });

  for (const race of data.races){
    fs.writeFileSync(path.join(site, 'race', race.id + '.json'),
      JSON.stringify(racePayload(race, data.passages)) + '\n');
  }
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
