// site/api.js — 和後端（/covervote/api/*，worker/api.mjs）的所有往來。FE 所有。
//
// 只有三種東西會離開瀏覽器，全部是匿名匯總用的：
//   POST guess  { race, guesses: [{ passage, name }] }   開票之前送（呼叫端 app.js revealNow 負責順序）
//   POST play   { race, verdict }                        只有選區與結果類型。不帶傾向、分數、猜測內容。
//   GET  health / stats                                  讀匯總
// 本檔刻意不接受「任意 body」：每個函式自己組欄位，多餘的東西沒有地方可以夾帶。
// internal=1（網址或 sessionStorage 有旗標）：所有 POST 帶 ?internal=1，後端不計。
import { isInternal } from './store.js';

// 相對網址：頁面在 /covervote/ 底下，api/ 就是 /covervote/api/（路徑等於網址，見 tools/build_public.mjs）。
const url = (path, post) => 'api/' + path + (post && isInternal() ? '?internal=1' : '');

async function send(method, path, body, ms = 5000){
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const init = { method, signal: ctl.signal, cache: 'no-store' };
    if (method === 'POST'){ init.body = JSON.stringify(body); init.headers = { 'content-type': 'application/json' }; }
    const r = await fetch(url(path, method === 'POST'), init);
    if (!r.ok) throw new Error('http ' + r.status);
    return r.status === 204 ? null : await r.json();
  } finally { clearTimeout(timer); }
}

export const postGuess = (race, guesses) => send('POST', 'guess', { race, guesses: guesses.map(g => ({ passage: g.passage, name: g.name })) });
export const postPlay = (race, verdict) => send('POST', 'play', { race, verdict });
export const getHealth = race => send('GET', 'health/' + encodeURIComponent(race));
export const getStats = race => send('GET', 'stats/' + encodeURIComponent(race));
