// site/app.js — 單頁 app：hash 路由與畫面（設計稿 A1–C4、D4）。FE 所有。
//
// 約束（issue #3）：
//  - 開票前不 fetch reveal/（只在 revealNow() 裡，由「開票」按鈕觸發）；DOM 與 localStorage 都沒有作者。
//  - 傾向、分數、猜作者只存本機（store.js）。不載入任何分析或錄製腳本。
//  - 分數一律呼叫 engine/score.mjs，FE 不自己算。候選人的鍵是姓名。
import { t, initLang, lang, has } from './i18n.js';
import { TILES, METRO_KEYS, METRO_ETA, CEC_URL } from './config.js';
import { initInternal, loadState, saveState, freshState, hasProgress } from './store.js';
import { initSound, isSoundOn, setSound, sfx } from './sound.js';
import { loadRace, loadIssues, fetchReveal, buildPlan, menuOrder, mulberry32, NotFound } from './data.js';

initInternal();
initLang();
initSound();

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
  const on = isSoundOn();
  return `<header class="bar"><a class="brand" href="#/"><i></i>${esc(left)}</a><span class="bar-r">${meta ? `<span class="meta num" id="barmeta">${esc(meta)}</span>` : '<span class="meta num" id="barmeta"></span>'}`
    + `<button class="snd" data-act="sound" aria-pressed="${on}" aria-label="${esc(t(on ? 'sound.on' : 'sound.off'))}" title="${esc(t(on ? 'sound.on' : 'sound.off'))}">${on ? ICON_ON : ICON_OFF}</button></span></header>`;
}
const footer = () => `<footer class="foot"><a href="#/info/method">${esc(t('foot.method'))}</a><a href="#/info/sources">${esc(t('foot.sources'))}</a><a href="#/info/privacy">${esc(t('foot.privacy'))}</a><a href="#/info/about">${esc(t('foot.about'))}</a></footer>`;
const page = (barHtml, body, foot = '') => `${barHtml}<main id="main" tabindex="-1"><div class="pad">${body}</div>${foot}</main>`;
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
  const key = seg[0], sub = seg[1] || '';
  let c;
  try { c = await getCtx(key); }
  catch (e) {
    if (e instanceof NotFound) return viewMissing(key);
    return { html: page(bar(t('brand')), errorBox(t('err.load'))) };
  }
  switch (sub){
    case '': return viewEntry(c);
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
// 六都裡哪些「有資料」：由 race/<id>.json 與 cands/<id>.json 存不存在決定，不寫死。
async function readyMetros(){
  const rs = await Promise.allSettled(METRO_KEYS.map(k => loadRace(k)));
  const ready = new Map();
  rs.forEach((r, i) => { if (r.status === 'fulfilled') ready.set(METRO_KEYS[i], r.value); });
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
    <a class="btn" id="startbtn" href="${homePick ? '#/' + homePick : '#/'}" data-act="start" ${homePick ? '' : 'aria-disabled="true"'}>${esc(startLabel())}</a>
    <p class="muted">${esc(t('home.promise'))}</p>`;
  return { html: page(bar(t('brand'), ''), body, footer()), mount: () => { fillCountdown(ready); } };
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
    </table>
    ${prog && !c.st.done ? `<a class="btn" href="#/${c.key}/play" data-act="resume">${esc(t('entry.resume'))}</a><button class="btn ghost" data-act="restart">${esc(t('entry.restart'))}</button>`
      : c.st.done ? `<a class="btn" href="#/${c.key}/result">${esc(t('res.meta'))}</a><button class="btn ghost" data-act="restart">${esc(t('res.again'))}</button>`
      : `<a class="btn" href="#/${c.key}/lean">${esc(t('entry.start'))}</a>`}
    <details><summary class="muted">${esc(t('entry.how'))}</summary>
      <ol class="muted" style="padding-left:18px;margin:8px 0 0"><li>${esc(t('entry.how1'))}</li><li>${esc(t('entry.how2'))}</li><li>${esc(t('entry.how3'))}</li><li>${esc(t('entry.how4'))}</li></ol></details>`;
  return { html: page(bar(t('brand'), t('entry.change')), body, footer()) };
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
function guessBlock(c, p){
  const g = c.st.guesses[p.id];
  const chips = c.order.map(n => `<button type="button" class="chip${g === n ? ' on' : ''}" aria-pressed="${g === n}" data-act="guess" data-pid="${esc(p.id)}" data-v="${esc(n)}">${esc(n)}</button>`).join('')
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

// 唯一會 fetch reveal/ 的地方：玩家按下「開票」。
async function revealNow(c, btn){
  btn.disabled = true; const label = btn.textContent; btn.textContent = t('imp.revealing');
  try {
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
    ? `<div class="guessbox"><div class="n">${gs.correct}<small>/${gs.guessed}</small></div><div><b>${esc(t('res.guessTitle', { c: gs.correct }))}</b><p class="muted">${esc(t('res.guessBody', { n: gs.guessed, r: (gs.guessed / c.data.candidates.length).toFixed(1) }))}</p></div></div>`
    : `<p class="muted">${esc(t('res.guessNone'))}</p>`;
  return `
    <div class="verdict"><div class="eyebrow">${esc(t('res.eyebrow'))}</div>${vsHtml}<p class="muted" style="text-align:center">${esc(msg)}</p><div class="stampmark" aria-hidden="true">${esc(t('res.stamp'))}</div></div>
    <div><div class="eyebrow" style="margin-bottom:6px">${esc(t('res.scoreTitle'))}</div>
      <div class="stack" style="gap:8px">${scoreRows}<div class="scale-lbl"><span></span><span><span>−100</span><span>0</span><span>+100</span></span><span></span></div></div>
      <p class="muted" style="margin-top:6px">${esc(t('res.range'))}</p></div>
    ${guessHtml}
    <details><summary class="muted">${esc(t('res.adjust'))}</summary><div id="imps" style="margin-top:6px">${impRows(c) || `<p class="muted">${esc(t('imp.none'))}</p>`}</div></details>
    <div class="btns"><a class="btn" href="#/${c.key}/share">${esc(t('res.share'))}</a><button class="btn ghost" data-act="again">${esc(t('res.again'))}</button></div>
    <a class="btn line" href="#/${c.key}/detail">${esc(t('res.detail'))}</a>
    <p class="muted">${esc(t('res.disclaimer'))}</p>`;
}

async function viewResult(c){
  let rv, comp;
  try { rv = await fetchReveal(c.data.raceId); } catch { return { html: page(bar(raceLabel(c), t('res.meta')), errorBox(t('imp.err'))) }; }
  try { comp = await compute(c, rv); } catch (e) { console.error(e); return { html: page(bar(raceLabel(c), t('res.meta')), errorBox(t('err.engine'))) }; }
  c.lastComp = { rv, comp };
  return { html: page(bar(raceLabel(c), t('res.meta')), `<div id="resbody" style="display:contents">${resultBody(c, rv, comp)}</div>`) };
}
async function refreshResult(c){
  const rv = await fetchReveal(c.data.raceId);
  const comp = await compute(c, rv);
  const el = document.getElementById('resbody'); if (!el) return;
  const open = el.querySelector('details')?.open;
  el.innerHTML = resultBody(c, rv, comp);
  if (open) el.querySelector('details').open = true;
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

// ---------------- C4 分享 ----------------
let shareNames = false;
async function viewShare(c){
  let rv, comp;
  try { rv = await fetchReveal(c.data.raceId); comp = await compute(c, rv); } catch { return { html: page(bar(raceLabel(c), t('share.meta')), errorBox(t('err.engine'))) }; }
  const gs = guessStats(c, rv);
  const kind = comp.verdict === 'same' ? 'same' : comp.verdict === 'different' ? 'diff' : 'none';
  const top = comp.res.top.filter(n => comp.res.candidates.find(x => x.candidateId === n)?.score !== null).join('、');
  c.share = { top };
  const card = () => `<div class="og" role="img" aria-label="${esc(t('share.cardAlt'))}"><div class="col"><div class="eyebrow">${esc(t('share.eyebrow', { race: raceLabel(c) }))}</div>
    <h3>${lines(t(`share.${kind}.a`))}<span>${esc(t(`share.${kind}.em`))}</span>${esc(t(`share.${kind}.b`))}</h3>
    ${shareNames && top ? `<div class="nm">${esc(t('share.nameLine', { names: top }))}</div>` : ''}
    <div class="muted num">${esc(gs.guessed ? t('share.foot', { c: gs.correct, n: gs.guessed }) : t('share.footPlain'))}</div></div><div aria-hidden="true"></div></div>`;
  const body = `
    <h1 class="mid">${esc(t('share.title'))}</h1>
    <div id="ogwrap">${card()}</div>
    <label class="opt" style="cursor:pointer"><input type="checkbox" id="showNames" ${shareNames ? 'checked' : ''}> <span>${esc(t('share.names'))}<small>${esc(t('share.namesSub'))}</small></span></label>
    <div class="btns"><a class="btn" data-act="line" href="#/${c.key}/share" target="_blank" rel="noopener noreferrer">${esc(t('share.line'))}</a><button class="btn ghost" data-act="copy">${esc(t('share.copy'))}</button></div>
    <a class="btn line" href="#/${c.key}/result">${esc(t('det.back'))}</a>`;
  return {
    html: page(bar(raceLabel(c), t('share.meta')), body),
    mount(el){
      const line = el.querySelector('[data-act=line]');
      line.href = 'https://line.me/R/msg/text/?' + encodeURIComponent(t('share.text') + '\n' + shareUrl(c));
      el.querySelector('#showNames').addEventListener('change', e => { shareNames = e.target.checked; el.querySelector('#ogwrap').innerHTML = card(); });
    },
  };
}
const shareUrl = c => location.origin + location.pathname + '#/' + c.key;

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
    + [1, 2, 3].map(i => `<tr><td>${esc(t('info.privacy.r' + i + 'a'))}</td><td>${esc(t('info.privacy.r' + i + 'b'))}</td></tr>`).join('')
    + `</table><p class="muted">${esc(t('info.privacy.fonts'))}</p><p class="muted">${esc(t('info.privacy.note'))}</p>`;
  return { html: page(bar(t('brand'), t('info.meta')), `<div class="row">${chips}</div>${content}<a class="btn ghost" href="#/">${esc(t('common.home'))}</a>`, footer()) };
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
render();
