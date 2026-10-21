// worker/api.mjs — /covervote/api/*：猜作者匯總、局數與「傾向 vs 契合」匯總、選罷法第 53 條自動下架。BE 所有（issue #4）。
//
//   handleApi(request, { store, now, data }) → Response | null（不是 /covervote/api/ 就回 null，交給靜態檔）
//     store  worker/memstore.mjs 或 worker/d1store.mjs（incr/get；有 incrMany/getMany 就用，少打幾次 D1）
//     now    Date；正式環境是 new Date()，注入是為了測試能模擬 11/20
//     data   { elections, races, candidates, passages }（loadData() 的形狀；Worker 用 import 打包）
//
//   POST /covervote/api/guess          { race, guesses: [{ passage, name }] } → 204
//   POST /covervote/api/play           { race, verdict: 'same'|'different'|'none' } → 204
//   GET  /covervote/api/health/<race>  → { race, passages: [{ id, answers, correct, rate, random, flagged }] }
//   GET  /covervote/api/stats/<race>   → { race, plays, blackout, verdicts? }
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
//   - 防濫用：body > 8 KB → 413；一次 guess 的筆數 > 該選區段落數 → 400；method 不對 → 405。
//     同一個請求裡同一段只算第一筆（一局每段只猜一次）。
//   - GET 回應一律 cache-control: no-store：快取會讓 11/17 23:59 的 verdicts 活過 11/18 00:00。

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

async function readBody(request){
  const len = Number(request.headers.get('content-length'));
  if (Number.isFinite(len) && len > MAX_BODY) return { status: 413 };
  const buf = await request.arrayBuffer();
  if (buf.byteLength > MAX_BODY) return { status: 413 };
  try { return { body: JSON.parse(new TextDecoder().decode(buf)) }; }
  catch { return { status: 400, msg: 'body 不是 JSON' }; }
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
  const seen = new Set(), entries = [];
  for (const g of body.guesses){
    const p = typeof g?.passage === 'string' ? byId.get(g.passage) : undefined;
    if (!p || seen.has(p.id) || typeof g.name !== 'string' || !roster.has(g.name)) continue;
    seen.add(p.id);
    entries.push([KEY.answers(race.id, p.id), 1]);
    if (g.name === nameOf.get(p.candidateId)) entries.push([KEY.correct(race.id, p.id), 1]);
  }
  if (!internal) await incrMany(store, entries);
  return noContent();
}

async function postPlay(body, { store, data, internal }){
  const race = data.races.find(r => r.id === body?.race);
  if (!race) return error(400, '不認得的選區');
  if (!VERDICTS.includes(body.verdict)) return error(400, 'verdict 要是 same／different／none');
  if (!internal) await incrMany(store, [[KEY.plays(race.id), 1], [KEY.verdict(race.id, body.verdict), 1]]);
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

export async function handleApi(request, { store, now = new Date(), data }){
  const url = new URL(request.url);
  if (url.pathname !== PREFIX && !url.pathname.startsWith(PREFIX + '/')) return null;
  const route = url.pathname.slice(PREFIX.length + 1);
  const ctx = { store, now, data, internal: url.searchParams.get('internal') === '1' };

  if (route === 'guess' || route === 'play'){
    if (request.method !== 'POST') return error(405, 'method 不對', { allow: 'POST' });
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

  return error(404, '沒有這個端點');
}
