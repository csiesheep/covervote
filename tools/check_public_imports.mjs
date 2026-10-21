// tools/check_public_imports.mjs — 部署前檢查：要上傳的那棵樹裡，每個相對 import 都解析得到。orchestrator 所有。
// 用法：node tools/check_public_imports.mjs [public]（在部署指令裡排在上傳之前：build && 這個 && 上傳）。
// 由來（china_life #58，2026-10-17）：build 腳本用白名單把資料夾複製進 public/，新的 data/geo/ 沒在名單上；
// 頁面 import 它 → 線上 404 → 整頁的模組載不起來。所有驗收都在 repo 根目錄跑，看不到 public/ 少了什麼。
// 測過的樹不是部署的樹：只要部署會「挑檔」（白名單、打包、搬目錄），就要對挑出來的那棵樹再查一次。
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const ROOT = resolve(process.argv[2] || 'public');
if (!existsSync(ROOT)) { console.error(`${ROOT} 不存在：先 build`); process.exit(2); }
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(m?js|html)$/.test(f)) files.push(p); } })(ROOT);
const RE = [
  /\bimport\s+(?:[^'"]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]/g,
  /\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
  /\bexport\s+[^'"]*?\sfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g,
  /<script[^>]+src=["'](\.?\/?[^"':]+\.m?js)["']/g,
];
const missing = [];
for (const f of files) {
  const t = readFileSync(f, 'utf8');
  for (const re of RE) for (const m of t.matchAll(re)) {
    const target = resolve(dirname(f), m[1].split('?')[0]);
    if (!target.startsWith(ROOT)) { missing.push(`${relative(ROOT, f)} → ${m[1]}（在 ${relative(process.cwd(), ROOT) || '.'} 外）`); continue; }
    if (!existsSync(target)) missing.push(`${relative(ROOT, f)} → ${m[1]}`);
  }
}
if (missing.length) { console.error(`${missing.length} 個相對 import 解析不到：\n  ` + missing.slice(0, 20).join('\n  ')); process.exit(1); }
console.log(`${files.length} 個檔，相對 import 都解析得到`);
