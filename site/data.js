// site/data.js — 取得選區資料與分組。FE 所有。
// 開票前只讀 race/<id>.json 與 cands/<id>.json。reveal/ 只在 fetchReveal() 裡，由「開票」按鈕呼叫。
import { raceIdOf, cityKey } from './config.js';

export class NotFound extends Error {}

// 資料檔版本：部署後幾秒內邊緣可能混送新舊檔，題目檔和開票檔版本不一致會讓開票對錯人。
// 開頁時先拿 version.txt 的 SHA，之後 race/ cands/ reveal/ issues.json 都帶 ?v=<sha>。拿不到（404、逾時、不像 SHA）就不加。
let dataVersion = '';
export const getDataVersion = () => dataVersion;
export async function initVersion(){
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 3000);
  try {
    const r = await fetch('version.txt', { cache: 'no-store', signal: ctl.signal });
    if (r.ok){ const v = (await r.text()).trim(); if (/^[0-9a-f]{7,64}$/i.test(v)) dataVersion = v; }
  } catch {} finally { clearTimeout(timer); }
}
const versioned = path => dataVersion ? path + '?v=' + encodeURIComponent(dataVersion) : path;

async function getJson(path){
  let r;
  try { r = await fetch(versioned(path)); } catch (e) { throw new Error('network'); }
  if (r.status === 404) throw new NotFound(path);
  if (!r.ok) throw new Error('http ' + r.status);
  try { return await r.json(); } catch { throw new NotFound(path); }
}

const cache = new Map();
export function loadRace(key){
  if (!cityKey(key)) return Promise.reject(new NotFound(String(key)));   // 外來字串不能進抓檔路徑
  if (!cache.has(key)){
    const p = (async () => {
      const raceId = raceIdOf(key);
      const [race, cands] = await Promise.all([getJson(`race/${raceId}.json`), getJson(`cands/${raceId}.json`)]);
      if (!race || !race.race || !Array.isArray(race.passages) || !cands || !Array.isArray(cands.candidates)) throw new NotFound(key);
      return { key, raceId, meta: race.race, passages: race.passages, candidates: cands.candidates };
    })();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return cache.get(key);
}

// issues.json（BE 輸出）：[{ id, label }]。取不到就回空表，畫面顯示 issueId 原字。
let issuesP = null;
export function loadIssues(){
  if (!issuesP) issuesP = getJson('issues.json').then(j => new Map((Array.isArray(j) ? j : []).map(i => [i.id, i.label]))).catch(() => new Map());
  return issuesP;
}

// ---- 開票（只在按下「開票」之後呼叫）----
const revealCache = new Map();
export async function fetchReveal(raceId){
  if (revealCache.has(raceId)) return revealCache.get(raceId);
  const j = await getJson(`reveal/${raceId}.json`);
  if (!j || !Array.isArray(j.passages)) throw new Error('bad reveal');
  const byId = new Map(j.passages.map(p => [p.id, p]));
  revealCache.set(raceId, byId);
  return byId;
}
export const revealLoaded = raceId => revealCache.has(raceId);

// ---- 亂數與排序 ----
export function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619); return h >>> 0; };
export function shuffled(list, seed){
  const a = list.slice(), r = mulberry32(seed);
  for (let i = a.length - 1; i > 0; i--){ const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// 同一議題 ≥2 段 = 一輪；只有 1 段 = 加分題。每輪的牌序由玩家的 seed 決定（存在本機），不照資料檔的順序。
export function buildPlan(passages, seed){
  const by = new Map();
  for (const p of passages){ if (!by.has(p.issueId)) by.set(p.issueId, []); by.get(p.issueId).push(p); }
  let rounds = []; const single = [];
  for (const [issueId, list] of by){
    if (list.length >= 2) rounds.push({ issueId, cards: shuffled(list, seed ^ hash(issueId)) });
    else single.push(list[0]);
  }
  const bonus = shuffled(single, seed ^ hash('bonus'));
  rounds = shuffled(rounds, seed ^ hash('rounds')); // 議題順序每局隨機（owner：議題每次隨機）；同 seed 穩定
  return { rounds, bonus, steps: rounds.length + (bonus.length ? 1 : 0) };
}

// 傾向與猜作者的選單順序：直接照 cands/ 給的順序（BE 在 build 時排好：先藍、後綠、再其他，組內照號次）。
// 不隨機；舊存檔的 saved 與 seed 一律忽略（owner 2026-10-21：「請向投給誰 先藍後綠再其他」，#30）。
export function menuOrder(candidates, _saved, _seed){
  return candidates.map(c => c.name);
}
