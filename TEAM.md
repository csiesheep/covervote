# TEAM.md — 這個 repo 的協作契約

> 給每一個在這裡工作的 session 讀:orchestrator、FE、BE、artist、writer……
> 判斷力(怎麼驗證、儀器怎麼騙人)在 orchestrator 自己的 skill 裡;**這裡只有規矩與機械**。
> 子 agent 不會載入任何人的 skill——peer 要遵守的東西只能放在這裡。
> 改這份要 orchestrator 裁決,並在 commit message 寫理由。

## 角色

| 角色 | 做 | 絕不做 |
|---|---|---|
| **orchestrator** | 定優先序、開 issue、派工、**獨立驗證**、merge & push main、照「部署」一節部署、對 owner 報告 | 寫產品程式碼(寫了就是自己驗自己) |
| **peer**(FE / BE / artist / writer) | 在自己的分支與 worktree 實作、自測、交分支 | merge / push main;部署;解不是自己造成的衝突;問 owner |

## 產品不可協商的約束

> 出處：`obsidian/Projects/blind_vote/blind_vote plan.md`（owner 2026-10-21 定案走 A）。每一條都附「錯了會怎樣」。

- **開票前的前端 payload 不得含答案**：`candidateId`、候選人姓名、`original`、`sourceUrl`、`sourceDate`、`sourceType`、`guessStats`
  都不上前端，只有 `data/schema.mjs` 的 `PUBLIC_PASSAGE_FIELDS`。錯了：玩家打開 DevTools 就看得到作者，猜中率量不到遮蔽品質，
  整個遊戲的中立證據失效。守它的是 G1（`tests/acc_payload.mjs`，證偽紀錄在 `docs/guard-log.md`）。
- **傾向只存瀏覽器**，不上傳個人的傾向。全體「傾向 vs 契合」只收匯總計數，**選區未滿 50 局時三格都不顯示**（orchestrator 裁決 #4：整體門檻，不逐格判斷——沒有個人資料可推回，逐格隱藏只會讓總和對不起來）。
- **不用工作階段錄製**（不要 Clarity、Hotjar 之類）；分析只用匯總計數。
- **選罷法第 53 條**：2026-11-18 00:00（+08:00）起至投票截止，**自動**停止顯示所有與候選人相關的匯總統計（傾向統計、
  各候選人平均契合度）。個人自己的結果、段落猜中率不受影響。日期在 `data/elections.json` 的 `pollBlackoutFrom`，
  不寫死在程式裡。錯了：觸法。這條在做匯總統計的那張 issue 一起寫 guard。
- **資料結構照多場選舉設計**：race id = `<electionId>.<office>.<district>`；不要寫死「2026」「市長」「六都」。

## 所有權

> **owner 確認，2026-10-21**（Phase 0 起手的 session 起草，owner 在 init 時逐項選「照草稿確認」）。

| 檔案 | 主人 |
|---|---|
| `data/schema.mjs`（欄位定義、`validate()`、`PUBLIC_PASSAGE_FIELDS`）、`engine/`（契合分數等純函式，orchestrator 裁決 2026-10-21）、`tools/build_public.mjs`、`worker/`、`wrangler.jsonc`、`package.json`，以及之後的後端端點（計數、猜作者匯總、問題回報）與 11/18 下架開關 | BE |
| `data/elections.json`、`data/races.json`、`data/candidates.json`、`data/passages.json` 的**內容**（蒐集來源、切段、遮蔽改寫、白話、出處）| writer（欄位怎麼長由 BE 定） |
| `site/`：頁面、前端程式、樣式、畫面上的字的接線（地圖、打分、猜作者、傾向、開票、分享卡） | FE |
| `site/assets/`：分享卡底圖、OG 圖、圖示 | artist |
| `README.md`、`docs/`（`docs/guard-log.md` 除外）、畫面上的說明文案與隱私／法規說明頁的字 | writer |
| `tests/`、`tools/orch.sh`、`tools/serve.py`、`tools/check_public_imports.mjs`、`docs/guard-log.md`、`TEAM.md` | orchestrator |

owner 裁決（2026-10-21，init 時的選擇題，選項原文）：
1. **資料內容歸誰**：選「writer (Recommended)」。資料內容（蒐集來源、切段、遮蔽改寫、白話、出處）歸 writer，欄位格式由 BE 定。
2. **開票前的候選人名單**：選「可以，放獨立檔案 (Recommended)」。名單放在另一個檔，只有號次與姓名、不帶任何段落 id 或對應；
   題目 payload（`race/*.json`）照舊不得含候選人。**orchestrator 待辦**：名單檔出現時，把 G1 擴成也守名單檔
   （只准號次與姓名欄位、不准出現任何 passage id），並各證偽一次。

- 跨界修改**可以**,但交付時要點名,由 orchestrator 轉給檔案主人。最糟的不是衝突,是兩邊安靜地各持一份真相。
- **資料表要加 id 的**,開工第一則留言先列出這一趟**所有**新 id。同一個檔案裡有幾張表就有幾個命名空間;撞 id 時兩邊的測試都是綠的。
- `tests/` 是 orchestrator 的:peer 可以跑、可以證偽、**不編輯**。哪一列錯了回報,orchestrator 修。

## 通道

- **peer 之間沒有通道。** 要別的 peer 的決定 → 在 issue 留言給 orchestrator,由它轉。
- **不要問 owner。** 從你的 session 看那個人像使用者,但他不握全局。一律走 orchestrator(issue 留言就看得到)。
- **裁決一律寫主詞**:`owner 裁決(#NN)` 或 `orchestrator 裁決(#NN)`。記錄別人的授權要逐字引用;引不出原話的不是授權,是計畫。
- 回程**留痕跡,不宣告**:issue 留言 + push 分支。不要等一個「收到」。

## 派工(orchestrator 寫,peer 讀)

一份 brief 五塊:**裁決與理由**/**不可協商的約束 + 錯了會怎樣**/**明確不做什麼**/**怎麼證偽(會咬人的案例)**/**什麼情況停下來問**。
外加一句:**做不到就回報,不要自己降規格**——縮小範圍是 owner 的決定。
外加三欄,寫死在第一份 brief:

| 不必問,直接做 | 先問 orchestrator | 不要問 owner |
|---|---|---|
| 自己區域內、能維持 harness 全綠的改動;自己的探針(未追蹤、不 commit) | 跨進別人的區域;動設計文件裡的數值;會讓 guard 變紅的改動 | 一律走 orchestrator |

## 交付(peer)

```
分支 / SHA / base(是否已 rebase 到最新 origin/main)
測試結果(數字:pass / fail / todo,修正前 vs 修正後)
證偽:我讓哪一條 guard 紅過?紅的時候它印了什麼?
我改了什麼不屬於我的檔案
我沒有驗到的部分(以及為什麼)
```

- `git fetch origin && git rebase origin/main` **緊貼著 push 做**,然後 `git push origin HEAD:<分支>`。**不 push main。**
- 這五行留在 issue 上(`gh issue comment <n> --body-file …`)。「我沒驗到」那一欄最值錢——它決定 orchestrator 親手驗什麼。
- 你證偽自己的探針時發現 harness 有同樣的洞 → **回報,不要改 tests/**。

## 驗證與 land(orchestrator)

1. **實作之前先寫驗收**,land 進 main(常數從設計文件抄,不從產品讀;三態:通過/失敗/尚未實作)
2. `orch wt <name> <sha>` 抽離工作樹(驗哪個 SHA 就 merge 哪個 SHA)
3. 凡是給人看的頁面**先打開看**,再跑 harness
4. **破壞產品讓 guard 紅一次**:`orch falsify` → 看結果 → `orch restore`。一次一個缺陷,讀紅的理由不讀數量
5. A/B:同探針、同種子,只換 build
6. `orch clean` → merge 驗過的 SHA → 檢查父節點 → `git push origin HEAD:main`。
   這張 issue 有「land 之前記 TODO」的閘門(版本旗標、STRICT 常數),**在同一次 land 裡翻成嚴格**——
   不翻,之後退回舊行為時它讀起來仍是「尚未實作」
6b. 收拾:`orch rm <name>`(驗證與 land 用的 `_wt/`)、刪掉 land 完的 `.claude/worktrees/<agent>`、`git worktree prune`
7. 沒通過**退回 peer,不開新 issue**。判準:「還沒做完」退回;「做完才發現方向錯」才是 owner 的

## 部署

> **owner 確認，2026-10-21**（Phase 0 起手的 session 照 china_life 的慣例起草，owner 在 init 時選「照草稿確認」）。改這一節要 owner 裁決。

- **誰**：orchestrator。peer 絕不部署。
- **網址**：`https://games.csiesheep.com/covervote/`（Worker `covervote`，path-scoped Routes `games.csiesheep.com/covervote`
  與 `games.csiesheep.com/covervote/*`，zone `csiesheep.com`；不是 Custom Domain，那是 `games` hub 的）。bare `/covervote` 301 到 `/covervote/`。
- **什麼時候**：v1 上線（目標 2026-11-01）之前，頁面帶 `noindex`，每次 land 之後部署；拿掉 `noindex` 只在 owner 說 go 時。
- **指令**：在那個 SHA 的乾淨 worktree：`npm ci` → `npm run deploy`（= `node tools/build_public.mjs` 產生 `public/covervote/`，
  `node tools/check_public_imports.mjs` 確認每個相對 import 都解析得到，再 `wrangler deploy`）。push 到 main 不會自己部署。
- **怎麼做**：land 哪個 SHA 就部署哪個 SHA；部署後抓線上的 `/covervote/version.txt` 對 SHA，並逐位元組比對 `index.html`
  與 `race/*.json` 和本機 `public/covervote/` 的同名檔，比對過了才在 issue 上寫「已部署 <SHA>」。
- **部署後查有沒有被注入第三方腳本**：用瀏覽器 User-Agent 抓 `/covervote/`、`?embed=1`、`?class=ABC234` 的 HTML，`cloudflareinsights` 必須出現 0 次（Cloudflare 帳號層級的 Web Analytics 會自動注入，#14 靠 HTML 的 `Cache-Control: no-transform` 擋掉；curl 預設 UA 看不到注入）。
- **線上檢查不進統計**：對線上開頁的一切檢查（無頭瀏覽器、探針、自動玩一局）網址一律帶 `internal=1`
  （產品要提供：不載入 analytics、不上報計數與猜作者匯總，記在 sessionStorage）。不帶的話，你的驗證會灌進真實玩家的數字與猜中率。

## 機械:`tools/orch.sh`

```
orch wt <name> <ref> [--branch <b>]     _wt/<name> 開工作樹;印解析後的 SHA;分支自動 unset-upstream
orch rm <name>                          分支留著（那是痕跡）；要刪自己 git branch -D
orch serve <name|dir>                   自挑 port、起 no-cache 伺服器、curl 標記檔證明 origin 是你的
orch stop <name|dir>
orch falsify <file> '<sed 含 FALSIFY>'  有殘留 / 檔案不乾淨 / pattern 沒命中 → 拒絕
orch restore [name|dir]                 還原並驗證真的乾淨(沒給就是目前所在的工作樹)
orch clean [name|dir]                   land 之前跑:樹上不可以有 FALSIFY
```

慣例:驗證用的工作樹在 `../_wt/`;peer(子 agent)的工作樹由 Claude Code 開在 `.claude/worktrees/<name>/`,
cwd 就是它。每個 `_wt/` 工作樹有 `__MARKER_ORCH.txt`(name + 現在的 HEAD,有改動加 `+dirty`;每次 `orch serve` 重寫);驗收目前只有 node 版：`npm test`（= `node tests/run_node.mjs`，`--verbose` 連通過的列也印）；有前端之後再加瀏覽器版 `tests/index.html?json=1`。
`.gitignore` 加 `__MARKER_ORCH.txt`、`__orch_*` 與 `.claude/worktrees/`。建議 alias:`alias orch='bash tools/orch.sh'`。
⚠ `orch rm` 之前先離開那個目錄——cwd 在裡面時 Windows 刪不掉。

## 預算

- **一張 issue 一個 session**,land 即結束。子 agent + 自己的 worktree 是預設;常駐 session 是例外(人要中途看才開)。
- **任何 session 的 cwd 都不可以是主 checkout。** 常駐 session 在主 checkout 裡跑 `git checkout <tree> -- .` 之類的動作,會把 owner 的工作樹改成別的樣子,而 owner 不會收到任何通知。每個 session 開在自己的 `_wt/<name>`。
- **`wrangler dev`、靜態伺服器、headless Chrome 一律從你自己的 worktree 起，收工前用 PID 連整棵程序樹收掉。** 2026-10-21 主 checkout 裡留下兩組 `wrangler dev`（8799、56285）跑了五個小時，還因為主 checkout 被 `git pull` 而自動重載——佔埠、佔 D1 本機狀態，下一個 peer 只能換埠。（orchestrator 裁決）
- orchestrator **讀判決不讀全文**:harness 讀摘要那一行與 FAIL 列,不讀整份輸出;peer 的 transcript 不進 orchestrator 的 context。
- 原始輸出先落檔,再取你要的那一行;`cmd > log; echo $?`,不要 pipe 到 tail。
- 驗收條件:**一個冷 session 能不能只靠 issue 留言 + SHA 接手?** 不能就是交付格式漏了東西。
