-- 匯總計數：猜作者（每段答題數、猜中數）、局數、「傾向 vs 契合」verdict 分佈。issue #4。
-- 鍵只由 選區 id、段落 id、verdict 組成（worker/api.mjs 的 KEY），不存任何個人欄位。
CREATE TABLE IF NOT EXISTS counters (
  key TEXT PRIMARY KEY,
  n   INTEGER NOT NULL
);
