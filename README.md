# 蓋牌投票 covervote

2026 六都市長選舉的政見盲測網頁遊戲：先選填你傾向誰，再把名字蓋起來，給每段政見打 −2～+2 分、選填猜是誰寫的；
開票時看「你傾向的人」和「你契合的人」是不是同一個。全體的猜作者猜中率，用來量測遮蔽做得好不好。

- 網址：<https://games.csiesheep.com/covervote/>（目前是佔位頁）
- 狀態：Phase 0（骨架、佔位部署、第一條 guard）。遊戲本體還沒開始寫。
- 時程：2026-11-01 v1（競選來源版）、11-15 公報版；**11-18 起依選罷法第 53 條自動停止顯示所有與候選人相關的匯總統計**。

## 隱私

- 你的傾向只存在你的瀏覽器裡，不會上傳。
- 不做工作階段錄製；只收匯總計數。

## 開發

需要 Node 20+。

```bash
npm install
npm test          # 驗收（node tests/run_node.mjs）
npm run build     # 產生 public/covervote/
npx wrangler dev  # 本機跑 Worker：http://127.0.0.1:8787/covervote/
```

部署只由 orchestrator 做，規則在 [TEAM.md](TEAM.md) 的「部署」一節。

## 資料結構

四張表在 `data/`，欄位定義與驗證在 [`data/schema.mjs`](data/schema.mjs)：

| 檔案 | 一列是 | 重點欄位 |
|---|---|---|
| `elections.json` | 一場選舉 | `id`（例 `2026-local`）、`voteDate`、`pollBlackoutFrom` |
| `races.json` | 一個選區 | `id` = `<electionId>.<office>.<district>`（例 `2026-local.mayor.taipei`） |
| `candidates.json` | 一位候選人 | `id`、`raceId`、`name` |
| `passages.json` | 一段政見 | `id, race, issueId, candidateId, original, masked, plain, sourceUrl, sourceDate, sourceType, length, guessStats` |

race id 帶著選舉與職位，所以 2028 總統、立委或補選都只是多加幾列。現在只有兩段假資料（候選人「測試甲」「測試乙」）。

build 為每個選區寫一個 `public/covervote/race/<raceId>.json`，只含 `id, issueId, masked, plain, length`。
誰寫的、原文、出處都不上前端——這條由 `tests/acc_payload.mjs` 守，證偽紀錄在 [docs/guard-log.md](docs/guard-log.md)。

## 協作

這個 repo 用 agent-team-delivery 的分工（orchestrator + FE / BE / writer / artist），規矩在 [TEAM.md](TEAM.md)。
