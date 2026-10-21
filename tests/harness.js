// tests/harness.js — 三態驗收的最小骨架。orchestrator 所有；peer 可以跑、可以證偽、不編輯。
//
// 三態：通過 / 失敗 / 尚未實作。把「還沒做」和「做了但錯」混成同一種紅，一整張 issue
// 可以在功能不存在的情況下被標記成完成。
//
// 寫 check 的三條規矩：
//   1. 期望值從設計文件抄、寫死在這裡，不從產品的設定檔讀（改產品的數字讓測試變綠，
//      會在「常數對照」那一組就爆，而不是安靜地通過）。
//   2. 通過的那一列也要印出它量到什麼（ok() 帶訊息）——失敗路徑天天被證偽走過，
//      成功路徑沒有人看，而追蹤緩慢侵蝕的數字長在成功路徑上。
//   3. 任何「必須沒有 X」「A 跟 B 一致」的檢查，先斷言母體非空、先把 A 對到絕對值。
//      非空還不夠：母體裡要有「對的實作與最像的錯實作會給出不同答案」的案例，而且夠多（atLeast）。
//   4. 比對文字或結果時兩邊都斷言：對的在，**而且最像的錯值不在**。只看「對的有出現」，
//      錯值寫在另一處時照樣綠（china_life #60：生平一處寫對、另一處寫錯，檢查是綠的）。
//   5. 可選的模組用 importOrNull：檔案還不存在才是「尚未實作」，檔案在但載不起來是紅。

export const R = { pass: [], fail: [], todo: [] };
let group = '';

export function section(name){ group = name; }

export function check(name, fn){
  const label = group ? group + ' · ' + name : name;
  try {
    const r = fn();
    // 'TODO' 或 'TODO: 還缺什麼'。帶得動訊息：一句沒有說出「什麼還沒做」的「尚未實作」，
    // 只夠告訴你有一格是空的，不夠告訴你要去做什麼。
    if (r === 'TODO' || (typeof r === 'string' && r.slice(0, 5) === 'TODO:')){
      R.todo.push({ label, msg: r === 'TODO' ? '尚未實作' : r.slice(5).trim() });
      return;
    }
    if (r === true || r === undefined){ R.pass.push({ label }); return; }
    if (r && r.pass === true){ R.pass.push({ label, msg: r.msg }); return; }
    R.fail.push({ label, msg: String(r) });
  } catch (e){
    R.fail.push({ label, msg: (e && e.message) || String(e) });
  }
}

// 斷言小工具。訊息一律帶「實際值」，不然紅了還要再跑一次才知道發生什麼。
export function eq(actual, expect, what){
  if (actual !== expect) return `${what}: 期望 ${JSON.stringify(expect)}，實際 ${JSON.stringify(actual)}`;
  return true;
}
export function near(actual, expect, tol, what){
  if (Math.abs(actual - expect) > tol) return `${what}: 期望 ${expect}±${tol}，實際 ${actual}`;
  return true;
}
// 通過的時候也把訊息帶回去（不是 `cond ? true : msg`——那會把綠色那一列的數字丟掉）。
export function ok(cond, msg){ return cond ? { pass: true, msg } : msg; }

// 母體非空：任何「必須沒有 X」的檢查都要先過這一關。
export function nonEmpty(n, what){
  if (!(n > 0)) return `母體是空的，這條 guard 從來沒有試過：${what}`;
  return true;
}

// 母體夠大：2/1200 也是「非空」，卻分不出對錯兩種實作（china_life #60：搬過家的人生只有 2 條，
// 「生年誤用卒地」那種錯整套綠）。要的是「能分辨的案例」的數量，不是母體的數量。
export function atLeast(n, min, what){
  if (!(n >= min)) return `母體太小：${what} 只有 ${n}（要 ≥ ${min}）`;
  return true;
}

// 可選的模組：檔案還不存在 → null（交給 check 回 TODO）；檔案在但載不起來（語法錯、執行期錯）→ 丟出去，check 紅。
// 不要寫 import(...).catch(() => null)：那會把「壞了」報成「還沒做」，整個套件 exit 0，而那個壞檔照樣部署
// （china_life #57：資料檔變成語法錯誤，驗收回報 TODO「尚未產生」）。
export async function importOrNull(path){
  try { return await import(path); }
  catch (e){
    const m = String((e && (e.code || '')) + ' ' + (e && e.message));
    if (/ERR_MODULE_NOT_FOUND|Cannot find module|Failed to fetch|error loading dynamically imported module|Importing a module script failed/i.test(m)) return null;
    throw e;
  }
}

// 可重現的亂數：證偽要能重放。
export function withSeed(seed, fn){
  const orig = Math.random;
  let x = seed >>> 0;
  Math.random = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  try { return fn(); } finally { Math.random = orig; }
}

export function summary(){
  return { pass: R.pass.length, fail: R.fail.length, todo: R.todo.length,
           failures: R.fail, todos: R.todo };
}
