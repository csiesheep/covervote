# Guard 證偽紀錄

每一條 guard 第一次進 main 時，在產品上（不是 fixture 上）一次注入一個缺陷，看它紅、讀它紅的理由，再還原。
改過 guard 之後要重跑證偽，舊紀錄不再算數。

## G1 開票前 payload 不含答案（`tests/acc_payload.mjs`）

2026-10-21，Phase 0 起手的 session，在 `b0de6af` 上，用 `bash tools/orch.sh falsify` 注入、`orch restore` 還原，
每次只注入一個缺陷。基準：`{"pass":8,"fail":0,"todo":0}`，exit 0。

| # | 注入的缺陷（產品檔） | 結果 | 紅的理由（節錄） |
|---|---|---|---|
| 1 | `tools/build_public.mjs`：`.map(p => pick(p, PUBLIC_PASSAGE_FIELDS))` → `.map(p => ({ ...p }))`（整段資料上前端） | 5/3/0，exit 1 | 多出欄位 `p-0001.candidateId`、`original`、`sourceUrl`…；含候選人 id `c-test-a`、姓名「測試甲」；含 `p-0001` 的 original 與 sourceUrl |
| 2 | 同一行改成 `masked: p.original`（遮蔽前的原文上前端，欄位名稱正確） | 5/3/0，exit 1 | `p-0001: masked 不同`；含候選人姓名「測試甲」「試甲」；含 `p-0001` 的 original |
| 3 | `data/schema.mjs`：`PUBLIC_PASSAGE_FIELDS` 加上 `'candidateId'`（產品端放行） | 6/2/0，exit 1 | 多出欄位 `p-0001.candidateId`、`p-0002.candidateId`；含候選人 id `c-test-a`、`c-test-b` |
| 4 | `tools/build_public.mjs`：filter 改成永遠不成立（build 吐出空的 payload） | 6/2/0，exit 1 | `p-0001: 不在 payload 裡`；`母體是空的，這條 guard 從來沒有試過：payload 裡一段都沒有` |

還原後 `orch clean` 綠，`{"pass":8,"fail":0,"todo":0}`。

缺陷 2 是最像的錯實作：欄位名稱全對、只是放錯內容，只查欄位的 guard 會放過它；它紅在「姓名」與「原文」兩條。
缺陷 3 證明允許欄位清單寫死在 guard 裡是對的：產品端放行，guard 不跟著放行。

寫 guard 時自己踩到一次的洞（`[nonempty-population]`）：第一版「找不到姓名」「找不到原文」兩條在 build 失敗、
一個 payload 檔都沒有時是**綠的**（「0 檔 × 2 位候選人，id 與姓名都不在」）。補上「至少一個 payload 檔」與
「至少一段 original ≠ masked」兩個母體斷言後才 commit。

已知沒有守到的：段落文字裡的**間接**線索（候選人的政黨名、現任者語氣、具體建設名）。那是 plan 第三節猜中率
迴圈的工作，不是這條 guard 能查的。
