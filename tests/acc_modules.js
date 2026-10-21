// tests/acc_modules.js — 出貨的模組都載得起來（node 跑：node tests/acc_modules.js）。orchestrator 所有。
// 由來（china_life #57）：一個資料模組變成語法錯誤，各組驗收用「可選 import」把它當成「還沒做」，
// 套件 exit 0，壞檔照樣部署、整頁的模組載不起來。這一組不分哪張 issue：檔案在，就要 import 得起來。
// 把 SHIP 改成你的專案出貨、而且在 node 裡能載的資料夾；載入時就碰 DOM 的放進 SKIP，由瀏覽器驗收把關
// （頁面起不來，開頁那一組就紅）。
import { section, check, ok, summary } from './harness.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SHIP = ['data', 'worker'];
const SKIP = [];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const walk = rel => {
  const d = path.join(ROOT, rel); if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).flatMap(f => { const r = rel + '/' + f; return fs.statSync(path.join(ROOT, r)).isDirectory() ? walk(r) : /\.m?js$/.test(f) ? [r] : []; });
};
const files = SHIP.flatMap(walk).filter(f => !SKIP.some(re => re.test(f)));
const bad = [];
for (const f of files) {
  try { await import(pathToFileURL(path.join(ROOT, f)).href); }
  catch (e) { bad.push(`${f}：${(e && (e.name + ': ' + e.message)) || e}`.slice(0, 200)); }
}

section('出貨的模組都載得起來');
check('每個出貨模組都 import 得起來（載入失敗＝紅，不是 TODO）', () => {
  if (!files.length) return `母體是空的：SHIP ${SHIP.join('、')} 底下找不到 .js——SHIP 寫對了嗎？`;
  return bad.length ? `${bad.length} 個載入失敗：` + bad.slice(0, 6).join('；') : ok(true, `${files.length} 個模組都載得起來`);
});

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const s = summary(); console.log(JSON.stringify({ pass: s.pass, fail: s.fail, todo: s.todo }));
  for (const f of s.failures) console.log('FAIL  ' + f.label + '\n      ' + f.msg);
  process.exit(s.fail ? 1 : 0);
}
