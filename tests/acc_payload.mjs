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
const ALLOWED_RACE_KEYS = ['id', 'label'];

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

// ---- #1：候選人名單檔與開票檔（owner 裁決 2026-10-21：名單放獨立檔案，只有號次與姓名、不帶段落對應）----
// cands/<raceId>.json   { race, candidates: [{ number, name }] }          開票前給傾向選單與猜作者選單
// reveal/<raceId>.json  { race, passages: [{ id, candidate: { number, name }, original, sourceUrl, sourceDate, sourceType }] }
//                       開票時才 fetch。檔案本身公開可抓（orchestrator 裁決：v1 接受，猜作者匯總只收開票前送出的猜測）。
// STRICT 在 #1 land 時翻成 true。
const STRICT_1 = false;
const todo1 = what => STRICT_1 ? what : 'TODO: ' + what;
const readDir = d => { const p = path.join(out, 'covervote', d); return fs.existsSync(p)
  ? Object.fromEntries(fs.readdirSync(p).filter(f => f.endsWith('.json')).map(f => [f, fs.readFileSync(path.join(p, f), 'utf8')])) : null; };
const cands = readDir('cands'), reveal = readDir('reveal');
const CAND_TOP = ['race', 'candidates'], CAND_KEYS = ['number', 'name'];
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

fs.rmSync(out, { recursive: true, force: true });
