// tests/acc_payload.mjs — 開票前的前端 payload 不得含能指出作者的東西。orchestrator 所有。
//
// 這是這個遊戲的動詞：「遮住名字打分」。payload 裡只要有 candidateId、候選人姓名、原文或出處，
// 玩家打開 DevTools 就能看到答案，猜作者的猜中率也就量不到遮蔽品質。
//
// 怎麼查：真的跑一次 build（輸出到暫存資料夾，不讀可能過期的 public/），然後逐檔讀
// covervote/race/*.json 的原始文字。
//   - 允許的欄位寫死在這裡（plan 第五節「答案不上前端」），不從 data/schema.mjs 讀：
//     有人把 candidateId 加進 PUBLIC_PASSAGE_FIELDS，這裡要紅，不是跟著放行。
//   - 要找的「答案」從 data/candidates.json 與 data/passages.json 來：候選人 id、姓名（全名與名）、
//     原文 original、sourceUrl。
//   - 母體：每個選區都要有 payload 檔，每段都要出現在 payload 裡（masked 逐字相同）。
//     build 壞掉吐出空檔時，「找不到名字」會恆真——所以先斷言東西在，再斷言答案不在。
import { section, check, ok, nonEmpty } from './harness.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../tools/build_public.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const races = src('races.json'), candidates = src('candidates.json'), passages = src('passages.json');

const ALLOWED_PASSAGE_KEYS = ['id', 'issueId', 'masked', 'plain', 'length'];
const ALLOWED_TOP_KEYS = ['race', 'passages'];
const ALLOWED_RACE_KEYS = ['id', 'label', 'voteDate', 'dataAsOf'];   // voteDate、dataAsOf：orchestrator 裁決 #3，不指向作者

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'covervote-acc-'));
let buildErr = null;
try { build(out); } catch (e){ buildErr = e; }
const raceDir = path.join(out, 'covervote', 'race');
const files = fs.existsSync(raceDir) ? fs.readdirSync(raceDir).filter(f => f.endsWith('.json')) : [];
const texts = Object.fromEntries(files.map(f => [f, fs.readFileSync(path.join(raceDir, f), 'utf8')]));

// 姓名：全名，三字以上的再加「名」（去掉第一個字的姓）——只寫名字一樣是洩漏。
const nameTokens = c => { const n = [...c.name]; return n.length >= 3 ? [c.name, n.slice(1).join('')] : [c.name]; };

section('開票前 payload 不含答案');

check('build 跑得起來', () => buildErr ? `build 丟出：${buildErr.message}` : ok(true, out));

check('每個選區都有 payload 檔（母體）', () => {
  const r = nonEmpty(races.length, 'data/races.json 是空的'); if (r !== true) return r;
  const miss = races.filter(rc => !(rc.id + '.json' in texts)).map(rc => rc.id);
  return miss.length ? `缺 payload：${miss.join(', ')}` : ok(true, `${files.length} 個 payload 檔 / ${races.length} 個選區`);
});

check('每段都在 payload 裡，masked 逐字相同（母體）', () => {
  const r = nonEmpty(passages.length, 'data/passages.json 是空的'); if (r !== true) return r;
  const bad = [];
  for (const p of passages){
    const t = texts[p.race + '.json'];
    if (!t){ bad.push(`${p.id}: 沒有 ${p.race} 的 payload`); continue; }
    const got = JSON.parse(t).passages?.find(q => q.id === p.id);
    if (!got) bad.push(`${p.id}: 不在 payload 裡`);
    else if (got.masked !== p.masked) bad.push(`${p.id}: masked 不同`);
  }
  return bad.length ? bad.join('；') : ok(true, `${passages.length} 段都在，masked 相同`);
});

check('payload 只有允許的欄位（沒有 candidateId、original、sourceUrl…）', () => {
  const bad = [];
  for (const [f, t] of Object.entries(texts)){
    const j = JSON.parse(t);
    for (const k of Object.keys(j)) if (!ALLOWED_TOP_KEYS.includes(k)) bad.push(`${f}: 頂層 ${k}`);
    for (const k of Object.keys(j.race || {})) if (!ALLOWED_RACE_KEYS.includes(k)) bad.push(`${f}: race.${k}`);
    for (const p of j.passages || []) for (const k of Object.keys(p))
      if (!ALLOWED_PASSAGE_KEYS.includes(k)) bad.push(`${f}: ${p.id}.${k}`);
  }
  const n = Object.values(texts).reduce((a, t) => a + (JSON.parse(t).passages || []).length, 0);
  const r = nonEmpty(n, 'payload 裡一段都沒有'); if (r !== true) return r;
  return bad.length ? `多出欄位：${bad.slice(0, 8).join('；')}` : ok(true, `${n} 段，欄位只有 ${ALLOWED_PASSAGE_KEYS.join(', ')}`);
});

check('payload 原文裡找不到任何候選人 id／姓名', () => {
  let r = nonEmpty(candidates.length, 'data/candidates.json 是空的'); if (r !== true) return r;
  r = nonEmpty(files.length, '沒有任何 payload 檔可以查'); if (r !== true) return r;
  const hits = [];
  for (const [f, t] of Object.entries(texts)) for (const c of candidates){
    if (t.includes(c.id)) hits.push(`${f} 含候選人 id ${c.id}`);
    for (const tok of nameTokens(c)) if (t.includes(tok)) hits.push(`${f} 含候選人姓名「${tok}」`);
  }
  return hits.length ? hits.slice(0, 8).join('；')
    : ok(true, `${files.length} 檔 × ${candidates.length} 位候選人，id 與姓名都不在`);
});

check('payload 原文裡找不到 original 原文與 sourceUrl', () => {
  let r = nonEmpty(files.length, '沒有任何 payload 檔可以查'); if (r !== true) return r;
  r = nonEmpty(passages.filter(p => p.original !== p.masked).length, '沒有一段的 original 與 masked 不同，查原文等於沒查');
  if (r !== true) return r;
  const hits = [];
  for (const [f, t] of Object.entries(texts)) for (const p of passages){
    if (p.original !== p.masked && t.includes(p.original)) hits.push(`${f} 含 ${p.id} 的 original`);
    if (p.sourceUrl && t.includes(p.sourceUrl)) hits.push(`${f} 含 ${p.id} 的 sourceUrl`);
  }
  return hits.length ? hits.slice(0, 8).join('；') : ok(true, `${passages.length} 段的原文與出處都不在`);
});

// ---- #12：段落 id 本身不得透露作者 ----
// 由來（writer #8 回報，orchestrator 2026-10-21 驗證）：台北、新北、台中的 id 是 p-<都>-001… 依作者交替編號，
// 奇數全是一位、偶數全是另一位；id 是 payload 的公開欄位，看過一段答案就能推出其餘全部。
// 規則：公開的段落 id 一律是 p-<district>-<6 碼亂數>（小寫英數、至少含一個英文字母），不得是流水號。
// 只檢查格式不夠：再檢查「依 id 排序後，相鄰兩段同作者」的比例不能是 0% 或 100%（交替或分塊都會被抓）。
const STRICT_12 = true;   // #12 land 時翻
check('段落 id 是不透露作者的亂數碼（p-<district>-xxxxxx），不是流水號', () => {
  const r = nonEmpty(passages.length, 'data/passages.json 是空的'); if (r !== true) return r;
  const bad = passages.filter(p => { const m = /^p-([a-z]+)-([a-z0-9]{6})$/.exec(p.id); return !m || !/[a-z]/.test(m[2]) || p.race.split('.').pop() !== m[1]; }).map(p => p.id);
  const pattern = [];
  for (const rc of races){
    const ps = passages.filter(p => p.race === rc.id).sort((a, b) => a.id < b.id ? -1 : 1);
    if (ps.length < 6 || new Set(ps.map(p => p.candidateId)).size < 2) continue;
    let same = 0; for (let i = 1; i < ps.length; i++) if (ps[i].candidateId === ps[i - 1].candidateId) same++;
    const rate = same / (ps.length - 1);
    // 兩位作者分成兩塊時中間一定有一個交界，比例是 (n−2)/(n−1) 而不是 100%——只抓 0／100% 會放過分塊（探針抓到的洞）。
    // 隨機編號時這個比例大約在 40–60%；≤ 15% 或 ≥ 85% 就當成有規律。
    if (rate <= 0.15 || rate >= 0.85) pattern.push(`${rc.id}：依 id 排序後相鄰同作者 ${Math.round(rate * 100)}%（${rate <= 0.15 ? '交替' : '分塊'}）`);
  }
  const msg = [bad.length && `${bad.length} 個 id 不是亂數碼：${bad.slice(0, 5).join('、')}`, pattern.length && pattern.join('；')].filter(Boolean).join('；');
  if (msg) return (STRICT_12 ? '' : 'TODO: ') + msg;
  return ok(true, `${passages.length} 個 id 都是亂數碼，沒有交替或分塊`);
});

// ---- #1：候選人名單檔與開票檔（owner 裁決 2026-10-21：名單放獨立檔案，只有號次與姓名、不帶段落對應）----
// cands/<raceId>.json   { race, candidates: [{ number, name }] }          開票前給傾向選單與猜作者選單
// reveal/<raceId>.json  { race, passages: [{ id, candidate: { number, name }, original, sourceUrl, sourceDate, sourceType }] }
//                       開票時才 fetch。檔案本身公開可抓（orchestrator 裁決：v1 接受，猜作者匯總只收開票前送出的猜測）。
// STRICT 在 #1 land 時翻成 true。
const STRICT_1 = true;   // #1 land（2026-10-21）時翻：之後檔案消失要紅，不是退回 TODO
const todo1 = what => STRICT_1 ? what : 'TODO: ' + what;
const readDir = d => { const p = path.join(out, 'covervote', d); return fs.existsSync(p)
  ? Object.fromEntries(fs.readdirSync(p).filter(f => f.endsWith('.json')).map(f => [f, fs.readFileSync(path.join(p, f), 'utf8')])) : null; };
const cands = readDir('cands'), reveal = readDir('reveal');
const CAND_TOP = ['race', 'candidates'], CAND_KEYS = ['number', 'name', 'inPlay', 'group'];   // inPlay：orchestrator 裁決 #6；group：#37
const REVEAL_TOP = ['race', 'passages'], REVEAL_KEYS = ['id', 'candidate', 'original', 'sourceUrl', 'sourceDate', 'sourceType'];

section('候選人名單檔與開票檔（#1）');

check('cands/：每個選區一檔，只有號次與姓名，人數對得上', () => {
  if (!cands) return todo1('build 還沒有產生 covervote/cands/');
  const r = nonEmpty(races.length, 'data/races.json 是空的'); if (r !== true) return r;
  const bad = [];
  for (const rc of races){
    const t = cands[rc.id + '.json'];
    if (!t){ bad.push(`缺 ${rc.id}.json`); continue; }
    const j = JSON.parse(t);
    for (const k of Object.keys(j)) if (!CAND_TOP.includes(k)) bad.push(`${rc.id}: 頂層 ${k}`);
    const list = j.candidates || [];
    for (const c of list) for (const k of Object.keys(c)) if (!CAND_KEYS.includes(k)) bad.push(`${rc.id}: 候選人欄位 ${k}`);
    const want = candidates.filter(c => c.raceId === rc.id).map(c => c.name).sort().join(',');
    const got = list.map(c => c.name).sort().join(',');
    if (want !== got) bad.push(`${rc.id}: 名單 ${got} ≠ data 的 ${want}`);
  }
  return bad.length ? bad.slice(0, 8).join('；') : ok(true, `${races.length} 檔，欄位只有 ${CAND_KEYS.join(', ')}`);
});

// orchestrator 裁決（#6）：猜作者選單只放有段落的候選人——放進沒有段落的人，玩家的猜測被稀釋，猜中率被壓低，
// 遮蔽看起來比實際好（W1 失真）。inPlay 只說「這人在這一都有沒有段落」，不說哪一段是他的。
const STRICT_6 = true;   // #6 land 時翻
check('cands/：inPlay 等於「這位候選人在這一都至少有一段」', () => {
  if (!cands) return todo1('build 還沒有產生 covervote/cands/');
  const bad = [];
  let n = 0;
  for (const rc of races){
    const list = JSON.parse(cands[rc.id + '.json'] || '{"candidates":[]}').candidates;
    for (const c of candidates.filter(x => x.raceId === rc.id)){
      const want = passages.some(p => p.candidateId === c.id);
      const got = list.find(x => x.name === c.name)?.inPlay;
      if (got === undefined){ if (!STRICT_6) return 'TODO: cands/ 還沒有 inPlay（#6）'; bad.push(c.name + ' 沒有 inPlay'); continue; }
      n++;
      if (got !== want) bad.push(`${rc.id} ${c.name}: inPlay ${got}，應為 ${want}`);
    }
  }
  if (bad.length) return bad.slice(0, 6).join('；');
  const r = nonEmpty(n, '沒有任何候選人帶 inPlay'); if (r !== true) return r;
  // 分得出對錯的母體：至少要有一位「沒有段落」的候選人。全員都有段落時，「inPlay 一律 true」的錯實作也會綠。
  const idle = candidates.filter(c => !passages.some(p => p.candidateId === c.id)).length;
  if (!idle) return 'TODO: 母體分不出 inPlay 的對錯（每位候選人都有段落），等有沒有段落的候選人進資料再判';
  return ok(true, `${n} 位候選人的 inPlay 都對，其中 ${idle} 位沒有段落`);
});

// #28：候選人名單的順序（owner 2026-10-21 原話：「請向投給誰 先藍後綠再其他」——傾向投給誰的選單）。
// data/candidates.json 的 party（內部欄位，不上前端）：'kmt'（藍）、'dpp'（綠）、其他任何值＝其他。
// 規則：kmt → dpp → 其他；同一組裡號次小的在前、號次 null 的在後，再照 data 的列順序。cands/ 仍然只有 number、name、inPlay。
const STRICT_28 = true;   // #28–30 land 時翻
check('cands/ 的順序：先藍、後綠、再其他（組內照號次）', () => {
  if (!cands) return todo1('build 還沒有產生 covervote/cands/');
  const noParty = candidates.filter(c => !('party' in c)).map(c => c.name);
  if (noParty.length) return (STRICT_28 ? '' : 'TODO: ') + `data/candidates.json 還沒有 party：${noParty.slice(0, 6).join('、')}${noParty.length > 6 ? '…' : ''}`;
  const g = c => c.party === 'kmt' ? 0 : c.party === 'dpp' ? 1 : 2;
  const bad = [];
  let checked = 0, discriminating = 0;
  for (const rc of races){
    const cs = candidates.map((c, i) => ({ ...c, i })).filter(c => c.raceId === rc.id);
    const want = cs.slice().sort((a, b) => g(a) - g(b) || (a.number ?? 1e9) - (b.number ?? 1e9) || a.i - b.i).map(c => c.name).join(',');
    const got = (JSON.parse(cands[rc.id + '.json'] || '{"candidates":[]}').candidates || []).map(c => c.name).join(',');
    checked++;
    if (cs.map(c => c.name).join(',') !== want) discriminating++;   // 資料順序本身不是答案時，這一都才分得出對錯
    if (got !== want) bad.push(`${rc.id}: ${got} ≠ ${want}`);
  }
  if (bad.length) return (STRICT_28 ? '' : 'TODO: ') + bad.slice(0, 3).join('；');
  if (!discriminating) return 'TODO: 母體分不出：每一都的資料順序剛好就是正確順序，照資料順序輸出的錯實作也會綠';
  return ok(true, `${checked} 都的順序正確（其中 ${discriminating} 都的資料順序與答案不同）`);
});

// #37（owner 2026-10-21：「重新設計每一頁的 UI…可以用顏色或是comfyUI 生圖，表示政黨」，選 C）。orchestrator 裁決：
// cands/ 每位候選人帶粗分組 group ∈ {kmt, dpp, oth}——只分三色，小黨與無黨籍一律 oth，細的黨名（data 的 party）不得出現在任何前端檔。
// cands/ 的名字本來就公開，帶 group 不洩漏哪一段是誰寫的（race/ 仍不得有任何政黨資訊，見 G1）。
const STRICT_37 = true;    // #37 land 時翻
check('cands/：每位候選人有 group（kmt／dpp／oth），細黨名不外流', () => {
  if (!cands) return todo1('build 還沒有產生 covervote/cands/');
  const want = c => c.party === 'kmt' ? 'kmt' : c.party === 'dpp' ? 'dpp' : 'oth';
  const fine = [...new Set(candidates.map(c => c.party).filter(x => x && x !== 'kmt' && x !== 'dpp'))];
  const bad = []; let n = 0, oth = 0;
  for (const rc of races){
    const t = cands[rc.id + '.json'] || '{"candidates":[]}';
    for (const f of fine) if (t.includes('"' + f + '"')) bad.push(`${rc.id}: 出現細黨名 ${f}`);
    for (const c of JSON.parse(t).candidates || []){
      const d = candidates.find(x => x.raceId === rc.id && x.name === c.name); if (!d) continue;
      n++; if (want(d) === 'oth') oth++;
      if (c.group === undefined){ bad.push(`${c.name} 沒有 group`); continue; }
      if (c.group !== want(d)) bad.push(`${c.name}: group ${c.group} ≠ ${want(d)}`);
    }
  }
  if (!n || !oth || !fine.length) return 'TODO: 母體不足：要有候選人、有 oth、且 data 有細黨名才分得出「把細黨名直接輸出」的錯實作';
  const onlyMissing = bad.length && bad.every(b => b.endsWith('沒有 group'));
  if (bad.length) return (STRICT_37 || !onlyMissing ? '' : 'TODO: ') + bad.slice(0, 4).join('；');
  return ok(true, `${n} 位候選人的 group 正確（其中 ${oth} 位 oth；${fine.length} 種細黨名都沒出現）`);
});

check('cands/ 裡沒有任何段落 id 或候選人 id', () => {
  if (!cands) return todo1('build 還沒有產生 covervote/cands/');
  const r = nonEmpty(passages.length, 'data/passages.json 是空的'); if (r !== true) return r;
  const hits = [];
  for (const [f, t] of Object.entries(cands)){
    for (const p of passages) if (t.includes(`"${p.id}"`)) hits.push(`${f} 含段落 id ${p.id}`);
    for (const c of candidates) if (t.includes(c.id)) hits.push(`${f} 含候選人 id ${c.id}`);
  }
  return hits.length ? hits.slice(0, 8).join('；') : ok(true, `${Object.keys(cands).length} 檔 × ${passages.length} 段，沒有對應`);
});

check('reveal/：每段都在，作者姓名與 data 一致，欄位只有允許的', () => {
  if (!reveal) return todo1('build 還沒有產生 covervote/reveal/');
  const r = nonEmpty(passages.length, 'data/passages.json 是空的'); if (r !== true) return r;
  const name = Object.fromEntries(candidates.map(c => [c.id, c.name]));
  const bad = [];
  for (const p of passages){
    const t = reveal[p.race + '.json'];
    if (!t){ bad.push(`缺 ${p.race}.json`); continue; }
    const j = JSON.parse(t);
    for (const k of Object.keys(j)) if (!REVEAL_TOP.includes(k)) bad.push(`${p.race}: 頂層 ${k}`);
    const q = (j.passages || []).find(x => x.id === p.id);
    if (!q){ bad.push(`${p.id} 不在 reveal`); continue; }
    for (const k of Object.keys(q)) if (!REVEAL_KEYS.includes(k)) bad.push(`${p.id}.${k}`);
    if (q.candidate?.name !== name[p.candidateId]) bad.push(`${p.id}: 作者 ${q.candidate?.name} ≠ ${name[p.candidateId]}`);
    if (q.original !== p.original) bad.push(`${p.id}: original 不同`);
  }
  return bad.length ? bad.slice(0, 8).join('；') : ok(true, `${passages.length} 段都在，作者一致`);
});

// orchestrator 裁決（#3 FE 提問）：議題顯示名只有一份——data/issues.json（內容歸 writer、格式歸 BE），
// build 輸出 covervote/issues.json：[{ id, label }]。FE 不自己放對照表（兩份就是兩份真相）。
check('issues.json：每個用到的 issueId 都有顯示名，欄位只有 id、label', () => {
  const f = path.join(out, 'covervote', 'issues.json');
  if (!fs.existsSync(f)) return todo1('build 還沒有產生 covervote/issues.json');
  const list = JSON.parse(fs.readFileSync(f, 'utf8'));
  const r = nonEmpty(passages.length, 'data/passages.json 是空的'); if (r !== true) return r;
  const bad = [];
  for (const it of list) for (const k of Object.keys(it)) if (!['id', 'label'].includes(k)) bad.push(`${it.id}.${k}`);
  const have = new Map(list.map(it => [it.id, it.label]));
  const used = [...new Set(passages.map(p => p.issueId))];
  const missing = used.filter(i => !have.get(i));
  if (missing.length) bad.push(`沒有顯示名：${missing.join('、')}`);
  return bad.length ? bad.join('；') : ok(true, `${list.length} 個議題，用到的 ${used.length} 個都有顯示名`);
});

check('race payload 有 voteDate（倒數用），格式 YYYY-MM-DD 且等於選舉日', () => {
  if (!cands) return todo1('#1 還沒 land');
  const elections = src('elections.json');
  const bad = [];
  for (const rc of races){
    const j = JSON.parse(texts[rc.id + '.json'] || '{}');
    const want = elections.find(e => e.id === rc.electionId)?.voteDate;
    if (j.race?.voteDate !== want) bad.push(`${rc.id}: voteDate ${j.race?.voteDate} ≠ ${want}`);
  }
  return bad.length ? bad.join('；') : ok(true, `${races.length} 個選區都帶 voteDate`);
});

fs.rmSync(out, { recursive: true, force: true });
