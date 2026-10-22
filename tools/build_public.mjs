// tools/build_public.mjs — 產生 public/：covervote Worker 上傳的靜態站。BE 所有。
//
//   node tools/build_public.mjs [outDir]     預設 public/
//
// 版面：站台在 <outDir>/covervote/，路徑等於網址（games.csiesheep.com/covervote/…），
// 靜態檔由 Cloudflare 直接送、不經 Worker。複製 site/ 裡的頁面與 engine/，再寫：
//   covervote/race/<raceId>.json     每個選區開票前的題目資料：race { id, label, voteDate, dataAsOf }，
//                                    段落只有 PUBLIC_PASSAGE_FIELDS
//   covervote/issues.json            議題顯示名 [{ id, label }]（data/issues.json，FE 不自己放對照表）
//   covervote/cands/<raceId>.json    開票前的候選人名單 { race, candidates: [{ number, name, inPlay, group }] }，先藍、後綠、再其他，組內照號次、null 排最後（#29）
//                                    （owner 裁決 2026-10-21：獨立檔、只有號次與姓名、不帶任何段落對應；
//                                    inPlay = 這一都至少有一段，orchestrator 裁決 #6，猜作者選單只放 inPlay 的人；
//                                    group ∈ kmt／dpp／oth，政黨色用，orchestrator 裁決 #37，細的 party 值不上前端）
//   covervote/reveal/<raceId>.json   開票檔 { race, passages: [{ id, candidate: { number, name }, original,
//                                    sourceUrl, sourceDate, sourceType }] }，開票時才 fetch
//                                    （orchestrator 裁決 #1：檔案公開可抓，v1 接受）
//   covervote/engine/                engine/ 原樣複製，頁面 `import './engine/score.mjs'`
//   covervote/version.txt            HEAD 的完整 SHA
//   _headers                         （assets 目錄的根）每一頁 HTML 的 Cache-Control 加 no-transform（#14）：
//                                    Cloudflare 帳號層級的 Web Analytics 會在線上 HTML 自動插入 beacon.min.js，
//                                    帶 no-transform 的回應它不改寫。只列 HTML 的網址，其他檔維持預設快取。
//
// 開票前的 payload（race/、cands/）不得含任何能指出作者的東西（tests/acc_payload.mjs 守這條）。
// 政黨只以粗分組 group 出現在 cands/（名字本來就公開，不洩漏哪一段是誰的）；race/、reveal/ 沒有任何政黨資訊（#37）。
// 三種檔都用白名單一欄一欄挑，不用展開整列：資料表多一欄，不會自己跑上前端。

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validate, PUBLIC_PASSAGE_FIELDS } from '../data/schema.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));

export function loadData(){
  return { elections: read('elections.json'), races: read('races.json'),
           candidates: read('candidates.json'), passages: read('passages.json'), issues: read('issues.json') };
}

const pick = (obj, keys) => Object.fromEntries(keys.map(k => [k, obj[k]]));

// 段落順序（審查 #2，issue #32）：照 sha256(段落 id) 排，跟作者、跟 data/passages.json 的列順序都無關。
// 資料檔是 writer 一位候選人一位候選人填的，照列順序輸出時每個議題的第一段幾乎都是同一人，DevTools 裡就能把段落分成兩組。
// 不直接照 id 字串排：id 現在是亂碼，但哪天改成 p-taipei-c1-01 這種有序的 id，字串排序就又按作者分組了；雜湊不會。
// 固定的雜湊、不用亂數：同一份資料每次 build 出一樣的位元組（部署後要逐位元組比對）。
const orderKey = id => createHash('sha256').update(String(id)).digest('hex');
export const payloadOrder = ps => ps.map(p => [orderKey(p.id), p]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0).map(x => x[1]);

// race 帶 voteDate（該場選舉的投票日，倒數用）與 dataAsOf（這個選區段落 sourceDate 的最大值；沒有段落 → null）。
// 兩者都不指向作者（orchestrator 裁決 #3）。
export function racePayload(race, passages, elections = []){
  const ps = payloadOrder(passages.filter(p => p.race === race.id));
  const election = elections.find(e => e.id === race.electionId);
  const dataAsOf = ps.reduce((m, p) => (m === null || p.sourceDate > m) ? p.sourceDate : m, null);
  return {
    race: { id: race.id, label: race.label, voteDate: election ? election.voteDate : null, dataAsOf },
    passages: ps.map(p => pick(p, PUBLIC_PASSAGE_FIELDS)),
  };
}

export const issuesPayload = issues => issues.map(i => ({ id: i.id, label: i.label }));

// 名單順序（owner 裁決 2026-10-21，#28／#29：「請向投給誰 先藍後綠再其他」）：
//   1. party：'kmt'（藍）→ 'dpp'（綠）→ 其他任何值（含還沒填 party 的列）
//   2. 同一組裡號次小的在前；null（未抽籤）排最後
//   3. 再照 data/candidates.json 的列順序（Array.prototype.sort 是穩定的）
// 細的 party 值不寫進任何前端檔（cands/、reveal/ 都用白名單挑欄位）；cands/ 只帶由它算出的粗分組 group（#37）。
export const PARTY_RANK = { kmt: 0, dpp: 1 };
const partyRank = c => Object.hasOwn(PARTY_RANK, c.party) ? PARTY_RANK[c.party] : 2;   // hasOwn：'constructor' 之類不會撈到原型

// 粗分組（orchestrator 裁決 #37：只分三組 kmt／dpp／oth，小黨、無黨籍一律 oth）。前端用它上政黨色；
// 細黨名不外流，免得替小黨標錯、或讓前端各自配色。跟 PARTY_RANK 同一個判斷：排序的「其他」就是 oth。
export const partyGroup = c => Object.hasOwn(PARTY_RANK, c.party) ? c.party : 'oth';
const byNumber = (a, b) => (a.number === null) - (b.number === null) || (a.number ?? 0) - (b.number ?? 0);
export const byMenuOrder = (a, b) => partyRank(a) - partyRank(b) || byNumber(a, b);

// inPlay：這位候選人在這一都至少有一段（orchestrator 裁決 #6：猜作者選單只放有段落的人，
// 放進沒有段落的人會稀釋猜測、壓低猜中率，讓遮蔽看起來比實際好）。只是布林，不說哪一段是誰的。
export function candsPayload(race, candidates, passages){
  if (!Array.isArray(passages)) throw new Error('candsPayload 需要 passages 才算得出 inPlay');
  const hasPassage = new Set(passages.filter(p => p.race === race.id).map(p => p.candidateId));
  return {
    race: { id: race.id, label: race.label },
    candidates: candidates.filter(c => c.raceId === race.id).sort(byMenuOrder)
      .map(c => ({ number: c.number, name: c.name, inPlay: hasPassage.has(c.id), group: partyGroup(c) })),
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

// Workers static assets 對每個檔的預設是 `public, max-age=0, must-revalidate`；_headers 設的 Cache-Control 取代預設，
// 所以整串寫出來、只多 no-transform。網址照 html_handling 的預設 auto-trailing-slash：dir/index.html 在 dir/，
// x.html 在 x；.html 的網址會 307 過去，一起列（便宜，也不怕之後改 html_handling）。
export const HTML_CACHE_CONTROL = 'public, max-age=0, must-revalidate, no-transform';

export function headersFile(htmlPaths){
  const urls = htmlPaths.flatMap(p => p.endsWith('/index.html') ? [p.slice(0, -'index.html'.length), p]
                                                              : [p.slice(0, -'.html'.length), p]);
  return '# tools/build_public.mjs 產生（#14）。HTML 帶 no-transform：Cloudflare 不在回應裡插入 Web Analytics beacon。\n'
    + urls.map(u => `${u}\n  Cache-Control: ${HTML_CACHE_CONTROL}\n`).join('');
}

const walkFiles = d => fs.readdirSync(d).flatMap(f => { const p = path.join(d, f); return fs.statSync(p).isDirectory() ? walkFiles(p) : [p]; });

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
  const htmlPaths = walkFiles(site).filter(f => f.endsWith('.html'))
    .map(f => '/' + path.relative(outDir, f).split(path.sep).join('/'));
  fs.writeFileSync(path.join(outDir, '_headers'), headersFile(htmlPaths));
  return { site, races: data.races.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])){
  const out = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
  const r = build(out);
  console.log(`build: ${r.races} 個選區 → ${path.relative(process.cwd(), r.site) || r.site}`);
}
