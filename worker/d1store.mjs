// worker/d1store.mjs — D1 版的計數 store（正式環境）。BE 所有（issue #4）。
//
// 表：migrations/0001_counters.sql 的 counters(key TEXT PRIMARY KEY, n INTEGER NOT NULL)。
// 介面跟 worker/memstore.mjs 一樣（少了 keys()，那只給測試用）：
//   incr(key, n=1)              一句 upsert，原子
//   incrMany([[key, n], ...])   D1 batch：一個交易，全部成功或全部不算
//   get(key) → number           沒有的鍵是 0
//   getMany(keys) → { key: n }  分批 IN (...)，每批 ≤ 90 個參數（D1 一句最多 100 個綁定參數）

const UPSERT = 'INSERT INTO counters (key, n) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET n = n + excluded.n';
const CHUNK = 90;

export function d1Store(db){
  const upsert = (key, n) => db.prepare(UPSERT).bind(key, n);
  return {
    async incr(key, n = 1){ await upsert(key, n).run(); },
    async incrMany(entries){
      if (entries.length) await db.batch(entries.map(([k, n]) => upsert(k, n)));
    },
    async get(key){
      const row = await db.prepare('SELECT n FROM counters WHERE key = ?1').bind(key).first();
      return row ? Number(row.n) : 0;
    },
    async getMany(keys){
      const out = Object.fromEntries(keys.map(k => [k, 0]));
      for (let i = 0; i < keys.length; i += CHUNK){
        const part = keys.slice(i, i + CHUNK);
        const sql = `SELECT key, n FROM counters WHERE key IN (${part.map((_, j) => '?' + (j + 1)).join(', ')})`;
        const { results } = await db.prepare(sql).bind(...part).all();
        for (const r of results) out[r.key] = Number(r.n);
      }
      return out;
    },
  };
}
