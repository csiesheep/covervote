// site/analytics.js — Google Analytics 4（issue #21）。FE 所有。
//
// 四種情況「根本不載入」gtag.js（連 window.gtag 都不定義）：
//   1) internal=1（store.js isInternal：網址或 sessionStorage）  2) 嵌入模式 ?embed=1
//   3) 班級連結（有合格的 ?class=）                              4) 玩家在隱私頁按了「不要統計我」
// 事件只有流程：page_view / select_city / game_start / reveal / share。
// 參數只准 city（縣市代碼，來自 config.js 的 TILES）；page_path 只准縣市代碼與步驟名。
// 不送：傾向、分數、猜測、verdict、候選人名字、班級代碼。track() 自己擋，呼叫端傳什麼都一樣。
import { TILES } from './config.js';
import { isInternal, isEmbed, classCode, getItem, setItem, removeItem } from './store.js';

export const GA4_ID = 'G-Q4VS3P3T58';
const OPT_KEY = 'covervote:ga-off';
const CITIES = new Set(TILES.map(x => x.key));
const STEPS = new Set(['health', 'lean', 'play', 'bonus', 'important', 'reveal', 'result', 'detail', 'share']);
const INFO = new Set(['method', 'sources', 'privacy', 'about']);
const EVENTS = new Set(['select_city', 'game_start', 'reveal', 'share']);

window.__events = window.__events || [];   // 本來會送出的事件，只在記憶體，給驗收看
let loaded = false;

export const isOptedOut = () => getItem(OPT_KEY) === '1';
// 四種情況任何一種成立 = 不載入、不送
export const gaAllowed = () => !isInternal() && !isEmbed() && !classCode() && !isOptedOut();

// route（#/ 之後）→ 只含縣市代碼與步驟名的路徑；其餘（班級代碼、未知片段）一律丟掉。
export function safeRoute(hash){
  const seg = String(hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  if (!seg.length) return '';
  if (seg[0] === 'info') return 'info/' + (INFO.has(seg[1]) ? seg[1] : 'method');
  if (seg[0] === 'embed') return 'embed';
  if (seg[0] === 'class') return 'class';   // #/class/<班級代碼> 的代碼不送
  if (!CITIES.has(seg[0])) return '';
  const out = [seg[0]];
  if (STEPS.has(seg[1])){ out.push(seg[1]); if (seg[1] === 'play' && /^\d{1,2}$/.test(seg[2] || '')) out.push(seg[2]); }
  return out.join('/');
}

function inject(){
  const s = document.createElement('script');
  s.async = true; s.dataset.ga4 = '1';
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA4_ID);
  document.head.append(s);
}

function load(){
  if (loaded || !gaAllowed()) return;
  loaded = true;
  window['ga-disable-' + GA4_ID] = false;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function(){ window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', GA4_ID, { allow_google_signals: false, allow_ad_personalization_signals: false, send_page_view: false });
  // 不擋畫面：config 先進 dataLayer（不花請求），gtag.js 等 load 之後、瀏覽器閒下來才插入。
  const go = () => (window.requestIdleCallback ? window.requestIdleCallback(inject, { timeout: 4000 }) : setTimeout(inject, 1500));
  if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
}

function send(name, params){
  window.__events.push({ name, ...params });
  window.gtag('event', name, params);
}

export function initAnalytics(){ load(); }

// hash 路由每換一頁呼叫一次。page_location 不帶 query（class／internal 都不會出去）。
export function trackPage(){
  if (!gaAllowed()) return;
  load();
  if (!loaded) return;
  const r = safeRoute(location.hash);
  const path = '/covervote/#/' + r;
  send('page_view', { page_path: path, page_location: location.origin + path, page_title: document.title });
}

// 事件：名字要在白名單、city 要是已知縣市代碼；其餘參數一律不收。
export function track(name, city){
  try {
    if (!EVENTS.has(name) || !gaAllowed() || !loaded) return;
    const params = CITIES.has(city) ? { city } : {};
    send(name, params);
  } catch {}
}

// 隱私頁開關。關：立刻停送（本頁已載入的 gtag.js 也被 ga-disable 停掉），之後不再載入；開：恢復。
export function setOptOut(off){
  if (off){
    setItem(OPT_KEY, '1');
    window['ga-disable-' + GA4_ID] = true;
  } else {
    removeItem(OPT_KEY);
    window['ga-disable-' + GA4_ID] = false;
    trackPage();
  }
}
