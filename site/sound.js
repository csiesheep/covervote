// site/sound.js — 聲音預設關；開關記在 localStorage。關著的時候連音檔都不會請求。FE 所有。
import { getItem, setItem } from './store.js';

const KEY = 'covervote:sound';
const cache = {};
let on = false;

export function initSound(){ on = getItem(KEY) === '1'; }
export const isSoundOn = () => on;
export function setSound(v){ on = !!v; setItem(KEY, on ? '1' : '0'); }

export function sfx(name){
  if (!on) return;
  try {
    const a = cache[name] || (cache[name] = new Audio(`assets/sfx_${name}.mp3`));
    a.currentTime = 0;
    a.play().catch(() => {});
  } catch {}
}
