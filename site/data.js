// site/data.js — 取得選區資料與分組。FE 所有。
// 開票前只讀 race/<id>.json 與 cands/<id>.json。reveal/ 只在 fetchReveal() 裡，由「開票」按鈕呼叫。
import { raceIdOf } from './config.js';

export class NotFound extends Error {}

async function getJson(path){
  let r;
  try { r = await fetch(path); } catch (e) { throw new Error('network'); }
  if (r.status === 404) throw new NotFound(path);
  if (!r.ok) throw new Error('http ' + r.status);
  try { return await r.json(); } catch { throw new NotFound(path); }
}

const cache = new Map();
export function loadRace(key){
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
  const rounds = [], single = [];
  for (const [issueId, list] of by){
    if (list.length >= 2) rounds.push({ issueId, cards: shuffled(list, seed ^ hash(issueId)) });
    else single.push(list[0]);
  }
  const bonus = shuffled(single, seed ^ hash('bonus'));
  return { rounds, bonus, steps: rounds.length + (bonus.length ? 1 : 0) };
}

// 傾向與猜作者的選單順序：號次都有就照號次；只要有任何一個 null，就每位玩家隨機排一次、存本機（orchestrator 裁決 #3）。
export function menuOrder(candidates, saved, seed){
  const names = candidates.map(c => c.name);
  const hasNull = candidates.some(c => c.number === null || c.number === undefined);
  if (!hasNull){
    return candidates.slice().sort((a, b) => a.number - b.number).map(c => c.name);
  }
  if (Array.isArray(saved) && saved.length === names.length && names.every(n => saved.includes(n))) return saved;
  return shuffled(names, seed);
}
