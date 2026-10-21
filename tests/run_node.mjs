// tests/run_node.mjs — 跑全部驗收，印摘要與失敗理由。orchestrator 所有。
//   node tests/run_node.mjs            摘要 + 失敗 + 尚未實作
//   node tests/run_node.mjs --verbose  連通過的那一列也印（綠色路徑要有人看）
// 退出碼：有失敗 1，否則 0。
import './acc_schema.mjs';
import './acc_payload.mjs';
import './acc_modules.js';
import './acc_score.mjs';
import './acc_data.mjs';
import './acc_api.mjs';
import './acc_class.mjs';
import './acc_plan.mjs';
import { R, summary } from './harness.js';

const s = summary();
const verbose = process.argv.includes('--verbose');
console.log(JSON.stringify({ pass: s.pass, fail: s.fail, todo: s.todo }));
for (const f of s.failures) console.log(`FAIL  ${f.label}\n      ${f.msg}`);
for (const t of s.todos) console.log(`TODO  ${t.label}${t.msg && t.msg !== '尚未實作' ? ' — ' + t.msg : ''}`);
if (verbose) for (const p of R.pass) console.log(`PASS  ${p.label}${p.msg ? ' — ' + p.msg : ''}`);
process.exit(s.fail ? 1 : 0);
