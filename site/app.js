// site/app.js — 單頁 app：hash 路由與畫面（設計稿 A1–C4、D4）。FE 所有。
//
// 約束（issue #3）：
//  - 開票前不 fetch reveal/（只在 revealNow() 裡，由「開票」按鈕觸發）；DOM 與 localStorage 都沒有作者。
//  - 傾向、分數、猜作者只存本機（store.js）。不載入錄製腳本；Google Analytics 只在 analytics.js 的條件下載入，事件不帶任何政治資料（#21）。
//  - 分數一律呼叫 engine/score.mjs，FE 不自己算。候選人的鍵是姓名。
import { t, initLang, lang, has } from './i18n.js';
import { raceIdOf, cityKey, MIN_CLASS, TILES, METRO_KEYS, CEC_URL, FULL_URL } from './config.js';
import { initInternal, initClass, initFontSize, fontSize, setFontSize, FS_SIZES, classCode, newClassCode, loadClasses, saveClasses, CLASS_RE, isEmbed, loadState, saveState, freshState, hasProgress } from './store.js';
import { initSound, isSoundOn, setSound, sfx } from './sound.js';
import { hasVoice, syncSpeak, toggleSpeak, stopSpeaking } from './speech.js';
import { postGuess, postPlay, getHealth, getStats, getClass } from './api.js';
import { initAnalytics, trackPage, track, isOptedOut, setOptOut } from './analytics.js';
import { loadRace, loadIssues, fetchReveal, buildPlan, menuOrder, mulberry32, NotFound, initVersion } from './data.js';

initInternal();
initClass();
initFontSize();
initLang();
initSound();
initAnalytics();
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
const MENU_LINKS = [['#/info/method', 'foot.method'], ['#/info/sources', 'foot.sources'], ['#/info/privacy', 'foot.privacy'], ['#/info/about', 'foot.about'], ['#/embed', 'foot.media'], ['#/class', 'foot.class']];
// 首頁頁首的「≡」選單（#27）：頁尾那排連結搬進來。按鈕有 aria-expanded；Esc、點外面、Tab 離開都關。
const menuHtml = hk => `<button class="snd menu-btn" data-act="menu" aria-expanded="false" aria-controls="homemenu" aria-label="${esc(t('menu.label'))}"><span aria-hidden="true">≡</span></button>`
  + `<nav class="menu" id="homemenu" aria-label="${esc(t('menu.label'))}" hidden>${MENU_LINKS.map(([h, key]) => `<a href="${h}">${esc(t(key))}</a>` + (key === 'foot.sources' ? `<a id="menuhealth" href="#/${esc(hk)}/health">${esc(t('foot.health'))}</a>` : '')).join('')}</nav>`;
function bar(left, meta, menu, hk = 'taipei'){
  if (EMBED) return '';
  const on = isSoundOn();
  const sub = left && left !== t('brand') ? `<div class="subbar">${esc(left)}</div>` : '';
  return `<header class="bar${menu ? ' home-bar' : ''}"><a class="brand" href="#/" aria-label="${esc(t('brand.home'))}"><i></i>${esc(t('brand'))}</a><span class="bar-r">${menu ? '' : meta ? `<span class="meta num" id="barmeta">${esc(meta)}</span>` : '<span class="meta num" id="barmeta"></span>'}`
    + `<button class="fsz" data-act="fontsize" aria-label="${esc(t('font.label', { size: t('font.' + fontSize()) }))}">${esc(t('font.btn'))}<small>${esc(t('font.' + fontSize()))}</small></button>`
    + (menu ? menuHtml(hk) : '')
    + `<button class="snd" data-act="sound" aria-pressed="${on}" aria-label="${esc(t(on ? 'sound.on' : 'sound.off'))}" title="${esc(t(on ? 'sound.on' : 'sound.off'))}">${on ? ICON_ON : ICON_OFF}</button></span>${sub}</header>`;
}
const footer = healthKey => EMBED
  ? `<footer class="foot embed-foot"><a href="${FULL_URL}" target="_blank" rel="noopener">${esc(t('embed.full'))}</a></footer>`
  : `<footer class="foot">${healthKey !== undefined ? `<a id="healthlink" href="#/${esc(healthKey || '')}/health"${healthKey ? '' : ' hidden'}>${esc(t('foot.health'))}</a>` : ''}<a href="#/info/method">${esc(t('foot.method'))}</a><a href="#/info/sources">${esc(t('foot.sources'))}</a><a href="#/info/privacy">${esc(t('foot.privacy'))}</a><a href="#/info/about">${esc(t('foot.about'))}</a><a href="#/embed">${esc(t('foot.media'))}</a><a href="#/class">${esc(t('foot.class'))}</a></footer>`;
// 學生帶了格式正確的 ?class= 才有這一行；老師頁（#/class…）不顯示。
const classLine = () => { const c = classCode(); return c && parse()[0] !== 'class' ? `<div class="classline num" id="classline">${esc(t('class.line', { code: c }))}</div>` : ''; };
const page = (barHtml, body, foot = '', padCls = '') => `${barHtml}${classLine()}<main id="main" tabindex="-1"><div class="pad${padCls ? ' ' + padCls : ''}">${body}</div>${foot || (EMBED ? footer() : '')}</main>`;
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
  c.order = order;
  c.byName = new Map(c.data.candidates.map(x => [x.name, x]));
}
const save = c => saveState(c.data.raceId, c.st);
const issueLabel = (c, id) => (has('issue.' + id) ? t('issue.' + id) : c.issues.get(id) || id);
// 政黨粗分組（cands/ 的 group：kmt／dpp／oth；#37）。只在名字已公開的頁面使用：選傾向、開票翻牌、結果、明細、資料來源、分享卡。
const grpCls = g => (g === 'kmt' || g === 'dpp' ? g : 'oth');
const grpOf = (c, name) => grpCls(c.byName.get(name)?.group);
const faceHtml = (c, name, label, score, dim) => `<div class="face ${grpOf(c, name)}${dim ? ' dim' : ''}"><span class="who">${esc(label)}</span><span class="ring">${esc([...name][0])}</span><span class="nm">${esc(name)}</span>${score === null || score === undefined ? '' : `<b class="sc num">${sgn(score)}</b>`}</div>`;
const raceLabel = c => (has('race.' + c.key) ? t('race.' + c.key) : c.data.meta.label || c.key);
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
  try { return h.split('/').filter(Boolean).map(decodeURIComponent); }
  catch { return []; }   // 壞的百分比編碼：當成首頁（#31）
}
const go = hash => { location.hash = hash; };
let renderSeq = 0, cleanup = null, lastPv = null;

async function render(){
  const seq = ++renderSeq;
  if (cleanup){ try { cleanup(); } catch {} cleanup = null; }
  stopSpeaking();
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
  syncSpeak(root);
  const pv = location.hash;
  if (pv !== lastPv){ lastPv = pv; trackPage(); }   // 只在路由真的換了才算一次瀏覽（字級、重試的重畫不算）
}

async function route(seg){
  if (seg.length === 0) return viewHome();
  if (seg[0] === 'info') return viewInfo(seg[1] || 'method', seg[2] || '');
  if (seg[0] === 'embed') return viewMedia();
  if (seg[0] === 'class') return viewClass(seg[1] || '', METRO_KEYS.includes(cityKey(seg[2])) ? cityKey(seg[2]) : '');
  const key = cityKey(seg[0]), sub = seg[1] || '';
  if (!key || !METRO_KEYS.includes(key)) return viewMissing(key);   // 非六都：不發 race／cands 請求   // 不在 TILES 的鍵一律走「未收錄」，不碰抓檔也不進樣板
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
    case 'play': {
      if (c.st.done) return redirect(`#/${key}/result`);
      if (!c.plan.rounds.length) return viewRound(c, 1);
      if (seg[2] === undefined) return redirect(resumeHash(c));
      const k = normRound(c, seg[2]);
      if (String(k) !== seg[2]) return redirect(`#/${key}/play/${k}`);   // 越界／壞的輪次：修正網址
      return viewRound(c, k);
    }
    case 'bonus': return c.st.done ? redirect(`#/${key}/result`) : viewBonus(c);
    case 'important': return c.st.done ? redirect(`#/${key}/result`) : viewImportant(c);
    case 'reveal': return c.st.done ? viewReveal(c) : redirect(`#/${key}`);
    case 'result': return c.st.done ? viewResult(c) : redirect(`#/${key}`);
    case 'detail': return redirect(c.st.done ? `#/${key}/reveal` : `#/${key}`);   // 明細頁併入翻牌頁（#44）
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

// 英文縣市名放不進格子時只准在音節處折行（軟連字號，折了會顯示「-」），不准斷在字中間（#35）。只用在格子裡的顯示字，aria-label 與按鈕文字用原字。
const SOFT = { 'Lienchiang': 'Lien­chiang', 'Changhua': 'Chang­hua', 'Kaohsiung': 'Kao­hsiung', 'Taichung': 'Tai­chung', 'Taitung': 'Tai­tung', 'Pingtung': 'Ping­tung', 'Taoyuan': 'Tao­yuan', 'Hsinchu': 'Hsin­chu', 'Hsinchu C.': 'Hsin­chu C.', 'Keelung': 'Kee­lung' };
const tileText = key => { const n = t('tile.' + key); return lang() === 'en' && SOFT[n] ? SOFT[n] : n; };

async function viewHome(){
  const ready = await readyMetros();
  const last = lastCity();
  if (homePick !== null && !ready.has(homePick)) homePick = null;
  if (homePick === null && last && ready.has(last)) homePick = last;
  const tiles = TILES.map(tl => {
    const name = esc(tileText(tl.key));
    if (ready.has(tl.key)) return `<button class="tile live" style="grid-area:${tl.area}" data-act="pick" data-key="${esc(tl.key)}" aria-pressed="${homePick === tl.key}">${name}</button>`;
    if (tl.metro) return `<a class="tile soon" style="grid-area:${tl.area}" href="#/${esc(tl.key)}" aria-label="${esc(t('tile.' + tl.key) + ' ' + t('home.soon'))}"><span>${name}<small>${esc(t('home.soon'))}</small></span></a>`;
    return `<a class="tile" style="grid-area:${tl.area}" href="#/${esc(tl.key)}">${name}</a>`;
  }).join('');
  const body = `
    <div class="deckwrap" role="img" aria-label="${esc(t('home.heroAlt'))}">${[-2, -1, 0, 1, 2].map(i => `<i class="cb" style="--i:${i}"></i>`).join('')}<p class="wordmark">${esc(t('brand'))}</p></div>
    <h1 class="big tagline" style="--tl:${lang() === 'en' ? 24.2 : 12.3}">${esc(t('home.title'))}</h1>
    <div class="tiles" role="group" aria-label="${esc(t('home.mapLabel'))}">${tiles}</div>
    <div class="legend"><span><i class="sw"></i>${esc(t('home.legendOn'))}</span><span><i class="sw d"></i>${esc(t('home.legendOff'))}</span><span class="lg-soon">${esc(t('home.legendSoon'))}</span></div>
    <a class="btn" id="startbtn" href="${homePick ? '#/' + homePick : '#/'}" data-act="start" ${homePick ? '' : 'aria-disabled="true"'}>${esc(startLabel())}</a>
    <p class="homefoot"><span id="homecount"></span><span>${esc(t('home.free'))}</span>${EMBED ? '' : `<span><a class="more" href="https://games.csiesheep.com/">${esc(t('home.more'))}</a></span>`}<span id="plays" hidden></span></p>`;
  return { html: page(bar(t('brand'), '', true, homePick || [...ready.keys()][0] || 'taipei'), body, '', 'home'), mount: () => { fillCountdown(ready); fillPlays(ready); return mountMenu(); } };
}
// 「≡」選單：開啟時焦點進第一個連結；Esc 關並回到按鈕；點外面、Tab 離開也關。
function mountMenu(){
  const btn = document.querySelector('.menu-btn'), menu = document.getElementById('homemenu');
  if (!btn || !menu) return null;
  const setOpen = (open, focusBtn) => {
    menu.hidden = !open; btn.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('a')?.focus(); else if (focusBtn) btn.focus();
  };
  const onClick = e => {
    if (btn.contains(e.target)) { setOpen(menu.hidden, false); return; }
    if (!menu.hidden && !menu.contains(e.target)) setOpen(false, false);
  };
  const onKey = e => { if (e.key === 'Escape' && !menu.hidden) { e.preventDefault(); setOpen(false, true); } };
  const onFocusOut = e => { if (!menu.hidden && e.relatedTarget && !menu.contains(e.relatedTarget) && !btn.contains(e.relatedTarget)) setOpen(false, false); };
  document.addEventListener('click', onClick); document.addEventListener('keydown', onKey);
  menu.addEventListener('focusout', onFocusOut);
  return () => { document.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); };
}
// 「已有 N 局」：局數照常（靜默期也不受影響）；取不到或 0 就不顯示。
const playsCache = new Map();
function showPlays(){
  const el = document.getElementById('plays'); if (!el) return;
  const n = homePick ? playsCache.get(homePick) : 0;
  el.hidden = !(n > 0);
  if (n > 0) el.textContent = t('home.plays', { n });
  fitFoot();
}
// 最下面那一行放不下就拿掉局數（#27）
function fitFoot(){
  const f = document.querySelector('.homefoot'), el = document.getElementById('plays'); if (!f || !el || el.hidden) return;
  if (f.scrollWidth > f.clientWidth + 1 || f.offsetHeight > parseFloat(getComputedStyle(f).lineHeight) * 1.5) el.hidden = true;
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
// 今天（臺灣時間）的 UTC 零點毫秒；不用裝置時區（#31）
function taipeiToday(){
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day);
}
function fillCountdown(ready){
  for (const d of ready.values()){
    const vd = d.meta.voteDate;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(vd || ''); if (!m) continue;
    const md = `${+m[2]}/${+m[3]}`;
    const days = Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - taipeiToday()) / 86400000);
    const el = document.getElementById('homecount'); if (!el) return;
    el.textContent = days > 0 ? t('home.meta.vote', { md, d: days }) : days === 0 ? t('home.meta.today', { md }) : t('home.meta.over');
    return;
  }
}

// ---------------- A2 入口 / A3 未收錄 / 六都整理中 ----------------
async function viewMissing(key){
  const known = key && TILES.find(x => x.key === key);
  const city = known ? t('city.' + key) : t('city.unknown');
  if (known && known.metro){
    // 六都，但還沒有資料：不說「沒收錄」，說在整理、什麼時候公開，並指向已有資料的縣市
    const ready = await readyMetros();
    const first = [...ready.keys()][0];
    const body = `
      <img class="illo" src="assets/empty_state.webp" alt="" width="768" height="768" style="width:180px">
      <h1 class="mid">${esc(t('soon.title', { city }))}</h1>
      <p class="muted">${esc(t('soon.body'))}</p>
      ${first ? `<a class="btn" href="#/${esc(first)}">${esc(t('soon.playOther', { city: t('tile.' + first) }))}</a>` : ''}
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
      <tr><th>${esc(t('entry.candidates'))}</th><td class="num"><a href="#/info/sources/${esc(c.key)}">${esc(t('entry.nCandsIn', { n: c.data.candidates.length, k: c.data.candidates.filter(x => x.inPlay === true).length }))}</a></td></tr>
      <tr><th>${esc(t('entry.topicsTh'))}</th><td class="num">${esc(topics)}</td></tr>
      <tr><th>${esc(t('entry.passages'))}</th><td class="num">${esc(t('entry.passagesVal', { n: ps.length, avg }))}</td></tr>
      ${meta.join('')}
      <tr><th>${esc(t('entry.health'))}</th><td><a href="#/${esc(c.key)}/health">${esc(t('entry.healthVal'))}</a></td></tr>
    </table>
    ${prog && !c.st.done ? `<a class="btn" href="${resumeHash(c)}" data-act="resume">${esc(t('entry.resume'))}</a><button class="btn ghost" data-act="restart">${esc(t('entry.restart'))}</button>`
      : c.st.done ? `<a class="btn" href="#/${esc(c.key)}/result">${esc(t('res.meta'))}</a><button class="btn ghost" data-act="restart">${esc(t('res.again'))}</button>`
      : `<a class="btn" href="#/${esc(c.key)}/lean">${esc(t('entry.start'))}</a>`}
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
    return `<button class="opt" role="radio" aria-label="${esc(name + (Number.isInteger(cand.number) ? ", " + t("lean.no", { n: cand.number }) : ""))}" aria-checked="${on}" data-act="lean" data-v="${esc(name)}"${collapsed && i >= 3 ? ' data-more hidden' : ''}><span class="ava ${grpCls(cand.group)}" aria-hidden="true">${esc([...name][0])}</span><span>${esc(name)}<small><i class="pdot ${grpCls(cand.group)}"></i>${esc(t('group.' + grpCls(cand.group)))}</small>${no}</span></button>`;
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
    <a class="btn" href="#/${esc(c.key)}/play/1" data-act="lean-next">${esc(t('lean.next'))}</a>`;
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
// 唸給你聽：只唸這一段的白話版（plain）——開票前 payload 裡本來就沒有作者；遮蔽記號 ▇ 換成停頓。
// 沒有 zh-TW 聲音（或沒有 speechSynthesis）就先 hidden，syncSpeak 在聲音出現時才顯示。
const speakBtn = (label, extra) => `<button type="button" class="chip speak" data-act="speak" data-speak${hasVoice() ? '' : ' hidden'} aria-pressed="false" data-label-idle="${esc(label)}" data-label-stop="${esc(t('speak.stop'))}" ${extra}>${esc(label)}</button>`;
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
  return `<div class="pcard" data-pid="${esc(p.id)}" >
    <div class="pcard-head"><span class="headl"><span class="seat" aria-label="${esc(seatOf(i))}">${esc(seatOf(i))}</span>${speakBtn(t('speak.btn'), `data-pid="${esc(p.id)}" aria-label="${esc(t('speak.btn') + ' · ' + seatOf(i))}"`)}</span><span class="headr">${tag ? `<span class="tag">${esc(tag)}</span>` : ''}<span class="muted num" data-len>${esc(t('play.chars', { n: [...text].length }))}</span></span></div>
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
    <div class="backs" aria-hidden="true"><i class="back"></i><i class="back"></i></div>
    <div class="issuerow"><h1 class="mid">${esc(issueLabel(c, r.issueId))}</h1>${toggleHtml()}</div>
    ${r.cards.map((p, i) => cardHtml(c, p, i, { guess: true })).join('')}
    <div class="btns"><a class="btn ghost" href="${n > 1 ? `#/${esc(c.key)}/play/${n - 1}` : `#/${esc(c.key)}/lean`}" style="flex:0 0 38%">${esc(t('play.back'))}</a><a class="btn" id="nextbtn" data-act="next-round" data-n="${n}" href="${nextHash(c, n)}" ${roundDone(c, r) ? '' : 'aria-disabled="true"'}>${esc(last ? t('play.nextLast') : t('play.next'))}</a></div>
    <p class="muted" style="text-align:center" id="roundhint">${roundDone(c, r) ? '' : esc(t('play.hint')) + ' · '}<button class="linkbtn" data-act="skip-round" data-n="${n}">${esc(t('play.skip'))}</button></p>`;
  return { html: page(bar(raceLabel(c), `${n} / ${c.plan.steps}`), body), mount: () => { sfx('card_deal'); } };
}
// 輪次編號正規化：非整數、小於 1 → 1；超過 → 最後一輪
function normRound(c, raw){
  const n = /^[0-9]+$/.test(String(raw)) ? parseInt(raw, 10) : 1;
  return Math.min(Math.max(n, 1), c.plan.rounds.length);
}
// 「繼續」：接到第一個還沒做完的輪次；全做完就接到加分題／重要議題
function resumeHash(c){
  const i = c.plan.rounds.findIndex(r => !roundDone(c, r));
  return i >= 0 ? `#/${c.key}/play/${i + 1}` : nextHash(c, c.plan.rounds.length);
}
const roundDone = (c, r) => r.cards.every(p => c.st.ratings[p.id] !== undefined);
const nextHash = (c, n) => n < c.plan.rounds.length ? `#/${esc(c.key)}/play/${n + 1}` : c.plan.bonus.length ? `#/${esc(c.key)}/bonus` : `#/${esc(c.key)}/important`;

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
    <div class="btns"><a class="btn ghost" href="#/${esc(c.key)}/play/${Math.max(1, c.plan.rounds.length)}" style="flex:0 0 38%">${esc(t('play.back'))}</a><a class="btn" href="#/${esc(c.key)}/important">${esc(t('play.nextLast'))}</a></div>`;
  return { html: page(bar(raceLabel(c), `${c.plan.steps} / ${c.plan.steps}`), body), mount: () => { sfx('card_deal'); } };
}

// ---------------- B4 重要議題 ----------------
function impRows(c){
  return c.plan.rounds.map(r => {
    const on = c.st.important.includes(r.issueId);
    return `<div class="wt"><span>${esc(issueLabel(c, r.issueId))}</span><button class="x2${on ? ' on' : ''}" data-act="x2" data-issue="${esc(r.issueId)}" aria-pressed="${on}">${esc(t('imp.x2'))}</button></div>`;
  }).join('');
}
const handNote = c => t('imp.hand', { n: [...c.plan.rounds.flatMap(r => r.cards), ...c.plan.bonus].filter(p => c.st.ratings[p.id] !== undefined).length, k: c.st.important.length });
function viewImportant(c){
  const body = `
    <h1 class="mid">${esc(t('imp.title'))}</h1>
    <p class="muted">${esc(t('imp.sub'))}</p>
    <div id="imps">${impRows(c) || `<p class="muted">${esc(t('imp.none'))}</p>`}</div>
    <div class="felt small" id="handnote">${esc(handNote(c))}</div>
    <div id="revealerr"></div>
    <button class="btn" id="revealbtn" data-act="reveal">${esc(t('imp.reveal'))}</button>
    <a class="btn ghost" href="${c.plan.bonus.length ? `#/${esc(c.key)}/bonus` : `#/${esc(c.key)}/play/${Math.max(1, c.plan.rounds.length)}`}">${esc(t('play.back'))}</a>`;
  return { html: page(bar(raceLabel(c), t('imp.meta')), body) };
}

// 猜作者：只送「有猜名字」的段落（'unknown' 不送）。同一局只送一次（st.sent.guess）。失敗不擋開票。
// 一定要在 fetchReveal 之前：先看答案再送「猜測」會灌高猜中率，遮蔽健康度就失真了。
// 一局只試送一次（成功、失敗、逾時都算）；看過答案的人（st.seen / st.done）一律不送。失敗也不在看過答案之後補送（#31）。
async function sendGuesses(c){
  if (c.st.sent.guess || c.st.done || c.st.seen){ c.st.sent.guess = true; save(c); return; }
  c.st.sent.guess = true; save(c);
  const known = new Set(c.data.passages.map(p => p.id));
  const guesses = Object.entries(c.st.guesses).filter(([id, v]) => known.has(id) && v !== 'unknown').map(([passage, name]) => ({ passage, name }));
  if (guesses.length){
    try { await postGuess(c.data.raceId, guesses); } catch {}
  }
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
  c.st.done = true; c.st.seen = true; save(c);
  track('reveal', c.key);
  c.justRevealed = true;   // 這一次進翻牌頁才播動畫；之後再進來直接顯示翻好的牌
  go(`#/${c.key}/reveal`);
}

// ---------------- C1 翻牌 ----------------
const scoreBadge = v => v === undefined ? `<span class="badge skip">${esc(t('rev.skip'))}</span>` : `<span class="badge${v < 0 ? ' neg' : v === 0 ? ' zero' : ''}">${sgn(v)}</span>`;
async function viewReveal(c){
  let rv;
  try { rv = await fetchReveal(c.data.raceId); } catch { return { html: page(bar(raceLabel(c), t('reveal.meta')), errorBox(t('imp.err'))) }; }
  const animate = c.justRevealed === true; c.justRevealed = false;
  if (animate && reduceMotion()) return redirect(`#/${c.key}/result`);
  const items = [];
  c.plan.rounds.forEach(r => r.cards.forEach((p, i) => items.push({ p, seat: seatOf(i), issue: r.issueId })));
  c.plan.bonus.forEach((p, i) => items.push({ p, seat: seatOf(i), issue: p.issueId }));
  const cardsHtml = items.map(({ p, seat, issue }, k) => {
    const nm = rv.get(p.id)?.candidate?.name ?? '?';
    const v = c.st.ratings[p.id];
    return `<div class="flip${animate ? '' : ' open'}" data-k="${k}" data-pid="${esc(p.id)}"><div class="cardback"></div><div class="face ${grpOf(c, nm)}"><span class="ring">${esc([...nm][0])}</span><b>${esc(nm)}</b><span class="fi">${esc(issueLabel(c, issue))} ${esc(seat)}</span>${scoreBadge(v)}</div></div>`;
  }).join('');
  const body = `
    <h1 class="mid" style="text-align:center">${esc(t('reveal.title'))}</h1>
    <div class="flipgrid" id="flipgrid">${cardsHtml}</div>
    <a class="${animate ? 'btn ghost' : 'btn'}" id="flipbtn" href="#/${esc(c.key)}/result">${esc(t(animate ? 'reveal.skip' : 'reveal.see'))}</a>${animate ? `
    <p class="muted" id="revhint" style="text-align:center">${esc(t('reveal.hint'))}</p>` : ''}`;
  const openSheet = (el, k, opener) => {
    const { p, seat, issue } = items[k];
    const r = rv.get(p.id) || {};
    const nm = r.candidate?.name ?? '?', g = grpOf(c, nm), v = c.st.ratings[p.id];
    const src = safeUrl(r.sourceUrl);
    const typ = has('type.' + r.sourceType) ? t('type.' + r.sourceType) : (r.sourceType || '');
    const host = document.createElement('div');
    host.className = 'sheetbg';
    host.innerHTML = `<div class="sheet ${g}" role="dialog" aria-modal="true" aria-label="${esc(t('rev.dialog', { name: nm }))}">
      <div class="grab" aria-hidden="true"></div>
      <div class="shd"><span class="ring">${esc([...nm][0])}</span><div class="who"><b>${esc(nm)}</b><small>${esc(t('group.' + g))}・${esc(issueLabel(c, issue))} ${esc(seat)}</small></div><button type="button" class="x" data-sheet-close aria-label="${esc(t('rev.close'))}">✕</button></div>
      <div class="lbl">${esc(t('rev.yourScore'))}</div>
      <div class="bigscale" role="img" aria-label="${esc(v === undefined ? t('rev.skip') : sgn(v) + ' ' + t('rate.' + v))}">${[-2, -1, 0, 1, 2].map(x => `<span class="${v === x ? 'on' : ''}">${sgn(x)}<small>${esc(t('rate.' + x))}</small></span>`).join('')}</div>
      ${v === undefined ? `<div class="gline">${esc(t('rev.skipped'))}</div>` : ''}
      <div class="tabs" role="group"><button type="button" aria-pressed="true" data-tab="plain">${esc(t('play.plain'))}</button><button type="button" aria-pressed="false" data-tab="orig">${esc(t('rev.orig'))}</button></div>
      <p class="txt" data-txt>${esc(p.plain)}</p>
      <div class="srcline"><span>${esc(t('det.sourceLabel'))}${esc(typ)}${r.sourceDate ? '・' + esc(r.sourceDate) : ''}</span>${src ? `<a href="${esc(src)}" target="_blank" rel="noopener noreferrer">${esc(hostOf(src))} ↗</a>` : ''}</div>
    </div>`;
    document.body.appendChild(host);
    const dlg = host.querySelector('.sheet');
    const focusables = () => [...dlg.querySelectorAll('button, a[href]')];
    const close = () => { host.remove(); document.removeEventListener('keydown', onKey, true); if (opener && document.contains(opener)) opener.focus(); };
    const onKey = ev => {
      if (ev.key === 'Escape'){ ev.preventDefault(); close(); return; }
      if (ev.key === 'Tab'){
        const f = focusables(); if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (ev.shiftKey && document.activeElement === first){ ev.preventDefault(); last.focus(); }
        else if (!ev.shiftKey && document.activeElement === last){ ev.preventDefault(); first.focus(); }
        else if (!dlg.contains(document.activeElement)){ ev.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    host.addEventListener('click', ev => {
      if (ev.target === host || ev.target.closest('[data-sheet-close]')){ close(); return; }
      const tb = ev.target.closest('[data-tab]');
      if (tb){ dlg.querySelectorAll('[data-tab]').forEach(x => x.setAttribute('aria-pressed', String(x === tb))); dlg.querySelector('[data-txt]').textContent = tb.dataset.tab === 'plain' ? p.plain : (r.original || ''); sfx('tap'); }
    });
    dlg.querySelector('[data-sheet-close]').focus();
    return close;
  };
  return {
    html: page(bar(raceLabel(c), t('reveal.meta')), body),
    mount(el){
      const flips = [...el.querySelectorAll('.flip')];
      const timers = [];
      let closeSheet = null;
      const makeClickable = () => flips.forEach(f => {
        const { p, seat, issue } = items[+f.dataset.k];
        const v = c.st.ratings[p.id];
        f.setAttribute('role', 'button'); f.setAttribute('tabindex', '0');
        f.setAttribute('aria-label', t('rev.card', { issue: issueLabel(c, issue), seat, name: rv.get(p.id)?.candidate?.name ?? '?', score: v === undefined ? t('rev.skip') : sgn(v) }));
      });
      const onOpen = ev => {
        const f = ev.target.closest('.flip[role=button]'); if (!f) return;
        if (ev.type === 'keydown' && ev.key !== 'Enter' && ev.key !== ' ') return;
        ev.preventDefault();
        if (closeSheet) closeSheet();
        sfx('tap');
        closeSheet = openSheet(el, +f.dataset.k, f);
      };
      el.addEventListener('click', onOpen); el.addEventListener('keydown', onOpen);
      const cleanup = () => { timers.forEach(clearTimeout); if (closeSheet) closeSheet(); el.removeEventListener('click', onOpen); el.removeEventListener('keydown', onOpen); };
      if (!animate){ makeClickable(); return cleanup; }
      const gap = Math.min(120, Math.floor(1500 / Math.max(1, flips.length)));
      sfx('shuffle');
      flips.forEach((f, i) => timers.push(setTimeout(() => { f.classList.add('open'); if (i % 3 === 0) sfx('card_flip'); }, 500 + i * gap)));
      timers.push(setTimeout(() => {
        sfx('reveal');
        const b = el.querySelector('#flipbtn'); if (b){ b.textContent = t('reveal.see'); b.className = 'btn'; }
        const h = el.querySelector('#revhint'); if (h) h.remove();
        makeClickable();
      }, 500 + flips.length * gap + 400));
      return cleanup;
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
      box: `<div class="verdict"><div class="eyebrow">${esc(title)}</div><div class="stack center" style="align-items:center;gap:6px;padding:10px 0"><img class="illo" src="assets/empty_state.webp" alt="" width="768" height="768" style="width:120px"><span class="muted">${esc(reopen)}</span></div></div><p class="muted">${esc(t('blackout.health'))} <a href="#/${esc(c.key)}/health">${esc(t('foot.health'))}</a></p>`,
    };
  }
  const v = st.verdicts;
  if (!v) return { banner: '', box: `<div class="verdict"><div class="eyebrow">${esc(title)}</div><p class="muted">${esc(t('natl.few', { n: st.plays }))}</p></div>` };
  const tie = v.tie || 0;
  const n = v.same + v.different + tie;   // 平手自成一列、算進分母（#35）
  const body = n > 0
    ? `<div class="guessbox" style="border:0;padding:0"><div class="n">${Math.round(v.same / n * 100)}<small>%</small></div><div><b>${esc(t('natl.line', { race: name, p: Math.round(v.same / n * 100) }))}</b>${tie ? `<p class="muted">${esc(t('natl.tie', { p: Math.round(tie / n * 100) }))}</p>` : ''}<p class="muted">${esc(t('natl.basis', { n }))}</p></div></div>`
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
    c.st.sent.play = true; save(c);   // 先記下再送：逾時也算送過，不重送（#31）
    try { await postPlay(c.data.raceId, comp.verdict); } catch {}
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
  // 所有候選人都是負分：不說「最契合」，說「相對最接近」（#35）
  const allNeg = topNames.length > 0 && byName.get(topNames[0]).score < 0;
  const topLabel = t(allNeg ? 'res.topNeg' : 'res.top');
  let vsHtml, msg;
  if (verdict === 'none' && !topNames.length){
    vsHtml = `<div class="vs solo"><div class="who"><b>${esc(t('res.tooFew'))}</b></div></div>`;
    msg = t('res.tooFewSub');
  } else if (verdict === 'same' || verdict === 'different' || verdict === 'tie'){
    const scoreOf = n => { const x = byName.get(n); return x && x.score !== null ? x.score : null; };
    const others = topNames.filter(n => n !== st.lean).slice(0, 3);
    const cards = verdict === 'same' ? [faceHtml(c, st.lean, t('res.lean'), scoreOf(st.lean))] : [faceHtml(c, st.lean, t('res.lean'), scoreOf(st.lean), verdict === 'different'), ...others.map(n => faceHtml(c, n, topLabel + (verdict === 'tie' ? '（' + t('res.tie') + '）' : ''), scoreOf(n)))];
    vsHtml = `<div class="pair n${cards.length}" aria-label="${esc(t(verdict === 'same' ? 'res.eq' : verdict === 'tie' ? 'res.tie' : 'res.neq'))}">${cards.join('')}</div>`;
    msg = t(verdict === 'same' ? 'res.sameMsg' : verdict === 'tie' ? 'res.tieMsg' : 'res.diffMsg');
  } else {
    vsHtml = `<div class="pair n${Math.min(3, topNames.length)}">${topNames.slice(0, 3).map(n => faceHtml(c, n, topLabel, byName.get(n)?.score ?? null)).join('')}</div>`;
    msg = t('res.noneMsg');
  }
  // 結果頁已經開票，名字本來就在畫面上；唸的是「傾向 vs 契合」那一句。
  const sayRes = verdict === 'none' && !topNames.length ? t('speak.resNone', { msg: t('res.tooFew') + t('res.tooFewSub') })
    : verdict === 'same' || verdict === 'different' || verdict === 'tie' ? t('speak.resSame', { lean: st.lean, label: topLabel, top: topText, msg: msg + (allNeg ? t('res.negNote') : '') })
    : t('speak.resTop', { label: topLabel, top: topText, msg: msg + (allNeg ? t('res.negNote') : '') });
  // 完全沒有段落的候選人（cands/ inPlay === false）不列進分數列表（#36；owner #43：結果頁也不再加說明行，資料來源頁照舊列出）。
  // 有段落但這局全跳過的人仍列出（那是玩家的選擇）。傾向與最契合的人放大、排前面。
  const focus = new Set([...topNames, ...(typeof st.lean === 'string' ? [st.lean] : [])]);
  const rows = c.data.candidates.filter(cd => cd.inPlay !== false).map(cd => ({ name: cd.name, r: byName.get(cd.name) }))
    .sort((a, b) => (focus.has(b.name) - focus.has(a.name)) || (b.r?.score ?? -1e9) - (a.r?.score ?? -1e9) || c.order.indexOf(a.name) - c.order.indexOf(b.name));
  const scoreRows = rows.map(({ name, r }) => {
    const fc = focus.has(name) ? ' focus' : '';
    if (!r || r.score === null){
      return `<div class="score${fc} ${grpOf(c, name)}"><span class="nm">${esc(name)}<br><span class="conf">${esc(t('res.noKey'))}</span></span><div class="axis"></div><span class="num">—</span></div>`;
    }
    const s = r.score;
    const bar = s >= 0 ? `left:50%;width:${s / 2}%` : `left:${50 + s / 2}%;width:${-s / 2}%`;
    return `<div class="score${fc} ${grpOf(c, name)}"><span class="nm">${esc(name)}${r.lowConfidence ? `<br><span class="conf">${esc(t('res.low', { n: r.n }))}</span>` : ''}</span><div class="axis"><i class="b${s < 0 ? ' neg' : ''}" style="${bar}"></i></div><span class="num">${sgn(s)}</span></div>`;
  }).join('');
  const gs = guessStats(c, rv);
  const guessHtml = gs.guessed
    ? `<div class="guessbox"><div class="n">${gs.correct}<small>/${gs.guessed}</small></div><div><b>${esc(t('res.guessTitle', { c: gs.correct }))}</b><p class="muted">${esc(t('res.guessBody', { n: gs.guessed, r: (gs.guessed / guessNames(c).length).toFixed(1) }))}</p></div></div>`
    : `<p class="muted">${esc(t('res.guessNone'))}</p>`;
  return `
    <div id="natl-banner" style="display:contents"></div>
    <div class="resfaces"><div class="eyebrow">${esc(t('res.eyebrow'))}</div>${vsHtml}<p class="muted" style="text-align:center">${esc(msg)}</p>${allNeg ? `<p class="muted" style="text-align:center">${esc(t('res.negNote'))}</p>` : ''}<div class="speakrow" style="text-align:center">${speakBtn(t('speak.result'), `data-text="${esc(sayRes)}"`)}</div></div>
    <div class="felt"><div class="eyebrow" style="margin-bottom:6px">${esc(t('res.scoreTitle'))}</div>
      <div class="stack" style="gap:8px">${scoreRows}<div class="scale-lbl"><span></span><span><span>−100</span><span>0</span><span>+100</span></span><span></span></div></div>
      </div>
    ${guessHtml}
    <div id="natl-box" style="display:contents"></div>
    <details><summary class="muted">${esc(t('res.adjust'))}</summary><div id="imps" style="margin-top:6px">${impRows(c) || `<p class="muted">${esc(t('imp.none'))}</p>`}</div></details>
    <div class="btns">${EMBED ? `<a class="btn" href="${esc(gameUrl(c))}" target="_blank" rel="noopener">${esc(t('embed.openResult'))}</a>` : `<a class="btn" href="#/${esc(c.key)}/share">${esc(t('res.share'))}</a>`}<button class="btn ghost" data-act="again">${esc(t('res.again'))}</button></div>
    <a class="btn line" href="#/${esc(c.key)}/reveal">${esc(t('res.detail'))}</a>
    <p class="muted">${esc(t('res.disclaimer'))}</p>`;
}

async function viewResult(c){
  let rv, comp;
  try { rv = await fetchReveal(c.data.raceId); } catch { return { html: page(bar(raceLabel(c), t('res.meta')), errorBox(t('imp.err'))) }; }
  try { comp = await compute(c, rv); } catch (e) { console.error(e); return { html: page(bar(raceLabel(c), t('res.meta')), errorBox(t('err.engine'))) }; }
  c.lastComp = { rv, comp };
  c.stats = null;   // 不拿舊的匯總先畫（可能已跨過 11/18）；mount 後重抓
  return { html: page(bar(raceLabel(c), t('res.meta')), `<div id="resbody" style="display:contents">${resultBody(c, rv, comp)}</div>`), mount: () => { fillNatl(c); afterResult(c, comp); } };
}
async function refreshResult(c){
  const rv = await fetchReveal(c.data.raceId);
  const comp = await compute(c, rv);
  const el = document.getElementById('resbody'); if (!el) return;
  const open = el.querySelector('details')?.open;
  el.innerHTML = resultBody(c, rv, comp);
  if (open) el.querySelector('details').open = true;
  try { c.stats = await getStats(c.data.raceId); } catch { c.stats = null; }   // 每次重畫都以最新的匯總為準（#31）
  fillNatl(c);
}

function safeUrl(u){ try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } }
function hostOf(u){ try { return new URL(u).hostname; } catch { return u; } }

// ---------------- D1 遮蔽健康度 ----------------
const HEALTH_MIN = 30;   // 少於這麼多人作答：寫「樣本還不夠」，不畫條
async function viewHealth(c){
  const barHtml = bar(raceLabel(c), t('health.meta'));
  const back = `<a class="btn ghost" href="#/${esc(c.key)}">${esc(t('common.back'))}</a>`;
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

// ---------------- 課堂版（#11）：老師頁 #/class、#/class/<code>、儀表板 #/class/<code>/<city> ----------------
// 沒有帳號：代碼在老師的瀏覽器產生、存在老師的 localStorage。儀表板只讀後端匯總（class/<code>/<race>），
// 不自己算門檻、不自己算禁止期（只認回應裡有沒有 verdicts／blackout）。
const classUrl = code => location.origin + location.pathname + '?class=' + code;
const CLASS_POLL_MS = 20000;
async function viewClass(code, city){
  const barHtml = bar(t('brand'), t('class.meta'));
  const home = `<a class="btn ghost" href="#/">${esc(t('common.home'))}</a>`;
  if (!code){
    const list = loadClasses();
    const rows = list.map(x => `<div class="clsrow"><a class="clscode num" href="#/class/${esc(x.code)}">${esc(x.code)}</a><span class="muted">${esc(t('class.made', { d: new Date(x.at || Date.now()).toLocaleDateString(lang() === 'en' ? 'en-US' : 'zh-TW') }))}</span><button class="linkbtn" data-act="class-del" data-code="${x.code}">${esc(t('class.remove'))}</button></div>`).join('');
    const body = `
      <h1 class="mid">${esc(t('class.title'))}</h1>
      <p>${esc(t('class.lead'))}</p>
      <p class="muted">${esc(t('class.promise'))}</p>
      <button class="btn" data-act="class-new">${esc(t('class.new'))}</button>
      ${list.length ? `<div class="eyebrow">${esc(t('class.yours'))}</div><div class="stack">${rows}</div><p class="muted">${esc(t('class.yoursNote'))}</p>` : ''}
      ${home}`;
    return { html: page(barHtml, body, footer()) };
  }
  if (!CLASS_RE.test(code)){
    return { html: page(barHtml, `<h1 class="mid">${esc(t('class.title'))}</h1><p class="muted">${esc(t('class.bad'))}</p><a class="btn ghost" href="#/class">${esc(t('common.back'))}</a>`, footer()) };
  }
  if (!city){
    const ready = await readyMetros();
    const chips = [...ready.keys()].map(k => `<a class="chip" href="#/class/${esc(code)}/${esc(k)}">${esc(t('city.' + k))}</a>`).join('');
    const body = `
      <div class="eyebrow">${esc(t('class.codeLabel'))}</div>
      <div class="clsbig num" id="clscode" aria-label="${esc(code.split('').join(' '))}">${code}</div>
      <div class="eyebrow">${esc(t('class.linkLabel'))}</div>
      <pre class="code" tabindex="0"><code>${esc(classUrl(code))}</code></pre>
      <div class="btns"><button class="btn ghost" data-act="class-copy" data-v="${esc(classUrl(code))}">${esc(t('class.copyLink'))}</button><button class="btn ghost" data-act="class-copy" data-v="${code}">${esc(t('class.copyCode'))}</button></div>
      <p class="muted">${esc(t('class.linkNote'))}</p>
      <div class="eyebrow">${esc(t('class.pickRace'))}</div>
      <div class="row">${chips || `<span class="muted">${esc(t('class.noRace'))}</span>`}</div>
      <a class="btn ghost" href="#/class">${esc(t('common.back'))}</a>`;
    return { html: page(barHtml, body, footer()) };
  }
  // 儀表板
  let rd = null;
  try { rd = await loadRace(city); } catch {}
  const raceId = raceIdOf(city);
  const nIn = rd ? rd.candidates.filter(x => x.inPlay === true).length : 0;   // 猜作者選單的人數（同 /api/health 的 random）；沒有 inPlay 才退回名單
  const nCand = nIn >= 2 ? nIn : rd ? rd.candidates.length : 0;
  const random = nCand >= 2 ? 1 / nCand : null;
  const body = `
    <div class="row between" style="align-items:baseline"><span class="eyebrow">${esc(t('class.boardEyebrow', { city: t('city.' + city) }))}</span><span class="num clscode-s">${code}</span></div>
    <div id="clsboard" aria-live="polite">${spinner()}</div>
    <div class="eyebrow">${esc(t('class.discuss'))}</div>
    <ol class="qs"><li>${esc(t('class.q1'))}</li><li>${esc(t('class.q2'))}</li><li>${esc(t('class.q3'))}</li></ol>
    <p class="muted" id="clsupd"></p>
    <a class="btn ghost" href="#/class/${esc(code)}">${esc(t('common.back'))}</a>`;
  return {
    html: page(barHtml, body, footer()),
    mount(){
      let dead = false, timer = 0, shown = false;
      const pct = v => Math.round(v * 100);
      const paint = j => {
        const box = document.getElementById('clsboard'); if (!box || dead) return;
        const g = j.guesses || { answers: 0, correct: 0 };
        const plays = Number.isFinite(j.plays) ? j.plays : 0;
        const guessHtml = g.answers > 0
          ? `<div class="guessbox" style="border:0;padding:0"><div class="n num">${pct(g.correct / g.answers)}<small>%</small></div><div><b>${esc(t('class.guessLine', { x: pct(g.correct / g.answers), c: g.correct, a: g.answers }))}</b>${random !== null ? `<p class="muted">${esc(t('class.guessRandom', { y: pct(random) }))}</p>` : ''}</div></div>`
            + `<div class="htrack" role="img" aria-label="${esc(t('health.rowAlt', { x: pct(g.correct / g.answers), y: random !== null ? pct(random) : 0 }))}"><i style="width:${Math.min(100, g.correct / g.answers * 100)}%"></i>${random !== null ? `<u style="left:${random * 100}%"></u>` : ''}</div><p class="muted">${esc(t('class.guessNote'))}</p>`
          : `<p class="muted">${esc(t('class.guessNone'))}</p>`;
        let vHtml;
        const v = j.verdicts;
        if (v){
          const tot = (v.same || 0) + (v.different || 0) + (v.tie || 0) + (v.none || 0);
          const row = (k, n) => `<div class="hbar"><span>${esc(t('class.v.' + k))}</span><div class="htrack"><i style="width:${tot ? n / tot * 100 : 0}%"></i></div><span class="num">${tot ? pct(n / tot) : 0}%</span></div>`;
          vHtml = `<div class="stack" style="gap:10px">${row('same', v.same || 0)}${row('different', v.different || 0)}${row('tie', v.tie || 0)}${row('none', v.none || 0)}</div><p class="muted">${esc(t('class.vNote', { n: tot }))}</p>`;
        } else if (j.blackout === true || (j.blackout === undefined && plays >= MIN_CLASS)){
          // 有 ≥ 5 局卻沒有 verdicts = 靜默期（選罷法第 53 條）；日期由後端決定，這裡不算
          vHtml = `<div class="banner"><b>${esc(t('blackout.title'))}</b><span>${esc(t('class.blackoutBody'))}</span></div>`;
        } else {
          vHtml = `<p class="muted">${esc(t('class.few', { n: plays, min: MIN_CLASS }))}</p>`;
        }
        box.innerHTML = `
          <div class="verdict"><div class="eyebrow">${esc(t('class.playsLabel'))}</div><div class="clsbig num" style="letter-spacing:0">${plays}<small> ${esc(t('class.playsUnit', { n: plays }))}</small></div></div>
          <div class="verdict"><div class="eyebrow">${esc(t('class.guessTitle'))}</div>${guessHtml}</div>
          <div class="verdict"><div class="eyebrow">${esc(t('class.vTitle'))}</div>${vHtml}</div>`;
        shown = true;
        const u = document.getElementById('clsupd'); if (u) u.textContent = t('class.updated', { s: CLASS_POLL_MS / 1000, time: new Date().toLocaleTimeString(lang() === 'en' ? 'en-US' : 'zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) });
      };
      const tick = async () => {
        let j = null;
        try { j = await getClass(code, raceId); } catch {}
        if (dead) return;
        if (j) paint(j);
        else if (!shown){ const box = document.getElementById('clsboard'); if (box) box.innerHTML = errorBox(t('class.err')); }
        else { const u = document.getElementById('clsupd'); if (u) u.textContent = t('class.updFail'); }
        timer = setTimeout(tick, CLASS_POLL_MS);
      };
      tick();
      return () => { dead = true; clearTimeout(timer); };
    },
  };
}

// ---------------- C4 分享 ----------------
// 圖卡在瀏覽器用 canvas 畫成 1200×630 PNG：預覽就是會下載的那張。預設不放姓名（owner 裁決 2026-10-21），勾選才放。
let shareNames = true;   // 預設放出姓名（owner 2026-10-21）；取消時牌背、不露名
const OG_W = 1200, OG_H = 630;
const gameUrl = c => location.origin + location.pathname + '#/' + c.key;
const shareUrl = gameUrl;
const siteLabel = () => location.host + location.pathname.replace(/index\.html$/, '').replace(/\/$/, '');
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

const GRP_COLOR = { kmt: '#2D5DB0', dpp: '#1F9149', oth: '#8C857B' };
// 分享卡（#42）：左邊「名字蓋起來，／我契合的是／○○○（放大）」，右邊只有一張牌＝最契合的那張。
// 沒勾姓名：第三行是一條遮住的色塊、右邊是牌背，沒有任何姓名或政黨色。勾了：第三行放姓名、右邊是翻開的牌（姓氏圈＋政黨色條）。
// 並列（≥ 2 人）：第三行放所有姓名（可換行）、牌上列出姓名、色條中性灰。沒有任何計分（info.fit 為 false）：沿用 a／em／b 三行字、右邊牌背。傾向不上圖卡。
async function drawCard(canvas, c, info){
  const ctx = canvas.getContext('2d');
  const fam = '"Noto Serif TC","Songti TC","STSong","Source Han Serif TC",serif', sans = '"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif', mono = '"IBM Plex Mono",ui-monospace,Consolas,monospace';
  try { await Promise.race([Promise.all([document.fonts.load(`900 60px ${fam}`, info.sample), document.fonts.load(`400 28px ${sans}`, info.sample), document.fonts.load(`500 28px ${mono}`)]), new Promise(r => setTimeout(r, 2500))]); } catch {}
  ctx.clearRect(0, 0, OG_W, OG_H);
  ctx.fillStyle = '#2B241E'; ctx.fillRect(0, 0, OG_W, OG_H);
  try { const wood = await loadImg('assets/table_wood.webp'); ctx.fillStyle = ctx.createPattern(wood, 'repeat'); ctx.fillRect(0, 0, OG_W, OG_H); } catch {}
  const grad = ctx.createRadialGradient(OG_W / 2, 0, 40, OG_W / 2, 0, OG_W * 0.8); grad.addColorStop(0, 'rgba(70,56,44,.55)'); grad.addColorStop(1, 'rgba(43,36,30,0)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, OG_W, OG_H);
  const X = 72, MAXW = 640, sp = lang() === 'en' ? ' ' : '';
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.fillStyle = '#C9BBA6'; ctx.font = `400 28px ${sans}`;
  ctx.fillText(info.eyebrow, X, 90);
  if (info.fit){
    // 兩行標題 + 放大的姓名
    const heads = [info.l1, info.l2];
    let hs = 64; const hw = () => Math.max(...heads.map(h => ctx.measureText(h).width));
    ctx.font = `900 ${hs}px ${fam}`; while (hw() > MAXW && hs > 36){ hs -= 2; ctx.font = `900 ${hs}px ${fam}`; }
    ctx.fillStyle = '#F4EFE4';
    let y = 90 + hs * 1.35;
    for (const h of heads){ ctx.fillText(h, X, y); y += hs * 1.2; }
    if (info.names){
      // 姓名：單人一行、盡量大；並列時以頓號串起來，超過寬度就換行（不截字）
      const list = info.names;
      let size = list.length > 1 ? 84 : 140;
      let lines;
      for (;;){
        ctx.font = `900 ${size}px ${fam}`;
        lines = []; let cur = '';
        for (const nm of list){
          const t2 = cur ? cur + '、' + nm : nm;
          if (cur && ctx.measureText(t2).width > MAXW){ lines.push(cur + '、'); cur = nm; } else cur = t2;
        }
        lines.push(cur);
        const room = OG_H - 150 - y;
        if ((Math.max(...lines.map(l => ctx.measureText(l).width)) <= MAXW && lines.length * size * 1.15 <= room) || size <= 36) break;
        size -= 4;
      }
      ctx.fillStyle = '#F08A6E';
      y += size * 0.95;
      for (const l of lines){ ctx.fillText(l, X, y); y += size * 1.15; }
    } else {
      // 沒勾姓名：一條遮住名字的色塊
      ctx.fillStyle = '#F4EFE4'; ctx.beginPath(); ctx.roundRect(X, y + 10, 360, 96, 14); ctx.fill();
      ctx.fillStyle = '#2B241E'; ctx.font = `900 64px ${fam}`; ctx.textAlign = 'center'; ctx.fillText('？？？', X + 180, y + 82); ctx.textAlign = 'left';
    }
  } else {
    const [a0, a1 = ''] = info.a.split('\n');
    const lns = [[[a0, 0]], [[a1 ? a1 + sp : '', 0], [info.em + sp, 1]], [[info.b, 0]]];
    const fit = size => { ctx.font = `900 ${size}px ${fam}`; return Math.max(...lns.map(l => l.reduce((w, [tx]) => w + ctx.measureText(tx).width, 0))); };
    let size = 80; const w1 = fit(100); size = Math.min(80, Math.floor(100 * 520 / w1));
    ctx.font = `900 ${size}px ${fam}`;
    let y = 90 + size * 1.55;
    for (const l of lns){
      let x = X;
      for (const [tx, hot] of l){ ctx.fillStyle = hot ? '#F08A6E' : '#F4EFE4'; ctx.fillText(tx, x, y); x += ctx.measureText(tx).width; }
      y += size * 1.3;
    }
  }
  ctx.fillStyle = '#C9BBA6'; ctx.font = `500 28px ${mono}`;
  ctx.fillText(info.url, X, OG_H - 48);
  if (info.foot){ ctx.fillStyle = '#F4EFE4'; ctx.font = `500 30px ${mono}`; ctx.fillText(info.foot, X, OG_H - 92); }
  // 右邊只有一張牌
  let face = null, back = null;
  try { face = await loadImg('assets/card_face.webp'); } catch {}
  try { back = await loadImg('assets/card_back.webp'); } catch {}
  const CW = 300, CH = Math.round(CW * 850 / 600), cx = 960, cy = 315;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(0.035);
  ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
  const showFace = info.fit && info.names && info.card;
  if (showFace){
    if (face) ctx.drawImage(face, -CW / 2, -CH / 2, CW, CH); else { ctx.fillStyle = '#F4EFE4'; ctx.fillRect(-CW / 2, -CH / 2, CW, CH); }
    ctx.shadowColor = 'transparent';
    const col = info.card.grp ? GRP_COLOR[info.card.grp] : '#8C857B';
    ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(-CW * 0.4, CH * 0.36, CW * 0.8, 12, 6); ctx.fill();
    ctx.textAlign = 'center';
    if (info.card.ring){
      ctx.strokeStyle = col; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(0, -30, 56, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = col; ctx.font = `900 62px ${fam}`; ctx.fillText(info.card.ring, 0, -9);
      ctx.fillStyle = '#1E1C1A'; ctx.font = `900 38px ${fam}`; ctx.fillText(info.card.names[0], 0, 82);
    } else {
      ctx.fillStyle = '#1E1C1A'; ctx.font = `900 38px ${fam}`;
      const n = info.card.names.length, step = 50, y0 = -((n - 1) * step) / 2 + 12;
      info.card.names.slice(0, 5).forEach((nm, i) => ctx.fillText(nm, 0, y0 + i * step));
    }
    ctx.textAlign = 'left';
  } else if (back){
    ctx.beginPath(); ctx.roundRect(-CW / 2, -CH / 2, CW, CH, 14); ctx.save(); ctx.clip(); ctx.drawImage(back, -CW / 2, -CH / 2, CW, CH); ctx.restore();
  }
  ctx.restore();
}

async function viewShare(c){
  let rv, comp;
  try { rv = await fetchReveal(c.data.raceId); comp = await compute(c, rv); } catch { return { html: page(bar(raceLabel(c), t('share.meta')), errorBox(t('err.engine'))) }; }
  const gs = guessStats(c, rv);
  const topArr = comp.res.top.filter(n => comp.res.candidates.find(x => x.candidateId === n)?.score !== null);
  const shareNeg = topArr.length > 0 && comp.res.candidates.find(x => x.candidateId === topArr[0]).score < 0;
  const fitMode = topArr.length > 0;
  const kind = 'none';   // 沒有任何計分的段落時，沿用舊的三行字（share.none.*）
  const body = `
    <h1 class="mid">${esc(t('share.title'))}</h1>
    <canvas id="ogcanvas" class="ogcanvas" width="${OG_W}" height="${OG_H}" role="img" aria-label="${esc(t('share.cardAlt'))}"></canvas>
    <label class="opt" style="cursor:pointer"><input type="checkbox" id="showNames" ${shareNames ? 'checked' : ''}> <span>${esc(t('share.names'))}<small>${esc(t('share.namesSub'))}</small></span></label>
    <a class="btn" data-act="download" id="dlbtn" download="covervote.png" href="#/${esc(c.key)}/share" aria-disabled="true">${esc(t('share.download'))}</a>
    <div class="btns"><a class="btn ghost" data-act="line" id="linebtn" href="#/${esc(c.key)}/share" target="_blank" rel="noopener noreferrer">${esc(t('share.line'))}</a><button class="btn ghost" data-act="copy">${esc(t('share.copy'))}</button></div>
    <a class="btn line" href="#/${esc(c.key)}/result">${esc(t('det.back'))}</a>`;
  return {
    html: page(bar(raceLabel(c), t('share.meta')), body),
    mount(el){
      const cv = el.querySelector('#ogcanvas'), dl = el.querySelector('#dlbtn');
      el.querySelector('#linebtn').href = 'https://social-plugins.line.me/lineit/share?url=' + encodeURIComponent(gameUrl(c));
      let blobUrl = '', gen = 0, alive = true;
      const redraw = async () => {
        const my = ++gen;
        const tieNow = topArr.length > 1;
        const info = { eyebrow: t('share.eyebrow', { race: raceLabel(c) }), fit: fitMode,
          l1: t('share.fit.a'), l2: t(shareNeg ? 'share.fitNeg.b' : 'share.fit.b'),
          a: t(`share.${kind}.a`), em: t(`share.${kind}.em`), b: t(`share.${kind}.b`),
          names: shareNames && fitMode ? topArr : null,
          card: shareNames && fitMode ? { names: topArr, ring: tieNow ? '' : [...topArr[0]][0], grp: tieNow ? null : grpOf(c, topArr[0]) } : null,
          foot: gs.guessed ? t('share.foot', { c: gs.correct, n: gs.guessed }) : '', url: siteLabel() };
        info.sample = info.eyebrow + info.l1 + info.l2 + info.a + info.em + info.b + (info.names || []).join('') + '？' + info.foot + info.url;
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
// 每都的收錄狀況：只講「有沒有收進來」，不講出處種類、不放出處網址（開票前不露；owner 2026-10-21 設計決定 #2）。
async function coverageHtml(){
  const rs = await Promise.allSettled(METRO_KEYS.map(k => loadRace(k)));
  const h2 = 'class="mid" style="font-size:calc(17px*var(--fs))"';
  const sec = METRO_KEYS.map((k, i) => {
    const cands = rs[i].status === 'fulfilled' ? rs[i].value.candidates : [];
    const body = !cands.some(x => x.inPlay === true)
      ? `<p class="muted">${esc(t('cov.prep'))}</p>`
      : `<table>${cands.map(x => `<tr><td style="white-space:nowrap;vertical-align:top"><i class="pdot ${grpCls(x.group)}"></i> ${esc(x.name)}</td><td>${x.inPlay === true ? esc(t('cov.in')) : `<span class="muted">${esc(t('cov.out'))}</span>`}</td></tr>`).join('')}</table>`;
    return `<section id="cov-${k}" class="stack" style="gap:6px"><h2 ${h2}>${esc(t('city.' + k))}</h2>${body}</section>`;
  }).join('');
  return `<h2 ${h2}>${esc(t('cov.why'))}</h2><ul class="stack" style="padding-left:18px;margin:0;font-size:14px;gap:6px">${[1, 2, 3].map(i => `<li>${esc(t('cov.why' + i))}</li>`).join('')}</ul><div class="eyebrow">${esc(t('cov.title'))}</div>${sec}`;
}

async function viewInfo(tab, focus){
  const tabs = ['method', 'sources', 'privacy', 'about'];
  if (!tabs.includes(tab)) tab = 'method';
  const chips = tabs.map(k => `<a class="chip${k === tab ? ' on' : ''}" href="#/info/${k}" aria-current="${k === tab}">${esc(t('info.tab.' + k))}</a>`).join('');
  let content = '';
  if (tab === 'method') content = `<h1 class="mid">${esc(t('info.method.title'))}</h1><ol class="stack" style="padding-left:18px;margin:0;font-size:14px;gap:6px">${[1, 2, 3, 4, 5].map(i => `<li>${esc(t('info.method.' + i))}</li>`).join('')}</ol>`;
  if (tab === 'sources') content = `<h1 class="mid">${esc(t('info.sources.title'))}</h1><p style="font-size:14px">${esc(t('cov.list'))}</p><p style="font-size:14px">${esc(t('info.sources.body'))}</p>` + await coverageHtml();
  if (tab === 'about') content = `<h1 class="mid">${esc(t('info.about.title'))}</h1><p style="font-size:14px">${esc(t('info.about.body'))}</p>`;
  if (tab === 'privacy') content = `<h1 class="mid">${esc(t('info.privacy.title'))}</h1><table><tr><th>${esc(t('info.privacy.th1'))}</th><th>${esc(t('info.privacy.th2'))}</th></tr>`
    + [1, 2, 3, 4].map(i => `<tr><td>${esc(t('info.privacy.r' + i + 'a'))}</td><td>${esc(t('info.privacy.r' + i + 'b'))}</td></tr>`).join('')
    + `</table><p class="muted">${esc(t('info.privacy.fonts'))}</p><p class="muted">${esc(t('info.privacy.note'))}</p>`
    + `<button type="button" class="btn ghost" data-act="optout" aria-pressed="${isOptedOut()}">${esc(t('info.privacy.optout'))}</button><p class="muted" role="status" id="optoutmsg">${isOptedOut() ? esc(t('info.privacy.optoutOn')) : ''}</p>`;
  return { html: page(bar(t('brand'), has('info.meta.' + tab) ? t('info.meta.' + tab) : t('info.meta')), `<div class="row">${chips}</div>${content}<a class="btn ghost" href="#/">${esc(t('common.home'))}</a>`, footer()),
    mount: () => { if (tab === 'sources' && focus){ const el = document.getElementById('cov-' + focus); if (el) el.scrollIntoView(); } } };
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
  const src = location.pathname + '?embed=1&internal=1#/' + key;   // 預覽 iframe 不計入統計
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
    <p>${esc(t('media.contactBody'))}<span class="num">${esc(t('media.contactMail'))}</span></p>`;
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
function curCtx(){ const k = cityKey(parse()[0]); return k ? ctxs.get(k) : null; }
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
    case 'fontsize': { setFontSize(FS_SIZES[(FS_SIZES.indexOf(fontSize()) + 1) % FS_SIZES.length]); sfx('tap'); render(); break; }
    case 'speak': {
      const txt = el.dataset.text !== undefined ? el.dataset.text
        : (c && c.data.passages.find(x => x.id === el.dataset.pid)?.plain) || '';
      if (txt) toggleSpeak(el, txt.replace(/▇+/g, '，'));
      break;
    }
    case 'pick': {
      homePick = el.dataset.key; sfx('tap'); track('select_city', homePick);
      setPressed([...root.querySelectorAll('.tile.live')], b => b.dataset.key === homePick);
      const sb = document.getElementById('startbtn'); sb.textContent = startLabel(); sb.removeAttribute('aria-disabled'); sb.href = '#/' + homePick;
      showPlays();
      const hl = document.getElementById('healthlink'); if (hl){ hl.href = `#/${homePick}/health`; hl.hidden = false; }
      const mh = document.getElementById('menuhealth'); if (mh) mh.href = `#/${homePick}/health`;
      break;
    }
    case 'start': if (!homePick) e.preventDefault(); break;
    case 'class-new': {
      const list = loadClasses();
      let code; do { code = newClassCode(); } while (list.some(x => x.code === code));
      list.unshift({ code, at: Date.now() }); saveClasses(list); sfx('stamp'); go(`#/class/${code}`); break;
    }
    case 'class-del': {
      if (!confirm(t('class.removeAsk', { code: el.dataset.code }))) break;
      saveClasses(loadClasses().filter(x => x.code !== el.dataset.code)); render(); break;
    }
    case 'class-copy': {
      const v = el.dataset.v;
      try { await navigator.clipboard.writeText(v); toast(t('media.copied')); }
      catch {
        try { const ta = document.createElement('textarea'); ta.value = v; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); toast(t(ok ? 'media.copied' : 'media.copyFail')); }
        catch { toast(t('media.copyFail')); }
      }
      break;
    }
    case 'mask': toast(t('play.maskInfo', { n: el.dataset.n })); break;
    case 'reload': e.preventDefault(); render(); break;
    case 'restart': if (c){ const keep = c.st.menuOrder, seen = c.st.seen; Object.assign(c.st, freshState()); c.st.menuOrder = keep; c.st.seen = seen; save(c); rebuild(c); go(`#/${c.key}/lean`); } break;
    case 'lean': {
      if (!c) break;
      const v = el.dataset.v; c.st.lean = c.st.lean === v ? null : v; save(c); sfx('tap');
      setPressed([...root.querySelectorAll('[data-act=lean]')], b => b.dataset.v === c.st.lean);
      break;
    }
    case 'more': {
      root.querySelectorAll('[data-more]').forEach(n => n.hidden = false); el.hidden = true; break;
    }
    case 'lean-next': sfx('shuffle'); if (c) track('game_start', c.key); break;
    case 'download': if (c && el.getAttribute('aria-disabled') !== 'true') track('share', c.key); break;
    case 'line': if (c) track('share', c.key); break;
    case 'optout': { const off = !isOptedOut(); setOptOut(off); sfx('tap'); render(); break; }
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
      if (!c || c.st.done) break;   // 開票後鎖住（#31）
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
      go(nextHash(c, n)); break;   // 只往下走：已打的分不清（#35 M2）；沒打分的段落本來就不計
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
      const hn = document.getElementById('handnote'); if (hn) hn.textContent = handNote(c);
      if (c.st.done && document.getElementById('resbody')) refreshResult(c);
      break;
    }
    case 'reveal': if (c) await revealNow(c, document.getElementById('revealbtn')); break;
    case 'again': {
      if (!c) break;
      const keep = c.st.menuOrder, lean = c.st.lean, seen = c.st.seen;
      const s = freshState(); Object.assign(c.st, s); c.st.menuOrder = keep; c.st.lean = lean; c.st.seen = seen;
      save(c); rebuild(c); go(`#/${c.key}/lean`); break;
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
      track('share', c.key);
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
