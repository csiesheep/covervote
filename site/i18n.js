// site/i18n.js — 畫面上的字都在 lang/*.js。?lang=en 切英文，記在 localStorage。FE 所有。
import zh from './lang/zh-Hant.js';
import en from './lang/en.js';
import { getItem, setItem } from './store.js';

const PACKS = { 'zh-Hant': zh, en };
let cur = 'zh-Hant';

export function initLang(){
  let q = null;
  try { q = new URLSearchParams(location.search).get('lang'); } catch {}
  if (q && PACKS[q]) setItem('covervote:lang', q);
  const saved = getItem('covervote:lang');
  if (saved && PACKS[saved]) cur = saved;
  document.documentElement.lang = cur;
  document.title = t('brand');
}
export const lang = () => cur;
export function t(key, params){
  if (params && params.n === 1 && has(key + '.one')) key += '.one';   // n === 1 用單數鍵（#34 的 *.one）
  let s = PACKS[cur][key];
  if (s === undefined) s = PACKS['zh-Hant'][key];
  if (s === undefined) return key;
  if (typeof s !== 'string') return s;
  return params ? s.replace(/\{(\w+)\}/g, (m, n) => (params[n] ?? m)) : s;
}
export const has = key => PACKS[cur][key] !== undefined || PACKS['zh-Hant'][key] !== undefined;
