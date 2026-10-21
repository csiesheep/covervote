// site/store.js — 傾向、每段分數、猜作者只存在這支手機（localStorage）。FE 所有。
// 每次讀寫都包 try/catch；讀不到就用記憶體，照樣能玩。這裡沒有任何網路請求（網路只在 api.js）。
const mem = new Map();

export function getItem(k){
  try { const v = localStorage.getItem(k); if (v !== null) return v; } catch {}
  return mem.has(k) ? mem.get(k) : null;
}
export function setItem(k, v){
  mem.set(k, v);
  try { localStorage.setItem(k, v); } catch {}
}
export function removeItem(k){
  mem.delete(k);
  try { localStorage.removeItem(k); } catch {}
}

// ?internal=1：記在 sessionStorage；api.js 的所有 POST 都帶 ?internal=1（後端不計）。
let internalFlag = false;
export function initInternal(){
  try {
    if (new URLSearchParams(location.search).get('internal') === '1'){
      internalFlag = true;
      try { sessionStorage.setItem('covervote:internal', '1'); } catch {}
    }
  } catch {}
}
export function isInternal(){
  if (internalFlag) return true;
  try { return sessionStorage.getItem('covervote:internal') === '1'; } catch { return false; }
}

const KEY = raceId => `covervote:v1:${raceId}`;
const randomSeed = () => {
  try { return crypto.getRandomValues(new Uint32Array(1))[0]; } catch { return Math.floor(Math.random() * 4294967296); }
};

// lean / guesses 的值是候選人姓名（orchestrator 裁決 #3：鍵是姓名）。
// lean：姓名 | 'undecided' | 'private' | null；guesses[passageId]：姓名 | 'unknown'
export function freshState(){
  return { v: 1, seed: randomSeed(), lean: null, ratings: {}, guesses: {}, important: [], menuOrder: null, done: false,
           sent: { guess: false, play: false } };   // 這一局的猜作者／局有沒有已經送出（同一局只送一次；再玩一次 = freshState，旗標歸零）
}

export function loadState(raceId){
  const s = freshState();
  try {
    const j = JSON.parse(getItem(KEY(raceId)));
    if (!j || j.v !== 1) return s;
    if (Number.isInteger(j.seed)) s.seed = j.seed;
    if (typeof j.lean === 'string') s.lean = j.lean;
    for (const [k, v] of Object.entries(j.ratings || {})) if (Number.isInteger(v) && v >= -2 && v <= 2) s.ratings[k] = v;
    for (const [k, v] of Object.entries(j.guesses || {})) if (typeof v === 'string') s.guesses[k] = v;
    if (Array.isArray(j.important)) s.important = j.important.filter(x => typeof x === 'string');
    if (Array.isArray(j.menuOrder)) s.menuOrder = j.menuOrder.filter(x => typeof x === 'string');
    s.done = j.done === true;
    if (j.sent && typeof j.sent === 'object') s.sent = { guess: j.sent.guess === true, play: j.sent.play === true };
  } catch {}
  return s;
}
export function saveState(raceId, s){ try { setItem(KEY(raceId), JSON.stringify(s)); } catch {} }

export const hasProgress = s => s.lean !== null || Object.keys(s.ratings).length > 0 || s.done;

// ?embed=1：嵌入模式（媒體把一局放進 iframe）。只看網址；不影響任何資料請求，也不改變 internal 旗標。
export const isEmbed = () => { try { return new URLSearchParams(location.search).get("embed") === "1"; } catch { return false; } };

// ---- 班級（課堂版，#11）----
// ?class=<code>：6 碼，A–Z 去掉 I、O，加 2–9。格式對才收，存 sessionStorage；格式不對的忽略（不覆蓋、不顯示）。
// 學生端唯一多送的東西就是這個代碼；沒有座號、姓名、任何能辨認學生的欄位。
export const CLASS_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CLASS_RE = /^[A-HJ-NP-Z2-9]{6}$/;
let classMem = '';
export function initClass(){
  try {
    const v = new URLSearchParams(location.search).get('class');
    if (v && CLASS_RE.test(v)){ classMem = v; try { sessionStorage.setItem('covervote:class', v); } catch {} }
  } catch {}
}
export function classCode(){
  let v = classMem;
  try { v = sessionStorage.getItem('covervote:class') || v; } catch {}
  return v && CLASS_RE.test(v) ? v : '';
}
export function newClassCode(){
  const out = [];
  const buf = new Uint8Array(32);
  while (out.length < 6){
    crypto.getRandomValues(buf);
    for (const b of buf){ if (b < 224 && out.length < 6) out.push(CLASS_ALPHABET[b % 32]); }   // 224 = 7×32，拒絕取樣免偏
  }
  return out.join('');
}
// 老師的班級清單：只在老師的瀏覽器
export function loadClasses(){
  try { const a = JSON.parse(getItem('covervote:classes')); return Array.isArray(a) ? a.filter(x => x && CLASS_RE.test(x.code)) : []; } catch { return []; }
}
export function saveClasses(a){ try { setItem('covervote:classes', JSON.stringify(a)); } catch {} }
