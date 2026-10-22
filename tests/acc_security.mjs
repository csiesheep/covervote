// tests/acc_security.mjs — 程式審查（2026-10-21，獨立審查員審 1888abc）找到的問題的驗收。orchestrator 所有（issue #31 FE、#32 BE）。
//
// 1. XSS（高）：網址的縣市鍵 decode 後沒有 escape 就進了 href；鍵帶 "/../2026-local.mayor.taipei" 時抓檔還會落到真的題目檔。
//    規格：site/config.js export cityKey(raw) → 只認 TILES 裡的鍵，其他一律 null；app.js 的路由只用 cityKey 的結果。
//    另外靜態掃描：site/ 的樣板字串裡，屬性值（href/src/data-*）裡的 ${…} 必須是 esc(…)、cityKey 的結果或數字——這裡只掃
//    最常見的洩漏形狀 href="#/${x}"：x 必須是 esc(…) 或名為 key／city 且來源經過 cityKey（以 cityKey 存在且路由使用它為準）。
// 2. 題目檔的段落順序（中）：同一議題的第一段總是同一位候選人，DevTools 裡能把段落分成兩組。
//    規格：race payload 的段落順序與作者無關——依 payload 順序，每個議題第一段的作者不能全是同一人；相鄰同作者比例在 15%–85%。
// 3. 後端（中）：沒有 Origin／content-type 檢查、沒有速率限制。
//    規格：POST 的 content-type 不是 application/json → 415；帶 Origin 但不是 https://games.csiesheep.com → 403（沒有 Origin 照常）；
//    handleApi 的 ctx 可選 `limiter`（{ limit({ key }) → Promise<{ success }> }，正式環境用 Workers Rate Limiting 綁定，以連線 IP 當鍵、
//    不寫入任何儲存）；limiter 回 success:false → 429，且不計數。
import { section, check, ok, importOrNull } from './harness.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, loadData } from '../tools/build_public.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STRICT_31 = false, STRICT_32 = true;
const todo = (strict, msg) => (strict ? '' : 'TODO: ') + msg;

// ---- 1. XSS ----
const config = await importOrNull('../site/config.js');
section('安全（#31 #32）');   // await 之後才設，否則會被別的檔案的 section 蓋掉
check('cityKey 只認 TILES 裡的鍵（惡意字串、路徑穿越、壞編碼都回 null）', () => {
  if (!config?.cityKey) return todo(STRICT_31, 'site/config.js 還沒有 export cityKey');
  const good = ['taipei', 'newtaipei', 'kaohsiung', 'keelung'];
  const bad = ['x"><img src=x onerror=alert(1)>/../2026-local.mayor.taipei', '../taipei', 'taipei/../kaohsiung', 'TAIPEI', 'taipei ', '', null, undefined, '__proto__', 'constructor'];
  const g = good.filter(k => config.cityKey(k) !== k), b = bad.filter(k => config.cityKey(k) !== null);
  if (g.length) return `合法鍵被拒：${g.join('、')}`;
  if (b.length) return `惡意或不合法的鍵沒被擋：${b.map(x => JSON.stringify(x)).join('、')}`;
  return ok(true, `${good.length} 個合法鍵通過、${bad.length} 個壞鍵被擋`);
});

check('site/app.js 的路由用 cityKey，href="#/${…}" 沒有未經處理的鍵', () => {
  const src = fs.readFileSync(path.join(ROOT, 'site', 'app.js'), 'utf8');
  if (!/cityKey\s*\(/.test(src)) return todo(STRICT_31, 'app.js 還沒有呼叫 cityKey');
  // 允許：esc(…)、encodeURIComponent(…)、數字運算；不允許：裸的變數（例如 ${c.key}、${key}、${homePick}）——除非整個檔案的路由入口已用 cityKey 過濾，
  // 那就只剩「顯示用」的地方需要 esc。這裡要求：href 裡的 ${…} 一律包 esc( 或 encodeURIComponent(。
  const hits = [...src.matchAll(/href="#\/\$\{(?!esc\(|encodeURIComponent\()([^}]+)\}/g)].map(m => m[1]);
  if (hits.length) return todo(STRICT_31, `${hits.length} 處 href="#/\${…}" 沒有 esc：${[...new Set(hits)].slice(0, 6).join('、')}`);
  return ok(true, 'href 裡的路由片段都經過 esc／encodeURIComponent');
});

// 由來：orch-checker 證偽 #31 時，把主路由 `const key = cityKey(seg[0])` 改成 `seg[0]`，上面兩條都沒紅（只檢查「cityKey(」字樣存在）。
// 規格：縣市鍵所在的片段——seg[0]，以及班級路由 `#/class/<code>/<city>` 的 seg[2]——只能 (a) 跟字面字串比較、(b) 包在 cityKey(…) 裡。
//   （seg[1] 是子頁名或班級代碼，各自在 switch 的字面 case／viewClass 的格式檢查裡處理，不在這條範圍；info 頁的 tab 在 viewInfo 內白名單。）
check('縣市鍵的路由片段只會被比較或過 cityKey（不會繞過白名單）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'site', 'app.js'), 'utf8');
  if (!/cityKey\s*\(/.test(src)) return todo(STRICT_31, 'app.js 還沒有呼叫 cityKey');
  const lines = src.split('\n'); let uses = 0; const bad = [];
  lines.forEach((ln, i) => {
    const re = /'class'/.test(ln) ? /seg\[[02]\]/g : /seg\[0\]/g;
    for (const m of ln.matchAll(re)){
      uses++;
      const before = ln.slice(0, m.index), after = ln.slice(m.index + m[0].length);
      if (/^\s*(===|!==)\s*['"]/.test(after) || /cityKey\(\s*$/.test(before)) continue;
      bad.push(`第 ${i + 1} 行：${ln.trim().slice(0, 80)}`);
    }
  });
  if (uses < 3) return `app.js 裡縣市鍵片段只出現 ${uses} 次——路由寫法變了，這條要跟著改（母體太小）`;
  return bad.length ? todo(STRICT_31, `${bad.length} 處縣市鍵沒過 cityKey：${bad.slice(0, 3).join('；')}`) : ok(true, `${uses} 處縣市鍵片段都是比較或 cityKey`);
});

// ---- 2. 題目檔的段落順序 ----
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'covervote-sec-'));
let buildErr = null; try { build(out); } catch (e){ buildErr = e; }
const data = loadData();
check('題目檔的段落順序與作者無關（每題第一段不總是同一人；相鄰同作者 15%–85%）', () => {
  if (buildErr) return `build 丟出：${buildErr.message}`;
  const author = Object.fromEntries(data.passages.map(p => [p.id, p.candidateId]));
  const bad = []; let checked = 0;
  for (const rc of data.races){
    const f = path.join(out, 'covervote', 'race', rc.id + '.json');
    if (!fs.existsSync(f)) continue;
    const ps = JSON.parse(fs.readFileSync(f, 'utf8')).passages || [];
    if (ps.length < 6 || new Set(ps.map(p => author[p.id])).size < 2) continue;
    checked++;
    const firsts = new Map(); for (const p of ps) if (!firsts.has(p.issueId)) firsts.set(p.issueId, author[p.id]);
    const firstSame = new Set(firsts.values()).size === 1 && firsts.size >= 3;
    let same = 0; for (let i = 1; i < ps.length; i++) if (author[ps[i].id] === author[ps[i - 1].id]) same++;
    const rate = same / (ps.length - 1);
    if (firstSame) bad.push(`${rc.id}：${firsts.size} 個議題的第一段都是同一位候選人`);
    else if (rate <= 0.15 || rate >= 0.85) bad.push(`${rc.id}：相鄰同作者 ${Math.round(rate * 100)}%`);
  }
  if (!checked) return 'TODO: 母體不足：沒有至少 6 段、2 位作者的選區';
  return bad.length ? todo(STRICT_32, bad.slice(0, 3).join('；')) : ok(true, `${checked} 個選區的題目檔順序看不出作者`);
});
fs.rmSync(out, { recursive: true, force: true });

// ---- 3. 後端 ----
const api = await importOrNull('../worker/api.mjs');
const mem = await importOrNull('../worker/memstore.mjs');
const race = data.races.find(r => data.passages.some(p => p.race === r.id))?.id;
const results = {};
if (api?.handleApi && mem?.memStore && race){
  const now = new Date('2026-11-10T12:00:00+08:00');
  const req = (opts = {}) => new Request('https://games.csiesheep.com/covervote/api/play', {
    method: 'POST', body: JSON.stringify({ race, verdict: 'same' }),
    headers: { 'content-type': opts.ct ?? 'application/json', ...(opts.origin ? { origin: opts.origin } : {}) } });
  const plays = async s => JSON.parse(await (await api.handleApi(new Request(`https://games.csiesheep.com/covervote/api/stats/${race}`), { store: s, now, data })).text()).plays;
  try {
    const s1 = mem.memStore();
    const rText = await api.handleApi(req({ ct: 'text/plain' }), { store: s1, now, data });
    const rForeign = await api.handleApi(req({ origin: 'https://evil.example' }), { store: s1, now, data });
    const rOwn = await api.handleApi(req({ origin: 'https://games.csiesheep.com' }), { store: s1, now, data });
    const rNone = await api.handleApi(req(), { store: s1, now, data });
    results.ct = { text: rText.status, foreign: rForeign.status, own: rOwn.status, none: rNone.status, plays: await plays(s1) };
    const s2 = mem.memStore();
    const deny = { limit: async () => ({ success: false }) };
    const rLim = await api.handleApi(req(), { store: s2, now, data, limiter: deny });
    results.lim = { status: rLim.status, plays: await plays(s2) };
  } catch (e){ results.err = e.message; }
}
section('安全（#31 #32）');
check('POST 要 application/json（415）、外站 Origin 擋下（403）、本站與沒有 Origin 照常', () => {
  if (results.err) return results.err;
  if (!results.ct) return 'TODO: 母體不足';
  const r = results.ct;
  const done = r.text === 415 && r.foreign === 403 && r.own === 204 && r.none === 204 && r.plays === 2;
  return done ? ok(true, `text/plain ${r.text}、外站 ${r.foreign}、本站 ${r.own}、無 Origin ${r.none}；只計 ${r.plays} 局`)
    : todo(STRICT_32, `text/plain ${r.text}（應 415）、外站 ${r.foreign}（應 403）、本站 ${r.own}、無 Origin ${r.none}（應 204）、計了 ${r.plays} 局（應 2）`);
});
check('limiter 拒絕時回 429 且不計數', () => {
  if (results.err) return results.err;
  if (!results.lim) return 'TODO: 母體不足';
  return results.lim.status === 429 && results.lim.plays === 0 ? ok(true, '429、0 局')
    : todo(STRICT_32, `limiter 拒絕時回 ${results.lim.status}（應 429）、計了 ${results.lim.plays} 局（應 0）`);
});
