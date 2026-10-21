// tools/headers_selftest.mjs — BE 自己的檢查（#14）：build 出來的 public/_headers 讓 HTML 帶 no-transform，其他檔不動。BE 所有。
//   node tools/headers_selftest.mjs     （npm run test:be）
// import 時什麼都不跑。
//
// 為什麼：Cloudflare 帳號層級的 Web Analytics 會在線上 HTML 自動插入 beacon.min.js（不在我們的程式碼裡），
// 隱私頁寫「不載入任何分析或錄製腳本」就成了假話。Cloudflare 不改寫帶 `Cache-Control: no-transform` 的回應。
// 期望值從 issue #14 的文字抄：HTML 的 Cache-Control =「現有的 public, max-age=0, must-revalidate」加 no-transform；
// 其他資源的快取行為不變（= 沒有任何 _headers 規則碰到它們，維持 Workers static assets 的預設）。
// 不從 build_public.mjs 讀規則字串；_headers 的解析與比對在這裡自己寫（Cloudflare 的格式：不縮排的行是網址樣式，
// 縮排的行是 `Name: value`，`*` 是 splat、`:name` 是一段佔位；同一個標頭被幾條規則套到就用 ", " 接起來）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WANT = ['public', 'max-age=0', 'must-revalidate', 'no-transform'];

export function parseHeaders(text){
  const rules = []; let cur = null;
  for (const raw of text.split(/\r?\n/)){
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)){ cur = { pattern: raw.trim(), headers: [] }; rules.push(cur); continue; }
    if (!cur) throw new Error(`標頭行前面沒有網址樣式：${raw}`);
    const m = raw.trim().match(/^([^:]+):\s*(.*)$/);
    if (!m) throw new Error(`看不懂的標頭行：${raw}`);
    cur.headers.push([m[1].trim().toLowerCase(), m[2].trim()]);
  }
  return rules;
}

const esc = s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
export function matches(pattern, urlPath){
  const re = '^' + pattern.split(/(\*|:[A-Za-z]\w*)/).map(t => t === '*' ? '.*' : /^:[A-Za-z]/.test(t) ? '[^/]+' : esc(t)).join('') + '$';
  return new RegExp(re).test(urlPath);
}

// 這個網址最後拿到的自訂標頭：{ name: value }，同名用 ", " 接。
export function headersFor(rules, urlPath){
  const got = {};
  for (const r of rules) if (matches(r.pattern, urlPath))
    for (const [k, v] of r.headers) got[k] = got[k] ? got[k] + ', ' + v : v;
  return got;
}

const walk = d => fs.readdirSync(d).flatMap(f => { const p = path.join(d, f); return fs.statSync(p).isDirectory() ? walk(p) : [p]; });

export async function run(){
  const { build } = await import('./build_public.mjs');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'covervote-headers-'));
  const pub = path.join(out, 'public');
  const res = [];
  const t = (name, fn) => { try { const r = fn(); res.push([r === true ? 'PASS' : 'FAIL', name, r === true ? '' : r]); } catch (e){ res.push(['FAIL', name, e.message]); } };
  try {
    build(pub);
    const site = path.join(pub, 'covervote');
    const file = path.join(pub, '_headers');
    const rules = fs.existsSync(file) ? parseHeaders(fs.readFileSync(file, 'utf8')) : null;
    const files = walk(site).map(f => '/' + path.relative(pub, f).split(path.sep).join('/'));
    const html = files.filter(f => f.endsWith('.html'));
    const other = files.filter(f => !f.endsWith('.html'));
    // auto-trailing-slash（wrangler 預設）：dir/index.html 在 dir/，x.html 在 x；.html 的網址 307 過去。兩種都查。
    const htmlUrls = html.flatMap(f => f.endsWith('/index.html') ? [f.slice(0, -'index.html'.length), f] : [f.slice(0, -'.html'.length), f]);

    t('public/_headers 存在（放在 assets 目錄的根，Cloudflare 只讀那裡）', () => rules !== null || `${file} 不存在`);
    t('/covervote/ 的 Cache-Control = public, max-age=0, must-revalidate, no-transform', () => {
      if (!rules) return '沒有 _headers';
      const cc = headersFor(rules, '/covervote/')['cache-control'];
      if (!cc) return '/covervote/ 沒有任何規則設 Cache-Control';
      const toks = cc.split(',').map(s => s.trim().toLowerCase());
      const missing = WANT.filter(w => !toks.includes(w)), extra = toks.filter(x => !WANT.includes(x));
      return (!missing.length && !extra.length) || `得到「${cc}」：缺 ${missing.join(' ') || '無'}；多 ${extra.join(' ') || '無'}`;
    });
    t('每一頁 HTML 的網址都帶 no-transform（母體＝build 出來的每個 .html）', () => {
      if (!rules) return '沒有 _headers';
      if (!html.length) return '母體是空的：build 出來沒有任何 .html';
      const bad = htmlUrls.filter(u => !/(^|,)\s*no-transform\s*(,|$)/i.test(headersFor(rules, u)['cache-control'] || ''));
      return !bad.length || `${bad.length}/${htmlUrls.length} 個網址沒有 no-transform：${bad.slice(0, 6).join('、')}`;
    });
    t('其他資源的快取行為不變：沒有任何規則碰到非 HTML 的檔（version.txt、race/、app.js…）', () => {
      if (!rules) return '沒有 _headers';
      if (!other.length || !other.includes('/covervote/version.txt')) return `母體不對：${other.length} 個非 HTML 檔，version.txt ${other.includes('/covervote/version.txt') ? '在' : '不在'}`;
      const hit = other.map(u => [u, headersFor(rules, u)]).filter(([, h]) => Object.keys(h).length);
      return !hit.length || `${hit.length} 個非 HTML 檔被套到自訂標頭：` + hit.slice(0, 4).map(([u, h]) => `${u} ${JSON.stringify(h)}`).join('；');
    });
    t('API 與 bare /covervote 不被 _headers 碰到（那是 Worker 的回應）', () => {
      if (!rules) return '沒有 _headers';
      const hit = ['/covervote', '/covervote/api/stats/x', '/covervote/api/play'].filter(u => Object.keys(headersFor(rules, u)).length);
      return !hit.length || `被套到：${hit.join('、')}`;
    });
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
  return res;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])){
  const out = await run();
  for (const [s, n, m] of out) console.log(`${s}  ${n}${m ? '\n      ' + m : ''}`);
  const fail = out.filter(x => x[0] === 'FAIL').length;
  console.log(JSON.stringify({ pass: out.length - fail, fail }));
  process.exit(fail ? 1 : 0);
}
