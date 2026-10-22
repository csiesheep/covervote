// worker/api.mjs — /covervote/api/*：猜作者匯總、局數與「傾向 vs 契合」匯總、選罷法第 53 條自動下架。BE 所有（issue #4）。
//
//   handleApi(request, { store, now, data, limiter }) → Response | null（不是 /covervote/api/ 就回 null，交給靜態檔）
//     store    worker/memstore.mjs 或 worker/d1store.mjs（incr/get；有 incrMany/getMany 就用，少打幾次 D1）
//     now      Date；正式環境是 new Date()，注入是為了測試能模擬 11/20
//     data     { elections, races, candidates, passages }（loadData() 的形狀；Worker 用 import 打包）
//     limiter  選填，{ limit({ key }) → Promise<{ success }> }：正式環境是 Workers Rate Limiting 綁定（#32），沒給就不限速
//
//   POST /covervote/api/guess          { race, guesses: [{ passage, name }] } → 204
//   POST /covervote/api/play           { race, verdict: 'same'|'different'|'none' } → 204
//   GET  /covervote/api/health/<race>  → { race, passages: [{ id, answers, correct, rate, random, flagged }] }
//   GET  /covervote/api/stats/<race>   → { race, plays, blackout, verdicts? }
//   GET  /covervote/api/class/<code>/<race> → { class, race, plays, blackout, guesses: { answers, correct }, verdicts? }（#10）
//   POST guess／play 的 body 可以多一個選填的 `class`（班級代碼）：格式對的才另外計入班級，全站照常計。
//
// 規則（TEAM.md「產品不可協商的約束」、tests/acc_api.mjs 檔頭）：
//   - 只存匯總計數。body 只讀 race、guesses[].passage、guesses[].name、verdict，其他欄位（lean、ua…）讀都不讀；
//     store 的鍵只由 選區 id、段落 id、verdict 組成（見 KEY）。不記 IP、不用 cookie、沒有帳號。
//   - `internal=1`（query）的 POST 照樣回 204，但不計。
//   - 選罷法第 53 條：data/elections.json 的 pollBlackoutFrom 起、到 voteDate 當天 16:00 +08:00（投票截止）止，
//     stats 不回 verdicts（連鍵都沒有）。日期不寫死；選舉資料不全、日期讀不懂 → 當作在禁止期（寧可多藏）。
//     局數、段落猜中率不受影響。
//   - verdicts 未滿 MIN_PLAYS 局不回傳。
//   - 遮蔽健康度：random = 1 / 該選區有段落的候選人數；answers ≥ FLAG_MIN 且 rate > random + FLAG_MARGIN → flagged。
//   - 防濫用：body > 8 KB → 413（沒有 content-length 也是讀到超過就停）；一次 guess 的筆數 > 該選區段落數 → 400；method 不對 → 405。
//     同一個請求裡同一段只算第一筆（一局每段只猜一次）。
//   - POST 的順序（#32）：405 → content-type 不是 application/json 415 → 外站 Origin 403 → limiter 拒絕 429 → body 413／400。
//     前三種都不耗限額、都不計數。
//   - GET 回應一律 cache-control: no-store：快取會讓 11/17 23:59 的 verdicts 活過 11/18 00:00。
//
// 課堂版（issue #10，orchestrator 裁決：沒有帳號，代碼由老師的頁面在前端產生，後端只認格式）：
//   - 代碼：6 碼，字元只用 A–Z 去掉 I、O，與 2–9（CLASS_RE）。不是字串、或格式不對 → 班級不計（全站照計），
//     而且不會組成任何鍵：store 只看得到格式檢查過的代碼（CKEY 一律經過 ckey() 再檢查一次）。GET 格式不對 → 400。
//   - 班級的鍵在同一張 counters 表加 `c:<code>:<race>:` 前綴，跟全站的鍵放在同一個 incrMany（D1 同一個交易）。
//   - 班級 verdicts：班級局數 ≥ MIN_CLASS 且不在禁止期才回傳；禁止期與 stats 用同一個 inBlackout。
//     局數與猜作者匯總（答題數、答對數）禁止期照常。internal=1 全站與班級都不計。

const PREFIX = '/covervote/api';
const MAX_BODY = 8 * 1024;
const MIN_PLAYS = 50;
const FLAG_MIN = 200, FLAG_MARGIN = 0.20;
const VERDICTS = ['same', 'different', 'none'];
const POLL_CLOSE = 'T16:00:00+08:00'; // 投票截止：投票日當天 16:00（臺灣時間）

export const KEY = {
  answers: (race, passage) => `g:${race}:${passage}:a`,
  correct: (race, passage) => `g:${race}:${passage}:c`,
  plays: race => `p:${race}:n`,
  verdict: (race, v) => `p:${race}:v:${v}`,
};

const MIN_CLASS = 5;
export const CLASS_RE = /^[A-HJ-NP-Z2-9]{6}$/;
// 不是字串就不是代碼（陣列 ['ABC234'] 轉成字串會變成合法的樣子，所以先看型別）。
export const classCode = v => (typeof v === 'string' && CLASS_RE.test(v)) ? v : null;

// 班級的鍵。只經過 ckey() 組：代碼沒過 classCode() 就丟例外，格式不對的字串到不了 store。
export const CKEY = {
  answers: (code, race) => `c:${code}:${race}:a`,
  correct: (code, race) => `c:${code}:${race}:c`,
  plays: (code, race) => `c:${code}:${race}:n`,
  verdict: (code, race, v) => `c:${code}:${race}:v:${v}`,
};
const ckey = (k, code, ...rest) => {
  if (!classCode(code)) throw new Error('班級代碼沒有檢查過');
  return CKEY[k](code, ...rest);
};

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: HEADERS });
const error = (status, msg, extra = {}) => new Response(JSON.stringify({ error: msg }), { status, headers: { ...HEADERS, ...extra } });
const noContent = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });

const incrMany = async (store, entries) => {
  if (!entries.length) return;
  if (store.incrMany) return store.incrMany(entries);
  for (const [k, n] of entries) await store.incr(k, n);
};
const getMany = async (store, keys) => {
  if (store.getMany) return store.getMany(keys);
  const out = {};
  for (const k of keys) out[k] = Number(await store.get(k)) || 0;
  return out;
};

// 禁止期：[pollBlackoutFrom, voteDate 16:00 +08:00)。讀不到或讀不懂 → true（fail closed）。
export function inBlackout(race, elections, now){
  const e = elections.find(x => x.id === race.electionId);
  if (!e) return true;
  const from = Date.parse(e.pollBlackoutFrom);
  const until = Date.parse(String(e.voteDate) + POLL_CLOSE);
  if (!Number.isFinite(from) || !Number.isFinite(until)) return true;
  const t = now.getTime();
  return t >= from && t < until;
}

// 有 content-length 就先看它；沒有（chunked）就邊讀邊數，超過 MAX_BODY 立刻 cancel、回 413，不整包讀進記憶體（審查 #13）。
async function readBody(request){
  const len = Number(request.headers.get('content-length'));
  if (Number.isFinite(len) && len > MAX_BODY) return { status: 413 };
  const parts = []; let size = 0;
  if (request.body){
    const reader = request.body.getReader();
    for (;;){
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY){ await reader.cancel().catch(() => {}); return { status: 413 }; }
      parts.push(value);
    }
  }
  const buf = new Uint8Array(size); let off = 0;
  for (const p of parts){ buf.set(p, off); off += p.byteLength; }
  try { return { body: JSON.parse(new TextDecoder().decode(buf)) }; }
  catch { return { status: 400, msg: 'body 不是 JSON' }; }
}

// POST 的前置檢查（審查 #5，issue #32）。都在讀 body、碰 limiter 之前做，不花任何成本：
//   content-type 的 media type 不是 application/json → 415。text/plain、form 是 CORS 的 simple request，
//     外站頁面不經 preflight 就能讓訪客的瀏覽器送出；要求 application/json，跨站就一定要 preflight，而這裡不回 CORS 標頭。
//   帶 Origin 但不是本站 → 403。本站 = ALLOWED_ORIGIN，或跟請求網址同源（本機 wrangler dev 的 http://localhost:8787；
//     orchestrator 裁決 #32：「同意放行同源＋games.csiesheep.com」）。外站頁面送不出等於目標站的 Origin。
//     沒有 Origin（curl、舊瀏覽器）照常。
const ALLOWED_ORIGIN = 'https://games.csiesheep.com';
const mediaType = v => String(v || '').split(';')[0].trim().toLowerCase();
function precheck(request, url){
  if (mediaType(request.headers.get('content-type')) !== 'application/json') return error(415, 'content-type 要是 application/json');
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== ALLOWED_ORIGIN && origin !== url.origin) return error(403, '不收外站的請求');
  return null;
}

// 限速（issue #32）：ctx.limiter 是 Workers Rate Limiting 綁定（wrangler.jsonc 的 ratelimits；數字只寫在那裡），
// 鍵是 CF-Connecting-IP。IP 只交給綁定（Cloudflare 的暫態計數），不進 store、不進任何回應、不 console 輸出（TEAM.md：不記 IP）。
// 拒絕 → 429、不計。綁定本身壞掉 → 放行（fail open：限速壞掉不該讓真玩家的局數消失），只印一行固定字串。
async function limited(request, limiter){
  if (!limiter) return false;
  try {
    const { success } = await limiter.limit({ key: request.headers.get('cf-connecting-ip') || 'no-ip' });
    return success === false;
  } catch {
    console.warn('covervote api: limiter 失敗，放行');
    return false;
  }
}

async function postGuess(body, { store, data, internal }){
  const race = data.races.find(r => r.id === body?.race);
  if (!race) return error(400, '不認得的選區');
  if (!Array.isArray(body.guesses)) return error(400, 'guesses 要是陣列');
  const ps = data.passages.filter(p => p.race === race.id);
  if (body.guesses.length > ps.length) return error(400, `一次最多 ${ps.length} 筆（該選區的段落數）`);
  const byId = new Map(ps.map(p => [p.id, p]));
  const nameOf = new Map(data.candidates.filter(c => c.raceId === race.id).map(c => [c.id, c.name]));
  const roster = new Set(nameOf.values());
  const code = classCode(body.class);
  const seen = new Set(), entries = [];
  let answers = 0, correct = 0;
  for (const g of body.guesses){
    const p = typeof g?.passage === 'string' ? byId.get(g.passage) : undefined;
    if (!p || seen.has(p.id) || typeof g.name !== 'string' || !roster.has(g.name)) continue;
    seen.add(p.id);
    entries.push([KEY.answers(race.id, p.id), 1]); answers++;
    if (g.name === nameOf.get(p.candidateId)){ entries.push([KEY.correct(race.id, p.id), 1]); correct++; }
  }
  if (code && answers) entries.push([ckey('answers', code, race.id), answers]);
  if (code && correct) entries.push([ckey('correct', code, race.id), correct]);
  if (!internal) await incrMany(store, entries);
  return noContent();
}

async function postPlay(body, { store, data, internal }){
  const race = data.races.find(r => r.id === body?.race);
  if (!race) return error(400, '不認得的選區');
  if (!VERDICTS.includes(body.verdict)) return error(400, 'verdict 要是 same／different／none');
  const entries = [[KEY.plays(race.id), 1], [KEY.verdict(race.id, body.verdict), 1]];
  const code = classCode(body.class);
  if (code) entries.push([ckey('plays', code, race.id), 1], [ckey('verdict', code, race.id, body.verdict), 1]);
  if (!internal) await incrMany(store, entries);
  return noContent();
}

async function getHealth(race, { store, data }){
  const ps = data.passages.filter(p => p.race === race.id);
  const nWithPassages = new Set(ps.map(p => p.candidateId)).size;
  const random = nWithPassages ? 1 / nWithPassages : null;
  const keys = ps.flatMap(p => [KEY.answers(race.id, p.id), KEY.correct(race.id, p.id)]);
  const v = await getMany(store, keys);
  return json({
    race: race.id,
    passages: ps.map(p => {
      const answers = v[KEY.answers(race.id, p.id)] || 0, correct = v[KEY.correct(race.id, p.id)] || 0;
      const rate = answers ? correct / answers : null;
      const flagged = answers >= FLAG_MIN && random !== null && rate > random + FLAG_MARGIN;
      return { id: p.id, answers, correct, rate, random, flagged };
    }),
  });
}

async function getStats(race, { store, data, now }){
  const blackout = inBlackout(race, data.elections, now);
  const plays = Number(await store.get(KEY.plays(race.id))) || 0;
  const out = { race: race.id, plays, blackout };
  // 禁止期連讀都不讀：verdicts 的數字不進這個函式的任何變數，就不會從別的鍵漏出去。
  if (!blackout && plays >= MIN_PLAYS){
    const v = await getMany(store, VERDICTS.map(x => KEY.verdict(race.id, x)));
    out.verdicts = Object.fromEntries(VERDICTS.map(x => [x, v[KEY.verdict(race.id, x)] || 0]));
  }
  return json(out);
}

async function getClass(code, race, { store, data, now }){
  const blackout = inBlackout(race, data.elections, now);
  const keys = { plays: ckey('plays', code, race.id), answers: ckey('answers', code, race.id), correct: ckey('correct', code, race.id) };
  const v = await getMany(store, Object.values(keys));
  const plays = v[keys.plays] || 0;
  const out = { class: code, race: race.id, plays, blackout, guesses: { answers: v[keys.answers] || 0, correct: v[keys.correct] || 0 } };
  // 跟 getStats 一樣：禁止期連讀都不讀班級的 verdict 鍵。
  if (!blackout && plays >= MIN_CLASS){
    const vk = VERDICTS.map(x => ckey('verdict', code, race.id, x));
    const w = await getMany(store, vk);
    out.verdicts = Object.fromEntries(VERDICTS.map((x, i) => [x, w[vk[i]] || 0]));
  }
  return json(out);
}

export async function handleApi(request, { store, now = new Date(), data, limiter }){
  const url = new URL(request.url);
  if (url.pathname !== PREFIX && !url.pathname.startsWith(PREFIX + '/')) return null;
  const route = url.pathname.slice(PREFIX.length + 1);
  const ctx = { store, now, data, internal: url.searchParams.get('internal') === '1' };

  if (route === 'guess' || route === 'play'){
    if (request.method !== 'POST') return error(405, 'method 不對', { allow: 'POST' });
    const pre = precheck(request, url);
    if (pre) return pre;
    if (await limited(request, limiter)) return error(429, '太頻繁了，稍後再試', { 'retry-after': '60' });
    const r = await readBody(request);
    if (r.status === 413) return error(413, `body 超過 ${MAX_BODY} bytes`);
    if (r.status) return error(r.status, r.msg);
    return route === 'guess' ? postGuess(r.body, ctx) : postPlay(r.body, ctx);
  }

  const m = /^(health|stats)\/([^/]+)$/.exec(route);
  if (m){
    if (request.method !== 'GET' && request.method !== 'HEAD') return error(405, 'method 不對', { allow: 'GET, HEAD' });
    let id;
    try { id = decodeURIComponent(m[2]); } catch { return error(404, '不認得的選區'); }
    const race = data.races.find(r => r.id === id);
    if (!race) return error(404, '不認得的選區');
    return m[1] === 'health' ? getHealth(race, ctx) : getStats(race, ctx);
  }

  const c = /^class\/([^/]+)\/([^/]+)$/.exec(route);
  if (c){
    if (request.method !== 'GET' && request.method !== 'HEAD') return error(405, 'method 不對', { allow: 'GET, HEAD' });
    // 代碼不做 URL 解碼：合法代碼只有 A–Z、2–9，用不到編碼；帶 % 的一律算格式不對。
    const code = classCode(c[1]);
    if (!code) return error(400, '班級代碼格式不對（6 碼，A–Z 去掉 I、O，與 2–9）');
    let id;
    try { id = decodeURIComponent(c[2]); } catch { return error(404, '不認得的選區'); }
    const race = data.races.find(r => r.id === id);
    if (!race) return error(404, '不認得的選區');
    return getClass(code, race, ctx);
  }

  return error(404, '沒有這個端點');
}
