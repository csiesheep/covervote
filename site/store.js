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
