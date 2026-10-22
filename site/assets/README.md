# site/assets：牌桌版素材（#38）

Z-Image-Turbo（ComfyUI 範本 `image_z_image_turbo`，節點 57 的 text／width／height／seed）生圖，Pillow 後製。
每張試 3 個 seed；選用的標 **選**。圖裡沒有文字、牌花、政黨標誌、人臉，也沒有藍或綠。

## card_face.webp（600×850，四角透明圓角，約 21 KB）

底圖 768×1088，prompt（三個 seed 共用）：

> Flat top-down scan of a single blank rectangular cream paper tile (#F4EFE4) with rounded corners, filling the frame. A thin charcoal double-line border inset from the edge. In each of the four corners a small charcoal geometric lattice ornament like a Taiwanese wooden window grille, all four corners identical. The whole center is empty blank cream paper. Risograph ink, slight paper grain. Monochrome charcoal on cream only. No text, no letters, no numbers, no symbols, no spades, no hearts, no suits, no blue, no green, no color lines, no characters, no seals, no writing, no faces.

| seed | 結果 |
|---|---|
| 327 | 可用，但左上角花格與其他三角不同款（不合「四角相同」） |
| 4101 | 邊框偏窄、角花格左右不對稱 |
| **8802（選）** | 四角花格一致（鏡射）、中央全空、圓角乾淨 |

後製：裁掉底圖白邊、亮度轉成墨色密度再映射到 奶油 #F4EFE4／炭黑 #2A2624（去掉模型給的色偏，保留一點紙紋）、
保證 G、B 不超過 R（只有暖色）、縮到 600×850、加 34px 圓角 alpha。政黨色由前端 CSS 疊，圖內無色。

## table_wood.webp（512×512，可無縫平鋪，約 5 KB）

底圖 1024×1024，prompt：

> Flat top-down photograph of a dark walnut wooden table surface, fine straight horizontal wood grain, very low contrast, evenly lit, uniform dark brown tone (#2B241E), matte, no knots, no highlights, no vignette, no objects, filling the frame edge to edge. No text, no characters, no seals, no writing, no faces, no blue, no green.

| seed | 結果 |
|---|---|
| 611 | 中央有大漩渦，平鋪時重複感最明顯 |
| **2207（選）** | 紋理最均勻 |
| 9035 | 左側有深色節疤，平鋪會出現規律斑點 |

後製：只取亮度，減掉大半徑（σ=60）模糊以去除暗角與大塊明暗，把細節以 ×4.0 疊回 #2B241E（紋理平均約 #2B231D、標準差約 6），
再用半幅位移疊合做成無縫（接縫帶只占邊緣 10%），縮到 512。相鄰欄的平均亮度差最大 0.27 級（接縫處不比內部大）；有規律重複的大紋理（週期 512），非逐像素無痕。

## card_back.webp（192×272，約 21 KB）

圖案不動。深色桌面（#2B241E）上，原圖外緣炭黑 #3A3430 幾乎和桌面融在一起、牌的輪廓看不出來。
只做一件事：把暗部黑點由 0 抬到 26（`out = 26 + in × 229/255`），朱紅菱形（品牌色）以紅色遮罩排除、不受影響。
外緣變為約 #4E4945（對桌面亮度比由約 1.5 升到約 2.1），輪廓清楚。原檔在 git 歷史（main 上的 card_back.webp）。

## 重做

prompt／seed／尺寸如上，同一範本同一組參數會得到同一張。後製參數寫在上面各節。
