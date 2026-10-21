// site/app.js — 單頁 app：hash 路由與畫面（設計稿 A1–C4、D4）。FE 所有。
//
// 約束（issue #3）：
//  - 開票前不 fetch reveal/（只在 revealNow() 裡，由「開票」按鈕觸發）；DOM 與 localStorage 都沒有作者。
//  - 傾向、分數、猜作者只存本機（store.js）。不載入任何分析或錄製腳本。
//  - 分數一律呼叫 engine/score.mjs，FE 不自己算。候選人的鍵是姓名。
import { t, initLang, lang, has } from './i18n.js';
import { TILES, METRO_KEYS, METRO_ETA, CEC_URL, FULL_URL } from './config.js';
import { initInternal, isEmbed, loadState, saveState, freshState, hasProgress } from './store.js';
import { initSound, isSoundOn, setSound, sfx } from './sound.js';
import { postGuess, postPlay, getHealth, getStats } from './api.js';
import { loadRace, loadIssues, fetchReveal, buildPlan, menuOrder, mulberry32, NotFound, initVersion } from './data.js';

initInternal();
initLang();
initSound();
// 嵌入模式（?embed=1）：沒有品牌列與頁尾連結，只留一行「完整版 ↗」；聲音維持預設關（initSound 不看這個旗標）。
// 嵌入模式不改變任何資料流：開票前不 fetch reveal/、guess 先於 reveal、internal=1 照樣生效，都在同一份程式裡。
const EMBED = isEmbed();
if (EMBED) document.documentElement.classList.add('embed');

const root = document.getElementById('root');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lines = s => esc(s).replace(/\n/g, '<br>');
const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v);
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const seatOf = i => { const s = [...t('seats')]; return s[i] || String(i + 1); };

// ---------------- 共用片段 ----------------
const ICON_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
const ICON_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>';
function bar(left, meta){
  if (EMBED) return '';
  const on = isSoundOn();
  return `<header class="bar"><a class="brand" href="#/"><i></i>${esc(left)}</a><span class="bar-r">${meta ? `<span class="meta num" id="barmeta">${esc(meta)}</span>` : '<span class="meta num" id="barmeta"></span>'}`
    + `<button class="snd" data-act="sound" aria-pressed="${on}" aria-label="${esc(t(on ? 'sound.on' : 'sound.off'))}" title="${esc(t(on ? 'sound.on' : 'sound.off'))}">${on ? ICON_ON : ICON_OFF}</button></span></header>`;
}
const footer = healthKey => EMBED
  ? `<footer class="foot embed-foot"><a href="${FULL_URL}" target="_blank" rel="noopener">${esc(t('embed.full'))}</a></footer>`
  : `<footer class="foot">${healthKey !== undefined ? `<a id="healthlink" href="#/${esc(healthKey || '')}/health"${healthKey ? '' : ' hidden'}>${esc(t('foot.health'))}</a>` : ''}<a href="#/info/method">${esc(t('foot.method'))}</a><a href="#/info/sources">${esc(t('foot.sources'))}</a><a href="#/info/privacy">${esc(t('foot.privacy'))}</a><a href="#/info/about">${esc(t('foot.about'))}</a><a href="#/embed">${esc(t('foot.media'))}</a></footer>`;
const page = (barHtml, body, foot = '') => `${barHtml}<main id="main" tabindex="-1"><div class="pad">${body}</div>${foot || (EMBED ? footer() : '')}</main>`;
const spinner = () => `<div class="spin" role="status">${esc(t('loading'))}</div>`;
const errorBox = (msg, retryAct = 'reload') => `<div class="errbox" role="alert"><span>${esc(msg)}</span><button class="btn ghost" data-act="${retryAct}">${esc(t('err.retry'))}</button></div>`;

let toastTimer = 0;
function toast(msg){
  document.querySelectorAll('.toast').forEach(n => n.remove());
  const n = document.createElement('div'); n.className = 'toast'; n.setAttribute('role', 'status'); n.textContent = msg;
  document.body.appendChild(n);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => n.remove(), 2200);
}

// ---------------- 選區 context ----------------
const ctxs = new Map();
async function getCtx(key){
  const data = await loadRace(key);
  const issues = await loadIssues();
  let c = ctxs.get(key);
  if (!c){
    const st = loadState(data.raceId);
    c = { key, data, issues, st };
    ctxs.set(key, c);
  }
  c.issues = issues;
  rebuild(c);
  return c;
}
function rebuild(c){
  c.plan = buildPlan(c.data.passages, c.st.seed);
  const order = menuOrder(c.data.candidates, c.st.menuOrder, c.st.seed);
  if (!c.st.menuOrder || c.st.menuOrder.join('|') !== order.join('|')){
    if (c.data.candidates.some(x => x.number === null || x.number === undefined)){ c.st.menuOrder = order; save(c); }
  }
  c.order = order;
  c.byName = new Map(c.data.candidates.map(x => [x.name, x]));
}
const save = c => saveState(c.data.raceId, c.st);
const issueLabel = (c, id) => c.issues.get(id) || id;
const raceLabel = c => c.data.meta.label || c.key;
const hasNumbers = c => c.data.candidates.every(x => Number.isInteger(x.number));
const textMode = () => { try { return localStorage.getItem('covervote:text') === 'masked' ? 'masked' : 'plain'; } catch { return 'plain'; } };
function setTextMode(m){ try { localStorage.setItem('covervote:text', m); } catch {} }

// 把連續的 ▇ 畫成墨條（點一下說遮了幾個字）
function renderText(s){
  return esc(s).replace(/▇+/g, m => `<button type="button" class="mask" data-act="mask" data-n="${m.length}" aria-label="${esc(t('play.maskInfo', { n: m.length }))}">${m}</button>`);
}

// ---------------- 路由 ----------------
function parse(){
  const h = location.hash.replace(/^#\/?/, '');
  const seg = h.split('/').filter(Boolean).map(decodeURIComponent);
  return seg;
}
const go = hash => { location.hash = hash; };
let renderSeq = 0, cleanup = null;

async function render(){
  const seq = ++renderSeq;
  if (cleanup){ try { cleanup(); } catch {} cleanup = null; }
  const seg = parse();
  let out;
  try { out = await route(seg); }
  catch (e) {
    out = { html: page(bar(t('brand')), errorBox(t('err.load'))) };
  }
  if (seq !== renderSeq || !out) return;
  root.innerHTML = out.html;
  window.scrollTo(0, 0);
  const main = document.getElementById('main'); if (main) main.focus({ preventScroll: true });
  if (out.mount) cleanup = out.mount(root) || null;
}

async function route(seg){
  if (seg.length === 0) return viewHome();
  if (seg[0] === 'info') return viewInfo(seg[1] || 'method');
  if (seg[0] === 'embed') return viewMedia();
  const key = seg[0], sub = seg[1] || '';
  let c;
  try { c = await getCtx(key); }
  catch (e) {
    if (e instanceof NotFound) return viewMissing(key);
    return { html: page(bar(t('brand')), errorBox(t('err.load'))) };
  }
  if (!playable(c.data)) return viewMissing(key);   // 有檔但沒有可比段落：走「還在整理」（六都）或「未收錄」
  switch (sub){
    case '': return viewEntry(c);
    case 'health': return viewHealth(c);
    case 'lean': return viewLean(c);
    case 'play': return viewRound(c, parseInt(seg[2] || '1', 10));
    case 'bonus': return viewBonus(c);
    case 'important': return viewImportant(c);
    case 'reveal': return c.st.done ? viewReveal(c) : redirect(`#/${key}`);
    case 'result': return c.st.done ? viewResult(c) : redirect(`#/${key}`);
    case 'detail': return c.st.done ? viewDetail(c) : redirect(`#/${key}`);
    case 'share': return c.st.done ? viewShare(c) : redirect(`#/${key}`);
    default: return viewEntry(c);
  }
}
function redirect(h){ location.replace(h); return null; }

// ---------------- A1 首頁 ----------------
let homePick = null;
function lastCity(){ try { return localStorage.getItem('covervote:lastCity'); } catch { return null; } }
// 可玩 = race payload 裡至少有一個議題有 ≥ 2 段（可比的段落）。只有檔案、沒有可比段落的選區算「整理中」（orchestrator 裁決 #9）。
function playable(data){
  const n = new Map();
  for (const p of data.passages) n.set(p.issueId, (n.get(p.issueId) || 0) + 1);
  return [...n.values()].some(v => v >= 2);
}
// 六都裡哪些「有資料」：由 race/<id>.json 與 cands/<id>.json 存不存在決定，不寫死。
async function readyMetros(){
  const rs = await Promise.allSettled(METRO_KEYS.map(k => loadRace(k)));
  const ready = new Map();
  rs.forEach((r, i) => { if (r.status === 'fulfilled' && playable(r.value)) ready.set(METRO_KEYS[i], r.value); });
  return ready;
}

async function viewHome(){
  const ready = await readyMetros();
  const last = lastCity();
  if (homePick !== null && !ready.has(homePick)) homePick = null;
  if (homePick === null && last && ready.has(last)) homePick = last;
  const tiles = TILES.map(tl => {
    const name = esc(t('tile.' + tl.key));
    if (ready.has(tl.key)) return `<button class="tile live${homePick === tl.key ? ' pick' : ''}" style="grid-area:${tl.area}" data-act="pick" data-key="${tl.key}" aria-pressed="${homePick === tl.key}">${name}</button>`;
    if (tl.metro) return `<a class="tile soon" style="grid-area:${tl.area}" href="#/${tl.key}" aria-label="${esc(t('tile.' + tl.key) + ' ' + t('home.soon'))}"><span>${name}<small>${esc(t('home.soon'))}</small></span></a>`;
    return `<a class="tile" style="grid-area:${tl.area}" href="#/${tl.key}">${name}</a>`;
  }).join('');
  const body = `
    <img class="illo" src="assets/hero.webp" alt="${esc(t('home.heroAlt'))}" width="1536" height="864" style="margin:-6px 0 -4px;object-fit:cover;object-position:right;aspect-ratio:16/7">
    <h1 class="big">${lines(t('home.title'))}</h1>
    <p class="muted">${esc(t('home.sub'))}</p>
    <div class="tiles" role="group" aria-label="${esc(t('home.mapLabel'))}">${tiles}</div>
    <div class="legend"><span><i class="sw"></i>${esc(t('home.legendOn'))}</span><span><i class="sw d"></i>${esc(t('home.legendOff'))}</span></div>
    <p class="muted num" id="plays" hidden></p>
    <a class="btn" id="startbtn" href="${homePick ? '#/' + homePick : '#/'}" data-act="start" ${homePick ? '' : 'aria-disabled="true"'}>${esc(startLabel())}</a>
    <p class="muted">${esc(t('home.promise'))}</p>`;
  return { html: page(bar(t('brand'), ''), body, footer(homePick || [...ready.keys()][0] || '')), mount: () => { fillCountdown(ready); fillPlays(ready); } };
}
// 「已有 N 局」：局數照常（靜默期也不受影響）；取不到或 0 就不顯示。
const playsCache = new Map();
function showPlays(){
  const el = document.getElementById('plays'); if (!el) return;
  const n = homePick ? playsCache.get(homePick) : 0;
  el.hidden = !(n > 0);
  if (n > 0) el.textContent = t('home.plays', { n });
}
function fillPlays(ready){
  for (const [key, d] of ready){
    if (playsCache.has(key)) continue;
    getStats(d.raceId).then(st => { if (Number.isInteger(st?.plays)) playsCache.set(key, st.plays); showPlays(); }).catch(() => {});
  }
  showPlays();
}
const startLabel = () => homePick ? t('home.startAt', { city: t('tile.' + homePick) }) : t('home.pick');

// 倒數：只在 race payload 有 voteDate 才顯示
function fillCountdown(ready){
  for (const d of ready.values()){
    const vd = d.meta.voteDate;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(vd || ''); if (!m) continue;
    const md = `${+m[2]}/${+m[3]}`;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Math.round((new Date(+m[1], +m[2] - 1, +m[3]) - today) / 86400000);
    const el = document.getElementById('barmeta'); if (!el) return;
    el.textContent = days > 0 ? t('home.meta.vote', { md, d: days }) : days === 0 ? t('home.meta.today', { md }) : t('home.meta.over');
    return;
  }
}

// ---------------- A2 入口 / A3 未收錄 / 六都整理中 ----------------
async function viewMissing(key){
  const known = TILES.find(x => x.key === key);
  const city = known ? t('city.' + key) : t('city.unknown');
  if (known && known.metro){
    // 六都，但還沒有資料：不說「沒收錄」，說在整理、什麼時候公開，並指向已有資料的縣市
    const ready = await readyMetros();
    const first = [...ready.keys()][0];
    const body = `
      <img class="illo" src="assets/empty_state.webp" alt="" width="768" height="768" style="width:180px">
      <h1 class="mid">${esc(t('soon.title', { city }))}</h1>
      <p class="muted">${esc(t('soon.body', { md: METRO_ETA }))}</p>
      ${first ? `<a class="btn" href="#/${first}">${esc(t('soon.playOther', { city: t('tile.' + first) }))}</a>` : ''}
      <a class="btn ghost" href="#/">${esc(t('common.home'))}</a>`;
    return { html: page(bar(t('brand'), t('entry.change')), `<div class="stack center" style="gap:14px;align-items:center">${body}</div>`, footer()) };
  }
  const body = `
    <img class="illo" src="assets/empty_state.webp" alt="" width="768" height="768" style="width:180px">
    <h1 class="mid">${esc(t('missing.title', { city }))}</h1>
    <p class="muted">${esc(t('missing.body'))}</p>
    <a class="btn line" href="${CEC_URL}" target="_blank" rel="noopener noreferrer">${esc(t('missing.cec'))}</a>
    <a class="btn ghost" href="#/">${esc(t('missing.back'))}</a>`;
  return { html: page(bar(t('brand'), t('entry.change')), `<div class="stack center" style="gap:14px;align-items:center">${body}</div>`, footer()) };
}

function viewEntry(c){
  try { localStorage.setItem('covervote:lastCity', c.key); } catch {}
  const ps = c.data.passages;
  const plan = c.plan;
  if (!ps.length || !c.data.candidates.length) {
    return { html: page(bar(raceLabel(c), t('entry.change')), `<h1 class="big">${esc(raceLabel(c))}</h1><p class="muted">${esc(t('entry.empty'))}</p><a class="btn ghost" href="#/">${esc(t('missing.back'))}</a>`, footer()) };
  }
  const avg = Math.round(ps.reduce((a, p) => a + (p.length || [...p.masked].length), 0) / ps.length);
  const topics = plan.bonus.length ? t('entry.topicsBonus', { n: plan.rounds.length }) : t('entry.topicsVal', { n: plan.rounds.length });
  const prog = hasProgress(c.st);
  const meta = [];
  if (c.data.meta.dataAsOf) meta.push(`<tr><th>${esc(t('entry.asOf'))}</th><td class="num">${esc(c.data.meta.dataAsOf)}</td></tr>`);
  const body = `
    <h1 class="big">${esc(raceLabel(c))}</h1>
    <div class="deck" aria-hidden="true"><div class="cardback"></div><div class="cardback"></div><div class="cardback"></div></div>
    <table>
      <tr><th>${esc(t('entry.candidates'))}</th><td class="num">${esc(t('entry.nCands', { n: c.data.candidates.length }))}</td></tr>
      <tr><th>${esc(t('entry.topicsTh'))}</th><td class="num">${esc(topics)}</td></tr>
      <tr><th>${esc(t('entry.passages'))}</th><td class="num">${esc(t('entry.passagesVal', { n: ps.length, avg }))}</td></tr>
      ${meta.join('')}
      <tr><th>${esc(t('entry.health'))}</th><td><a href="#/${c.key}/health">${esc(t('entry.healthVal'))}</a></td></tr>
    </table>
    ${prog && !c.st.done ? `<a class="btn" href="#/${c.key}/play" data-act="resume">${esc(t('entry.resume'))}</a><button class="btn ghost" data-act="restart">${esc(t('entry.restart'))}</button>`
      : c.st.done ? `<a class="btn" href="#/${c.key}/result">${esc(t('res.meta'))}</a><button class="btn ghost" data-act="restart">${esc(t('res.again'))}</button>`
      : `<a class="btn" href="#/${c.key}/lean">${esc(t('entry.start'))}</a>`}
    <details><summary class="muted">${esc(t('entry.how'))}</summary>
      <ol class="muted" style="padding-left:18px;margin:8px 0 0"><li>${esc(t('entry.how1'))}</li><li>${esc(t('entry.how2'))}</li><li>${esc(t('entry.how3'))}</li><li>${esc(t('entry.how4'))}</li></ol></details>`;
  return { html: page(bar(t('brand'), t('entry.change')), body, footer(c.key)) };
}

// ---------------- B1 傾向 ----------------
function viewLean(c){
  const names = c.order;
  const collapsed = names.length > 4 && !(c.st.lean && names.indexOf(c.st.lean) >= 3);
  const optHtml = (name, i) => {
    const cand = c.byName.get(name);
    const on = c.st.lean === name;
    const no = Number.isInteger(cand.number) ? `<small>${esc(t('lean.no', { n: cand.number }))}</small>` : '';
    return `<button class="opt" role="radio" aria-label="${esc(name + (Number.isInteger(cand.number) ? ", " + t("lean.no", { n: cand.number }) : ""))}" aria-checked="${on}" data-act="lean" data-v="${esc(name)}"${collapsed && i >= 3 ? ' data-more hidden' : ''}><span class="ava" aria-hidden="true">${esc([...name][0])}</span><span>${esc(name)}${no}</span></button>`;
  };
  const rest = names.length - 3;
  const body = `
    <h1 class="mid">${esc(t('lean.q'))}</h1>
    <p class="muted">${esc(t('lean.sub'))}</p>
    <div class="stack" role="radiogroup" aria-label="${esc(t('lean.group'))}">
      ${names.map(optHtml).join('')}
      ${collapsed ? `<button class="opt" data-act="more" aria-expanded="false"><span class="ava">…</span><span>${esc(t('lean.more', { n: rest }))}<small>${esc(t('lean.expand'))}</small></span></button>` : ''}
      <div class="row"><button class="chip${c.st.lean === 'undecided' ? ' on' : ''}" data-act="lean" data-v="undecided" aria-pressed="${c.st.lean === 'undecided'}">${esc(t('lean.undecided'))}</button><button class="chip${c.st.lean === 'private' ? ' on' : ''}" data-act="lean" data-v="private" aria-pressed="${c.st.lean === 'private'}">${esc(t('lean.private'))}</button></div>
    </div>
    <div class="lock"><span aria-hidden="true">🔒</span><span>${esc(t('lean.lock'))}</span></div>
    <a class="btn" href="#/${c.key}/play/1" data-act="lean-next">${esc(t('lean.next'))}</a>`;
  return { html: page(bar(raceLabel(c), t('lean.meta')), body) };
}

// ---------------- B2 一輪 ----------------
function roundSteps(c, cur){
  const n = c.plan.steps;
  return `<div class="progress" aria-hidden="true">${Array.from({ length: n }, (_, i) => `<i class="${i < cur ? 'd' : i === cur ? 'c' : ''}"></i>`).join('')}</div>`;
}
function rateButtons(c, p, label){
  const cur = c.st.ratings[p.id];
  return `<div class="rate" role="radiogroup" aria-label="${esc(label)}">${[-2, -1, 0, 1, 2].map(v =>
    `<button type="button" role="radio" aria-checked="${cur === v}" class="${cur === v ? 'on' : ''}" data-act="rate" data-pid="${esc(p.id)}" data-v="${v}"><b>${sgn(v)}</b>${esc(t('rate.' + v))}</button>`).join('')}</div>`;
}
// 猜作者的選項：只放這一都「有段落」的人（cands/ 的 inPlay === true；orchestrator 裁決 #6）。
// 放進沒有段落的人會稀釋猜測、壓低猜中率，遮蔽健康度就失真。cands/ 還沒有 inPlay 欄位（或全是 false）→ 退回全部。
// 傾向選單照舊放全部候選人（viewLean 用 c.order）。
function guessNames(c){
  const inPlay = new Set(c.data.candidates.filter(x => x.inPlay === true).map(x => x.name));
  return inPlay.size ? c.order.filter(n => inPlay.has(n)) : c.order;
}
function guessBlock(c, p){
  const g = c.st.guesses[p.id];
  const chips = guessNames(c).map(n => `<button type="button" class="chip${g === n ? ' on' : ''}" aria-pressed="${g === n}" data-act="guess" data-pid="${esc(p.id)}" data-v="${esc(n)}">${esc(n)}</button>`).join('')
    + `<button type="button" class="chip${g === 'unknown' ? ' on' : ''}" aria-pressed="${g === 'unknown'}" data-act="guess" data-pid="${esc(p.id)}" data-v="unknown">${esc(t('play.unknown'))}</button>`;
  return `<details class="guess"${g ? ' open' : ''}><summary><span class="sl">${esc(t('play.guess'))}</span><span class="num">${esc(t('play.guessNote'))}</span></summary><div class="row">${chips}</div></details>`;
}
function cardHtml(c, p, i, { guess, tag }) {
  const mode = textMode();
  const text = mode === 'masked' ? p.masked : p.plain;
  return `<div class="pcard" data-pid="${esc(p.id)}">
    <div class="pcard-head"><span class="seat" aria-label="${esc(seatOf(i))}">${esc(seatOf(i))}</span>${tag ? `<span class="tag">${esc(tag)}</span>` : ''}<span class="muted num" data-len>${esc(t('play.chars', { n: [...text].length }))}</span></div>
    <div class="pcard-body" data-body>${renderText(text)}</div>
    ${rateButtons(c, p, t('play.cardOf', { seat: seatOf(i) }))}
    ${guess ? guessBlock(c, p) : ''}
  </div>`;
}
function toggleHtml(){
  const m = textMode();
  return `<div class="toggle" role="group" aria-label="${esc(t('play.textVersion'))}"><button type="button" data-act="textmode" data-v="plain" class="${m === 'plain' ? 'on' : ''}" aria-pressed="${m === 'plain'}">${esc(t('play.plain'))}</button><button type="button" data-act="textmode" data-v="masked" class="${m === 'masked' ? 'on' : ''}" aria-pressed="${m === 'masked'}">${esc(t('play.masked'))}</button></div>`;
}

function viewRound(c, n){
  const rounds = c.plan.rounds;
  if (!rounds.length) return redirect(c.plan.bonus.length ? `#/${c.key}/bonus` : `#/${c.key}/important`);
  if (!(n >= 1)) n = 1;
  if (n > rounds.length) n = rounds.length;
  const r = rounds[n - 1];
  const last = n === rounds.length;
  const body = `
    ${roundSteps(c, n - 1)}
    <div class="row between"><div class="eyebrow">${esc(t('play.issue'))}</div>${toggleHtml()}</div>
    <h1 class="mid">${esc(issueLabel(c, r.issueId))}</h1>
    ${r.cards.map((p, i) => cardHtml(c, p, i, { guess: true })).join('')}
    <div class="btns"><a class="btn ghost" href="${n > 1 ? `#/${c.key}/play/${n - 1}` : `#/${c.key}/lean`}" style="flex:0 0 38%">${esc(t('play.back'))}</a><a class="btn" id="nextbtn" data-act="next-round" data-n="${n}" href="${nextHash(c, n)}" ${roundDone(c, r) ? '' : 'aria-disabled="true"'}>${esc(last ? t('play.nextLast') : t('play.next'))}</a></div>
    <p class="muted" style="text-align:center" id="roundhint">${roundDone(c, r) ? '' : esc(t('play.hint')) + ' · '}<button class="linkbtn" data-act="skip-round" data-n="${n}">${esc(t('play.skip'))}</button></p>`;
  return { html: page(bar(raceLabel(c), `${n} / ${c.plan.steps}`), body), mount: () => { sfx('card_deal'); } };
}
const roundDone = (c, r) => r.cards.every(p => c.st.ratings[p.id] !== undefined);
const nextHash = (c, n) => n < c.plan.rounds.length ? `#/${c.key}/play/${n + 1}` : c.plan.bonus.length ? `#/${c.key}/bonus` : `#/${c.key}/important`;

// ---------------- B3 加分題 ----------------
function viewBonus(c){
  if (!c.plan.bonus.length) return redirect(`#/${c.key}/important`);
  const off = 0;
  const body = `
    ${roundSteps(c, c.plan.steps - 1)}
    <div class="row between"><div class="eyebrow">${esc(t('bonus.eyebrow'))}</div>${toggleHtml()}</div>
    <h1 class="mid">${esc(t('bonus.title'))}</h1>
    <p class="muted">${esc(t('bonus.sub'))}</p>
    ${c.plan.bonus.map((p, i) => cardHtml(c, p, c.plan.rounds.length ? i + off : i, { guess: false, tag: issueLabel(c, p.issueId) })).join('')}
    <div class="btns"><a class="btn ghost" href="#/${c.key}/play/${Math.max(1, c.plan.rounds.length)}" style="flex:0 0 38%">${esc(t('play.back'))}</a><a class="btn" href="#/${c.key}/important">${esc(t('play.nextLast'))}</a></div>`;
  return { html: page(bar(raceLabel(c), `${c.plan.steps} / ${c.plan.steps}`), body), mount: () => { sfx('card_deal'); } };
}

// ---------------- B4 重要議題 ----------------
function impRows(c){
  return c.plan.rounds.map(r => {
    const on = c.st.important.includes(r.issueId);
    return `<div class="wt"><span>${esc(issueLabel(c, r.issueId))}</span><button class="x2${on ? ' on' : ''}" data-act="x2" data-issue="${esc(r.issueId)}" aria-pressed="${on}">${esc(t('imp.x2'))}</button></div>`;
  }).join('');
}
function viewImportant(c){
  const body = `
    <h1 class="mid">${esc(t('imp.title'))}</h1>
    <p class="muted">${esc(t('imp.sub'))}</p>
    <div id="imps">${impRows(c) || `<p class="muted">${esc(t('imp.none'))}</p>`}</div>
    <div id="revealerr"></div>
    <button class="btn" id="revealbtn" data-act="reveal">${esc(t('imp.reveal'))}</button>
    <a class="btn ghost" href="${c.plan.bonus.length ? `#/${c.key}/bonus` : `#/${c.key}/play/${Math.max(1, c.plan.rounds.length)}`}">${esc(t('play.back'))}</a>`;
  return { html: page(bar(raceLabel(c), t('imp.meta')), body) };
}

// 猜作者：只送「有猜名字」的段落（'unknown' 不送）。同一局只送一次（st.sent.guess）。失敗不擋開票。
// 一定要在 fetchReveal 之前：先看答案再送「猜測」會灌高猜中率，遮蔽健康度就失真了。
async function sendGuesses(c){
  if (c.st.sent.guess) return;
  const known = new Set(c.data.passages.map(p => p.id));
  const guesses = Object.entries(c.st.guesses).filter(([id, v]) => known.has(id) && v !== 'unknown').map(([passage, name]) => ({ passage, name }));
  if (guesses.length){
    try { await postGuess(c.data.raceId, guesses); } catch { return; }
  }
  c.st.sent.guess = true; save(c);
}

// 唯一會 fetch reveal/ 的地方：玩家按下「開票」。
async function revealNow(c, btn){
  btn.disabled = true; const label = btn.textContent; btn.textContent = t('imp.revealing');
  try {
    await sendGuesses(c);   // 必須在 fetchReveal 之前
    await fetchReveal(c.data.raceId);
  } catch (e) {
    btn.disabled = false; btn.textContent = label;
    document.getElementById('revealerr').innerHTML = errorBox(t('imp.err'), 'reveal');
    return;
  }
  c.st.done = true; save(c);
  go(`#/${c.key}/reveal`);
}

// ---------------- C1 翻牌 ----------------
async function viewReveal(c){
  let rv;
  try { rv = await fetchReveal(c.data.raceId); } catch { return { html: page(bar(raceLabel(c), t('reveal.meta')), errorBox(t('imp.err'))) }; }
  if (reduceMotion()) return redirect(`#/${c.key}/result`);
  const items = [];
  c.plan.rounds.forEach(r => r.cards.forEach((p, i) => items.push({ p, seat: seatOf(i), issue: r.issueId })));
  c.plan.bonus.forEach((p, i) => items.push({ p, seat: seatOf(i), issue: p.issueId }));
  const cardsHtml = items.map(({ p, seat, issue }) => {
    const nm = rv.get(p.id)?.candidate?.name ?? '?';
    return `<div class="flip"><div class="cardback"></div><div class="face"><b>${esc(nm)}</b>${esc(issueLabel(c, issue))} ${esc(seat)}</div></div>`;
  }).join('');
  const body = `
    <h1 class="mid" style="text-align:center">${esc(t('reveal.title'))}</h1>
    <div class="flipgrid" id="flipgrid">${cardsHtml}</div>
    <a class="btn ghost" id="flipbtn" href="#/${c.key}/result">${esc(t('reveal.skip'))}</a>
    <p class="muted" style="text-align:center">${esc(t('reveal.hint'))}</p>`;
  return {
    html: page(bar(raceLabel(c), t('reveal.meta')), body),
    mount(el){
      const flips = [...el.querySelectorAll('.flip')];
      const timers = [];
      const gap = Math.min(120, Math.floor(1500 / Math.max(1, flips.length)));
      sfx('shuffle');
      flips.forEach((f, i) => timers.push(setTimeout(() => { f.classList.add('open'); if (i % 3 === 0) sfx('card_flip'); }, 500 + i * gap)));
      timers.push(setTimeout(() => {
        sfx('reveal');
        const b = el.querySelector('#flipbtn'); if (b){ b.textContent = t('reveal.see'); b.className = 'btn'; }
      }, 500 + flips.length * gap + 400));
      return () => timers.forEach(clearTimeout);
    },
  };
}

// ---------------- C2 結果 ----------------
let enginePromise = null;
const getEngine = () => enginePromise || (enginePromise = import('./engine/score.mjs'));

async function compute(c, rv){
  const eng = await getEngine();
  const st = c.st;
  const passages = c.data.passages.map(p => {
    const r = rv.get(p.id);
    if (!r || !r.candidate) throw new Error('reveal missing ' + p.id);
    return { id: p.id, issueId: p.issueId, candidateId: r.candidate.name };
  });
  const ratings = {};
  for (const p of passages) if (st.ratings[p.id] !== undefined) ratings[p.id] = st.ratings[p.id];
  const important = st.important.filter(i => c.plan.rounds.some(r => r.issueId === i));
  const res = eng.score({ passages, ratings, important }, { rng: mulberry32(st.seed) });
  const lean = st.lean === null || st.lean === 'undecided' || st.lean === 'private' ? st.lean : st.lean;
  return { res, verdict: eng.verdict(lean, res), passages };
}
function guessStats(c, rv){
  let guessed = 0, correct = 0;
  for (const p of c.data.passages){
    const g = c.st.guesses[p.id];
    if (!g || g === 'unknown') continue;
    if (c.plan.bonus.some(b => b.id === p.id)) continue;
    guessed++;
    if (rv.get(p.id)?.candidate?.name === g) correct++;
  }
  return { guessed, correct };
}

const hasTop = comp => comp.res.top.some(n => comp.res.candidates.find(x => x.candidateId === n)?.score !== null);

// 全國（其實是這個選區）「傾向 vs 契合」：只看後端回的 blackout 與 verdicts，前端不算日期、不算門檻。
function natlHtml(c){
  const st = c.stats;
  if (!st) return { banner: '', box: '' };
  const name = raceLabel(c);
  const title = t('natl.title', { race: name });
  if (st.blackout){
    const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(c.data.meta.voteDate || '');
    const reopen = m ? t('blackout.reopen', { md: +m[1] + '/' + +m[2] }) : t('blackout.reopenNoDate');
    return {
      banner: `<div class="banner"><b>${esc(t('blackout.title'))}</b><span>${esc(t('blackout.body'))}</span></div>`,
      box: `<div class="verdict"><div class="eyebrow">${esc(title)}</div><div class="stack center" style="align-items:center;gap:6px;padding:10px 0"><img class="illo" src="assets/empty_state.webp" alt="" width="768" height="768" style="width:120px"><span class="muted">${esc(reopen)}</span></div></div><p class="muted">${esc(t('blackout.health'))} <a href="#/${c.key}/health">${esc(t('foot.health'))}</a></p>`,
    };
  }
  const v = st.verdicts;
  if (!v) return { banner: '', box: `<div class="verdict"><div class="eyebrow">${esc(title)}</div><p class="muted">${esc(t('natl.few', { n: st.plays }))}</p></div>` };
  const n = v.same + v.different;
  const body = n > 0
    ? `<div class="guessbox" style="border:0;padding:0"><div class="n">${Math.round(v.same / n * 100)}<small>%</small></div><div><b>${esc(t('natl.line', { race: name, p: Math.round(v.same / n * 100) }))}</b><p class="muted">${esc(t('natl.basis', { n }))}</p></div></div>`
    : `<p class="muted">${esc(t('natl.noLean'))}</p>`;
  return { banner: '', box: `<div class="verdict"><div class="eyebrow">${esc(title)}</div>${body}</div>` };
}
function fillNatl(c){
  const a = document.getElementById('natl-banner'), b = document.getElementById('natl-box'); if (!a || !b) return;
  const h = natlHtml(c); a.innerHTML = h.banner; b.innerHTML = h.box;
}
// 結果出來之後：送這一局（只有 race + verdict；同一局一次），再讀匯總。
async function afterResult(c, comp){
  if (!c.st.sent.play && !c.playBusy && hasTop(comp)){
    c.playBusy = true;
    try { await postPlay(c.data.raceId, comp.verdict); c.st.sent.play = true; save(c); } catch {}
    c.playBusy = false;
  }
  try { c.stats = await getStats(c.data.raceId); } catch { c.stats = null; }
  fillNatl(c);
}

function resultBody(c, rv, comp){
  const { res, verdict } = comp;
  const byName = new Map(res.candidates.map(x => [x.candidateId, x]));
  const topNames = res.top.filter(n => byName.get(n)?.score !== null);
  const topText = topNames.join('、');
  const st = c.st;
  let vsHtml, msg;
  if (verdict === 'none' && !topNames.length){
    vsHtml = `<div class="vs solo"><div class="who"><b>${esc(t('res.tooFew'))}</b></div></div>`;
    msg = t('res.tooFewSub');
  } else if (verdict === 'same' || verdict === 'different'){
    vsHtml = `<div class="vs"><div class="who">${esc(t('res.lean'))}<b>${esc(st.lean)}</b></div><div class="neq" role="img" aria-label="${esc(t(verdict === 'same' ? 'res.eq' : 'res.neq'))}">${verdict === 'same' ? '=' : '≠'}</div><div class="who">${esc(t('res.top'))}<b>${esc(topText)}</b></div></div>`;
    msg = t(verdict === 'same' ? 'res.sameMsg' : 'res.diffMsg');
  } else {
    vsHtml = `<div class="vs solo"><div class="who">${esc(t('res.top'))}<b>${esc(topText)}</b></div></div>`;
    msg = t('res.noneMsg');
  }
  const rows = c.data.candidates.map(cd => ({ name: cd.name, r: byName.get(cd.name) }))
    .sort((a, b) => (b.r?.score ?? -1e9) - (a.r?.score ?? -1e9) || c.order.indexOf(a.name) - c.order.indexOf(b.name));
  const scoreRows = rows.map(({ name, r }) => {
    if (!r || r.score === null){
      return `<div class="score"><span class="nm">${esc(name)}<br><span class="conf">${esc(t('res.noKey'))}</span></span><div class="axis"></div><span class="num">—</span></div>`;
    }
    const s = r.score;
    const bar = s >= 0 ? `left:50%;width:${s / 2}%` : `left:${50 + s / 2}%;width:${-s / 2}%`;
    const ci = `left:${50 + r.lo / 2}%;width:${Math.max(0.6, (r.hi - r.lo) / 2)}%`;
    return `<div class="score"><span class="nm">${esc(name)}${r.lowConfidence ? `<br><span class="conf">${esc(t('res.low', { n: r.n }))}</span>` : ''}</span><div class="axis"><i class="b${s < 0 ? ' neg' : ''}" style="${bar}"></i><i class="ci" style="${ci}"></i></div><span class="num">${sgn(s)}</span></div>`;
  }).join('');
  const gs = guessStats(c, rv);
  const guessHtml = gs.guessed
    ? `<div class="guessbox"><div class="n">${gs.correct}<small>/${gs.guessed}</small></div><div><b>${esc(t('res.guessTitle', { c: gs.correct }))}</b><p class="muted">${esc(t('res.guessBody', { n: gs.guessed, r: (gs.guessed / guessNames(c).length).toFixed(1) }))}</p></div></div>`
    : `<p class="muted">${esc(t('res.guessNone'))}</p>`;
  return `
    <div id="natl-banner" style="display:contents"></div>
    <div class="verdict"><div class="eyebrow">${esc(t('res.eyebrow'))}</div>${vsHtml}<p class="muted" style="text-align:center">${esc(msg)}</p><div class="stampmark" aria-hidden="true">${esc(t('res.stamp'))}</div></div>
    <div><div class="eyebrow" style="margin-bottom:6px">${esc(t('res.scoreTitle'))}</div>
      <div class="stack" style="gap:8px">${scoreRows}<div class="scale-lbl"><span></span><span><span>−100</span><span>0</span><span>+100</span></span><span></span></div></div>
      <p class="muted" style="margin-top:6px">${esc(t('res.range'))}</p></div>
    ${guessHtml}
    <div id="natl-box" style="display:contents"></div>
    <details><summary class="muted">${esc(t('res.adjust'))}</summary><div id="imps" style="margin-top:6px">${impRows(c) || `<p class="muted">${esc(t('imp.none'))}</p>`}</div></details>
    <div class="btns">${EMBED ? `<a class="btn" href="${esc(gameUrl(c))}" target="_blank" rel="noopener">${esc(t('embed.openResult'))}</a>` : `<a class="btn" href="#/${c.key}/share">${esc(t('res.share'))}</a>`}<button class="btn ghost" data-act="again">${esc(t('res.again'))}</button></div>
    <a class="btn line" href="#/${c.key}/detail">${esc(t('res.detail'))}</a>
    <p class="muted">${esc(t('res.disclaimer'))}</p>`;
}

async function viewResult(c){
  let rv, comp;
  try { rv = await fetchReveal(c.data.raceId); } catch { return { html: page(bar(raceLabel(c), t('res.meta')), errorBox(t('imp.err'))) }; }
  try { comp = await compute(c, rv); } catch (e) { console.error(e); return { html: page(bar(raceLabel(c), t('res.meta')), errorBox(t('err.engine'))) }; }
  c.lastComp = { rv, comp };
  return { html: page(bar(raceLabel(c), t('res.meta')), `<div id="resbody" style="display:contents">${resultBody(c, rv, comp)}</div>`), mount: () => { fillNatl(c); afterResult(c, comp); } };
}
async function refreshResult(c){
  const rv = await fetchReveal(c.data.raceId);
  const comp = await compute(c, rv);
  const el = document.getElementById('resbody'); if (!el) return;
  const open = el.querySelector('details')?.open;
  el.innerHTML = resultBody(c, rv, comp);
  if (open) el.querySelector('details').open = true;
  fillNatl(c);
}

// ---------------- C3 明細 ----------------
let detailFilter = 'all';
async function viewDetail(c){
  let rv;
  try { rv = await fetchReveal(c.data.raceId); } catch { return { html: page(bar(raceLabel(c), t('det.meta')), errorBox(t('imp.err'))) }; }
  const chips = [`<button class="chip${detailFilter === 'all' ? ' on' : ''}" data-act="dfilter" data-v="all">${esc(t('det.all'))}</button>`]
    .concat(c.plan.rounds.map(r => `<button class="chip${detailFilter === r.issueId ? ' on' : ''}" data-act="dfilter" data-v="${esc(r.issueId)}">${esc(issueLabel(c, r.issueId))}</button>`)).join('');
  const det = (p, i, issueTag) => {
    const r = rv.get(p.id) || {};
    const name = r.candidate?.name ?? '?';
    const v = c.st.ratings[p.id];
    const g = c.st.guesses[p.id];
    let gtag = `<span class="tag">${esc(t('det.noGuess'))}</span>`, gcls = '';
    if (g && g !== 'unknown' && !issueTag){
      if (g === name){ gtag = `<span class="tag ok">${esc(t('det.right'))}</span>`; gcls = 'right'; }
      else { gtag = `<span class="tag no">${esc(t('det.wrong', { name: g }))}</span>`; gcls = 'wrong'; }
    }
    const src = safeUrl(r.sourceUrl);
    const srcHtml = `<p class="src">${esc(t('det.source'))}：${src ? `<a href="${esc(src)}" target="_blank" rel="noopener noreferrer">${esc(hostOf(src))}</a>` : ''} · ${esc(r.sourceDate || '')} · ${esc(has('type.' + r.sourceType) ? t('type.' + r.sourceType) : (r.sourceType || ''))}</p>`;
    return `<div class="det" data-guess="${gcls}"><div class="det-top"><span><b>${esc(name)}</b> · ${esc(issueTag || seatOf(i))}</span><span class="row" style="gap:4px"><span class="tag">${esc(v === undefined ? t('det.unscored') : t('det.yourScore', { v: sgn(v) }))}</span>${issueTag ? '' : gtag}</span></div>
      <p class="t">${esc(p.plain)}</p>
      <div class="orig" hidden>${esc(r.original || '')}</div>${srcHtml}
      <div class="row"><button class="chip" data-act="orig">${esc(t('det.original'))}</button></div></div>`;
  };
  const allNames = c.data.candidates.map(x => x.name);
  const sections = c.plan.rounds.map(r => {
    const authors = new Set(r.cards.map(p => rv.get(p.id)?.candidate?.name));
    const absent = allNames.filter(n => !authors.has(n));
    return `<section data-issue="${esc(r.issueId)}" class="stack" style="gap:10px"><h2 class="mid">${esc(issueLabel(c, r.issueId))}</h2>${r.cards.map((p, i) => det(p, i)).join('')}${absent.length ? `<p class="muted">${esc(t('det.noPassage', { names: absent.join('、') }))}</p>` : ''}</section>`;
  }).join('');
  const bonus = c.plan.bonus.length ? `<section data-issue="__bonus" class="stack" style="gap:10px"><div class="hr"></div><div class="eyebrow">${esc(t('det.bonus'))}</div>${c.plan.bonus.map((p, i) => det(p, i, issueLabel(c, p.issueId))).join('')}</section>` : '';
  const body = `<div class="row">${chips}</div>${sections}${bonus}<a class="btn line" href="#/${c.key}/result">${esc(t('det.back'))}</a>`;
  return {
    html: page(bar(raceLabel(c), t('det.meta')), body),
    mount(el){
      applyFilter(el);
      if (!('IntersectionObserver' in window)) return;
      const seen = new Set();
      const io = new IntersectionObserver(es => es.forEach(e => {
        if (!e.isIntersecting || seen.has(e.target)) return;
        const g = e.target.dataset.guess; if (!g) return;
        seen.add(e.target); sfx(g === 'right' ? 'guess_right' : 'guess_wrong');
      }), { threshold: 0.8 });
      el.querySelectorAll('.det[data-guess]').forEach(n => io.observe(n));
      return () => io.disconnect();
    },
  };
}
function applyFilter(el){
  el.querySelectorAll('section[data-issue]').forEach(s => { s.hidden = detailFilter !== 'all' && s.dataset.issue !== detailFilter; });
  el.querySelectorAll('[data-act=dfilter]').forEach(b => { b.classList.toggle('on', b.dataset.v === detailFilter); });
}
function safeUrl(u){ try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } }
function hostOf(u){ try { return new URL(u).hostname; } catch { return u; } }

// ---------------- D1 遮蔽健康度 ----------------
const HEALTH_MIN = 30;   // 少於這麼多人作答：寫「樣本還不夠」，不畫條
async function viewHealth(c){
  const barHtml = bar(raceLabel(c), t('health.meta'));
  const back = `<a class="btn ghost" href="#/${c.key}">${esc(t('common.back'))}</a>`;
  let h;
  try { h = await getHealth(c.data.raceId); } catch { return { html: page(barHtml, errorBox(t('health.err')) + back, footer(c.key)) }; }
  const byId = new Map((h.passages || []).map(p => [p.id, p]));
  // 列的順序：議題照資料出現順序；同議題內照段落 id 排（不用資料檔的順序，免得順序和作者有關）。甲乙丙只是這頁的列號。
  const issues = [];
  for (const p of c.data.passages) if (!issues.includes(p.issueId)) issues.push(p.issueId);
  const rows = [];
  for (const iss of issues){
    c.data.passages.filter(p => p.issueId === iss).sort((a, b) => (a.id < b.id ? -1 : 1)).forEach((p, i) => rows.push({ iss, seat: seatOf(i), h: byId.get(p.id) || { answers: 0, correct: 0, rate: null, random: null, flagged: false } }));
  }
  const ok = rows.filter(r => r.h.answers >= HEALTH_MIN && typeof r.h.rate === 'number');
  const sumA = ok.reduce((x, r) => x + r.h.answers, 0), sumC = ok.reduce((x, r) => x + r.h.correct, 0);
  const rnd = ok.length ? ok.reduce((x, r) => x + r.h.random, 0) / ok.length : null;
  const pct = v => Math.round(v * 100);
  const summary = ok.length ? t('health.summary', { x: pct(sumC / sumA), y: pct(rnd) }) : t('health.none');
  const rowHtml = rows.map(r => {
    const lbl = `${esc(issueLabel(c, r.iss))} ${esc(r.seat)}${r.h.flagged ? ` <span class="flag">${esc(t('health.flag'))}</span>` : ''}`;
    if (r.h.answers < HEALTH_MIN || typeof r.h.rate !== 'number') return `<div class="hbar"><span>${lbl}</span><span class="muted" style="grid-column:2/4">${esc(t('health.few'))}</span></div>`;
    return `<div class="hbar"><span>${lbl}</span><div class="htrack" role="img" aria-label="${esc(t('health.rowAlt', { x: pct(r.h.rate), y: pct(r.h.random) }))}"><i class="${r.h.flagged ? 'hot' : ''}" style="width:${Math.min(100, r.h.rate * 100)}%"></i><u style="left:${r.h.random * 100}%"></u></div><span class="num">${pct(r.h.rate)}%</span></div>`;
  }).join('');
  const body = `
    <h1 class="mid">${esc(t('health.title'))}</h1>
    <p class="muted">${esc(t('health.sub'))}</p>
    <div class="row between" style="align-items:baseline"><span class="eyebrow">${esc(t('health.n', { race: raceLabel(c), n: rows.length }))}</span></div>
    <p class="num" style="font-size:15px;font-weight:600">${esc(summary)}</p>
    <div class="stack" style="gap:10px">${rowHtml}</div>
    <p class="muted">${esc(t('health.note'))}</p>
    ${back}`;
  return { html: page(barHtml, body, footer(c.key)) };
}

// ---------------- C4 分享 ----------------
// 圖卡在瀏覽器用 canvas 畫成 1200×630 PNG：預覽就是會下載的那張。預設不放姓名（owner 裁決 2026-10-21），勾選才放。
let shareNames = false;
const OG_W = 1200, OG_H = 630;
const gameUrl = c => location.origin + location.pathname + '#/' + c.key;
const shareUrl = gameUrl;
const siteLabel = () => location.host + location.pathname.replace(/index\.html$/, '').replace(/\/$/, '');
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

async function drawCard(canvas, c, info){
  const ctx = canvas.getContext('2d');
  const fam = '"LXGW WenKai TC","Kaiti TC","STKaiti",serif', sans = '"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif', mono = '"IBM Plex Mono",ui-monospace,Consolas,monospace';
  try { await Promise.race([Promise.all([document.fonts.load(`700 60px ${fam}`, info.sample), document.fonts.load(`400 28px ${sans}`, info.sample), document.fonts.load(`500 28px ${mono}`)]), new Promise(r => setTimeout(r, 2500))]); } catch {}
  ctx.clearRect(0, 0, OG_W, OG_H);
  ctx.fillStyle = '#FBF6EA'; ctx.fillRect(0, 0, OG_W, OG_H);
  try { ctx.drawImage(await loadImg('assets/og_bg.webp'), 0, 0, OG_W, OG_H); } catch {}
  const X = 72, MAXW = 520, sp = lang() === 'en' ? ' ' : '';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#5E5A54'; ctx.font = `400 28px ${sans}`;
  ctx.fillText(info.eyebrow, X, 100);
  // 標題：三行；第二行最後接紅字。字級縮到最寬的一行放得進左半邊。
  const [a0, a1 = ''] = info.a.split('\n');
  const lns = [[[a0, 0]], [[a1 ? a1 + sp : '', 0], [info.em + sp, 1]], [[info.b, 0]]];
  const fit = size => { ctx.font = `700 ${size}px ${fam}`; return Math.max(...lns.map(l => l.reduce((w, [tx]) => w + ctx.measureText(tx).width, 0))); };
  let size = 80; const w1 = fit(100); size = Math.min(80, Math.floor(100 * MAXW / w1));
  ctx.font = `700 ${size}px ${fam}`;
  let y = 100 + size * 1.55;
  for (const l of lns){
    let x = X;
    for (const [tx, hot] of l){ ctx.fillStyle = hot ? '#C4321F' : '#1F1D1B'; ctx.fillText(tx, x, y); x += ctx.measureText(tx).width; }
    y += size * 1.3;
  }
  if (info.names){
    ctx.fillStyle = '#1F1D1B'; ctx.font = `700 36px ${fam}`;
    let nm = info.names; while (ctx.measureText(nm).width > MAXW && nm.length > 4) nm = nm.slice(0, -2) + '…';
    ctx.fillText(nm, X, y - 24);
  }
  ctx.fillStyle = '#5E5A54'; ctx.font = `500 28px ${mono}`;
  ctx.fillText(info.url, X, OG_H - 48);
  if (info.foot){ ctx.fillStyle = '#1F1D1B'; ctx.font = `500 30px ${mono}`; ctx.fillText(info.foot, X, OG_H - 96); }
}

async function viewShare(c){
  let rv, comp;
  try { rv = await fetchReveal(c.data.raceId); comp = await compute(c, rv); } catch { return { html: page(bar(raceLabel(c), t('share.meta')), errorBox(t('err.engine'))) }; }
  const gs = guessStats(c, rv);
  const kind = comp.verdict === 'same' ? 'same' : comp.verdict === 'different' ? 'diff' : 'none';
  const top = comp.res.top.filter(n => comp.res.candidates.find(x => x.candidateId === n)?.score !== null).join('、');
  const body = `
    <h1 class="mid">${esc(t('share.title'))}</h1>
    <canvas id="ogcanvas" class="ogcanvas" width="${OG_W}" height="${OG_H}" role="img" aria-label="${esc(t('share.cardAlt'))}"></canvas>
    <label class="opt" style="cursor:pointer"><input type="checkbox" id="showNames" ${shareNames ? 'checked' : ''}> <span>${esc(t('share.names'))}<small>${esc(t('share.namesSub'))}</small></span></label>
    <a class="btn" data-act="download" id="dlbtn" download="covervote.png" href="#/${c.key}/share" aria-disabled="true">${esc(t('share.download'))}</a>
    <div class="btns"><a class="btn ghost" data-act="line" id="linebtn" href="#/${c.key}/share" target="_blank" rel="noopener noreferrer">${esc(t('share.line'))}</a><button class="btn ghost" data-act="copy">${esc(t('share.copy'))}</button></div>
    <a class="btn line" href="#/${c.key}/result">${esc(t('det.back'))}</a>`;
  return {
    html: page(bar(raceLabel(c), t('share.meta')), body),
    mount(el){
      const cv = el.querySelector('#ogcanvas'), dl = el.querySelector('#dlbtn');
      el.querySelector('#linebtn').href = 'https://social-plugins.line.me/lineit/share?url=' + encodeURIComponent(gameUrl(c));
      let blobUrl = '', gen = 0, alive = true;
      const redraw = async () => {
        const my = ++gen;
        const info = { eyebrow: t('share.eyebrow', { race: raceLabel(c) }), a: t(`share.${kind}.a`), em: t(`share.${kind}.em`), b: t(`share.${kind}.b`),
          names: shareNames && top ? t('share.nameLine', { names: top }) : '',
          foot: gs.guessed ? t('share.foot', { c: gs.correct, n: gs.guessed }) : '', url: siteLabel() };
        info.sample = info.eyebrow + info.a + info.em + info.b + info.names + info.foot + info.url;
        await drawCard(cv, c, info);
        if (my !== gen || !alive) return;
        cv.toBlob(b => {
          if (!b || my !== gen || !alive) return;
          if (blobUrl) URL.revokeObjectURL(blobUrl);
          blobUrl = URL.createObjectURL(b); dl.href = blobUrl; dl.removeAttribute('aria-disabled');
        }, 'image/png');
      };
      el.querySelector('#showNames').addEventListener('change', e => { shareNames = e.target.checked; dl.setAttribute('aria-disabled', 'true'); redraw(); });
      dl.addEventListener('click', e => { if (dl.getAttribute('aria-disabled') === 'true') e.preventDefault(); });
      redraw();
      return () => { alive = false; if (blobUrl) URL.revokeObjectURL(blobUrl); };
    },
  };
}

// ---------------- D4 靜態頁 ----------------
function viewInfo(tab){
  const tabs = ['method', 'sources', 'privacy', 'about'];
  if (!tabs.includes(tab)) tab = 'method';
  const chips = tabs.map(k => `<a class="chip${k === tab ? ' on' : ''}" href="#/info/${k}" aria-current="${k === tab}">${esc(t('info.tab.' + k))}</a>`).join('');
  let content = '';
  if (tab === 'method') content = `<h1 class="mid">${esc(t('info.method.title'))}</h1><ol class="stack" style="padding-left:18px;margin:0;font-size:14px;gap:6px">${[1, 2, 3, 4, 5].map(i => `<li>${esc(t('info.method.' + i))}</li>`).join('')}</ol>`;
  if (tab === 'sources') content = `<h1 class="mid">${esc(t('info.sources.title'))}</h1><p style="font-size:14px">${esc(t('info.sources.body'))}</p>`;
  if (tab === 'about') content = `<h1 class="mid">${esc(t('info.about.title'))}</h1><p style="font-size:14px">${esc(t('info.about.body'))}</p>`;
  if (tab === 'privacy') content = `<h1 class="mid">${esc(t('info.privacy.title'))}</h1><table><tr><th>${esc(t('info.privacy.th1'))}</th><th>${esc(t('info.privacy.th2'))}</th></tr>`
    + [1, 2, 3, 4].map(i => `<tr><td>${esc(t('info.privacy.r' + i + 'a'))}</td><td>${esc(t('info.privacy.r' + i + 'b'))}</td></tr>`).join('')
    + `</table><p class="muted">${esc(t('info.privacy.fonts'))}</p><p class="muted">${esc(t('info.privacy.note'))}</p>`;
  return { html: page(bar(t('brand'), t('info.meta')), `<div class="row">${chips}</div>${content}<a class="btn ghost" href="#/">${esc(t('common.home'))}</a>`, footer()) };
}

// ---------------- 給媒體 #/embed ----------------
// 只講「可以免費嵌入」與怎麼貼；不寫價格、不寫合作條件（owner 的事）。信箱是佔位字串，待 owner 確認。
function embedSnippet(key){
  return `<iframe id="covervote" src="${FULL_URL}?embed=1#/${key}" title="${t('media.iframeTitle')}"
  style="width:100%;max-width:720px;height:640px;border:0" loading="lazy"></iframe>
<script>
window.addEventListener('message', function (e) {
  if (!e.data || e.data.type !== 'covervote:height') return;
  var f = document.getElementById('covervote');
  if (f && e.source === f.contentWindow) f.style.height = e.data.height + 'px';
});
</script>`;
}
async function viewMedia(){
  const ready = await readyMetros();
  const key = [...ready.keys()][0] || 'taipei';
  const code = embedSnippet(key);
  const src = location.pathname + '?embed=1#/' + key;
  const body = `
    <h1 class="mid">${esc(t('media.title'))}</h1>
    <p>${esc(t('media.lead'))}</p>
    <p>${esc(t('media.why'))} <a href="#/${esc(key)}/health">${esc(t('media.health'))}</a></p>
    <div class="eyebrow">${esc(t('media.codeTitle'))}</div>
    <pre class="code" tabindex="0"><code>${esc(code)}</code></pre>
    <button class="btn ghost" data-act="copycode">${esc(t('media.copy'))}</button>
    <p class="muted">${esc(t('media.codeNote'))}</p>
    <p class="muted">${esc(t('media.promise'))}</p>
    <div class="eyebrow">${esc(t('media.previewTitle'))}</div>
    <iframe id="mediaprev" class="prev" src="${esc(src)}" title="${esc(t('media.iframeTitle'))}" loading="lazy"></iframe>
    <div class="eyebrow">${esc(t('media.contactTitle'))}</div>
    <p>${esc(t('media.contactBody'))}<span class="num">${esc(t('media.contactMail'))}</span> <span class="muted">${esc(t('media.contactTodo'))}</span></p>`;
  return {
    html: page(bar(t('brand'), t('media.meta')), body + `<a class="btn ghost" href="#/">${esc(t('common.home'))}</a>`, footer()),
    mount(el){
      const f = el.querySelector('#mediaprev');
      const on = e => { if (e.source === f.contentWindow && e.data && e.data.type === 'covervote:height' && e.data.height > 0) f.style.height = e.data.height + 'px'; };
      window.addEventListener('message', on);
      el.dataset.code = code;
      return () => window.removeEventListener('message', on);
    },
  };
}

// 嵌入模式：畫面高度一改變就通知嵌入方（只送高度，不送任何其他東西）。
function reportHeight(){
  if (!EMBED || window.parent === window) return;
  let last = -1;
  const send = () => {
    const h = Math.ceil(document.body.getBoundingClientRect().height);
    if (h === last || h <= 0) return;
    last = h;
    try { window.parent.postMessage({ type: 'covervote:height', height: h }, '*'); } catch {}
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(send).observe(document.body);
  new MutationObserver(send).observe(root, { childList: true, subtree: true, attributes: true });
  window.addEventListener('load', send);
  send();
}

// ---------------- 事件 ----------------
function curCtx(){ const seg = parse(); return seg[0] ? ctxs.get(seg[0]) : null; }
function setPressed(btns, pred){ btns.forEach(b => { const on = pred(b); b.classList.toggle('on', on); if (b.hasAttribute('aria-pressed')) b.setAttribute('aria-pressed', on); if (b.getAttribute('role') === 'radio') b.setAttribute('aria-checked', on); }); }

function refreshRound(c){
  const n = parseInt(parse()[2] || '1', 10);
  const r = c.plan.rounds[Math.min(Math.max(n, 1), c.plan.rounds.length) - 1];
  if (!r) return;
  const done = roundDone(c, r);
  const nb = document.getElementById('nextbtn');
  if (nb){ if (done) nb.removeAttribute('aria-disabled'); else nb.setAttribute('aria-disabled', 'true'); }
  const h = document.getElementById('roundhint');
  if (h){ const first = h.firstChild; if (first && first.nodeType === 3) first.textContent = done ? '' : t('play.hint') + ' · '; }
}

root.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act;
  const c = curCtx();
  switch (act){
    case 'sound': {
      setSound(!isSoundOn());
      const on = isSoundOn();
      el.setAttribute('aria-pressed', on); el.innerHTML = on ? ICON_ON : ICON_OFF;
      el.setAttribute('aria-label', t(on ? 'sound.on' : 'sound.off')); el.title = t(on ? 'sound.on' : 'sound.off');
      if (on) sfx('tap');
      break;
    }
    case 'pick': {
      homePick = el.dataset.key; sfx('tap');
      setPressed([...root.querySelectorAll('.tile.live')], b => b.dataset.key === homePick);
      const sb = document.getElementById('startbtn'); sb.textContent = startLabel(); sb.removeAttribute('aria-disabled'); sb.href = '#/' + homePick;
      showPlays();
      const hl = document.getElementById('healthlink'); if (hl){ hl.href = `#/${homePick}/health`; hl.hidden = false; }
      break;
    }
    case 'start': if (!homePick) e.preventDefault(); break;
    case 'mask': toast(t('play.maskInfo', { n: el.dataset.n })); break;
    case 'reload': e.preventDefault(); render(); break;
    case 'restart': if (c){ const keep = c.st.menuOrder; Object.assign(c.st, freshState()); c.st.menuOrder = keep; save(c); rebuild(c); go(`#/${c.key}/lean`); } break;
    case 'lean': {
      if (!c) break;
      const v = el.dataset.v; c.st.lean = c.st.lean === v ? null : v; save(c); sfx('tap');
      setPressed([...root.querySelectorAll('[data-act=lean]')], b => b.dataset.v === c.st.lean);
      break;
    }
    case 'more': {
      root.querySelectorAll('[data-more]').forEach(n => n.hidden = false); el.hidden = true; break;
    }
    case 'lean-next': sfx('shuffle'); break;
    case 'textmode': {
      setTextMode(el.dataset.v); sfx('tap');
      root.querySelectorAll('[data-act=textmode]').forEach(b => { const on = b.dataset.v === el.dataset.v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
      if (c) root.querySelectorAll('.pcard[data-pid]').forEach(card => {
        const p = c.data.passages.find(x => x.id === card.dataset.pid); if (!p) return;
        const text = el.dataset.v === 'masked' ? p.masked : p.plain;
        card.querySelector('[data-body]').innerHTML = renderText(text);
        card.querySelector('[data-len]').textContent = t('play.chars', { n: [...text].length });
      });
      break;
    }
    case 'rate': {
      if (!c) break;
      c.st.ratings[el.dataset.pid] = parseInt(el.dataset.v, 10); save(c); sfx('stamp');
      setPressed([...el.parentElement.querySelectorAll('button')], b => b === el);
      refreshRound(c);
      if (c.st.done && document.getElementById('resbody')) refreshResult(c);
      break;
    }
    case 'guess': {
      if (!c) break;
      const pid = el.dataset.pid, v = el.dataset.v;
      if (c.st.guesses[pid] === v) delete c.st.guesses[pid]; else c.st.guesses[pid] = v;
      save(c); sfx('tap');
      setPressed([...el.parentElement.querySelectorAll('.chip')], b => b.dataset.v === c.st.guesses[pid]);
      break;
    }
    case 'skip-round': {
      if (!c) break;
      e.preventDefault();
      const n = parseInt(el.dataset.n, 10), r = c.plan.rounds[n - 1];
      r.cards.forEach(p => { delete c.st.ratings[p.id]; delete c.st.guesses[p.id]; });
      save(c); go(nextHash(c, n)); break;
    }
    case 'next-round': {
      if (el.getAttribute('aria-disabled') === 'true') e.preventDefault();
      break;
    }
    case 'x2': {
      if (!c) break;
      const id = el.dataset.issue, i = c.st.important.indexOf(id);
      if (i >= 0) c.st.important.splice(i, 1); else c.st.important.push(id);
      save(c); sfx('tap');
      el.classList.toggle('on', i < 0); el.setAttribute('aria-pressed', i < 0);
      if (c.st.done && document.getElementById('resbody')) refreshResult(c);
      break;
    }
    case 'reveal': if (c) await revealNow(c, document.getElementById('revealbtn')); break;
    case 'again': {
      if (!c) break;
      const keep = c.st.menuOrder, lean = c.st.lean;
      const s = freshState(); Object.assign(c.st, s); c.st.menuOrder = keep; c.st.lean = lean;
      save(c); rebuild(c); go(`#/${c.key}/lean`); break;
    }
    case 'dfilter': detailFilter = el.dataset.v; applyFilter(root); sfx('tap'); break;
    case 'orig': {
      const det = el.closest('.det'), o = det.querySelector('.orig'); o.hidden = !o.hidden;
      el.textContent = t(o.hidden ? 'det.original' : 'det.hideOriginal'); sfx('tap'); break;
    }
    case 'copycode': {
      const code = root.dataset.code || root.querySelector('pre.code')?.textContent || '';
      try { await navigator.clipboard.writeText(code); toast(t('media.copied')); }
      catch {
        try { const ta = document.createElement('textarea'); ta.value = code; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); toast(t(ok ? 'media.copied' : 'media.copyFail')); }
        catch { toast(t('media.copyFail')); }
      }
      break;
    }
    case 'copy': {
      if (!c) break;
      const url = shareUrl(c);
      try { await navigator.clipboard.writeText(url); toast(t('share.copied')); }
      catch {
        try { const ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); toast(t(ok ? 'share.copied' : 'share.copyFail')); }
        catch { toast(t('share.copyFail')); }
      }
      break;
    }
  }
});

window.addEventListener('hashchange', render);
// 先拿資料版本（最多等 3 秒）再畫第一個畫面，之後所有資料檔都帶 ?v=<sha>。
initVersion().then(() => { render(); reportHeight(); });
