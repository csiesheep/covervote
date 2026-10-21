// worker/memstore.mjs — 記憶體版的計數 store（測試與本機用）。BE 所有。
//
// 介面跟 worker/d1store.mjs 一樣：incr(key, n=1)、get(key) → number；另外：
//   incrMany([[key, n], ...])   一次加好幾個（D1 版用 batch，一個交易）
//   getMany(keys) → { key: n }  一次讀好幾個（沒有的鍵是 0）
//   keys() → string[]           只有 memStore 有，測試掃鍵用
// 鍵只能是匯總鍵（段落、選區、verdict），值只能是整數；這裡不收任何別的東西。

export function memStore(){
  const m = new Map();
  const add = (key, n) => {
    if (typeof key !== 'string' || !Number.isInteger(n)) throw new TypeError('memStore: key 要是字串、n 要是整數');
    m.set(key, (m.get(key) || 0) + n);
  };
  return {
    async incr(key, n = 1){ add(key, n); },
    async incrMany(entries){ for (const [k, n] of entries) add(k, n); },
    async get(key){ return m.get(key) || 0; },
    async getMany(keys){ return Object.fromEntries(keys.map(k => [k, m.get(k) || 0])); },
    keys(){ return [...m.keys()]; },
  };
}
