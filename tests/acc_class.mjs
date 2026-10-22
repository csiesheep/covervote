// tests/acc_class.mjs — 課堂版：班級代碼的匯總。orchestrator 所有（issue #10）。
//
// 由來：owner 指示（2026-10-21）「持續打磨……直到有商業價值」；plan「六之二」商業價值第 2 條：課堂版——
// 老師開一個班級代碼，只看全班的匯總（不看個人），公民課討論「政見寫法能不能被認出作者」。
//
// 規格（orchestrator 裁決 #10）：
//   - 沒有帳號：班級代碼由老師的頁面在前端產生，6 碼，字元只用 A–Z 與 2–9（去掉 0、1、I、O 免得抄錯）。
//   - 學生網址帶 ?class=<code>，POST /api/play、/api/guess 的 body 多一個 `class`。格式不對的代碼：全站照計、班級不計。
//   - GET /covervote/api/class/<code>/<race> → { class, race, plays, guesses: { answers, correct }, verdicts? }
//       verdicts（same/different/none/tie）：班級局數 ≥ MIN_CLASS 且不在禁止期才有；禁止期規則與 #4 相同。
//       guesses 是全班猜作者的總答題數與答對數（媒體識讀的討論材料），禁止期照常。
//   - internal=1 不計（全站與班級都不計）。不存個人欄位。
//   - 全站的計數不受影響：帶 class 的局照樣算進 /api/stats 與 /api/health。
import { section, check, ok, eq, importOrNull } from './harness.js';
import { loadData } from '../tools/build_public.mjs';

const api = await importOrNull('../worker/api.mjs');
const mem = await importOrNull('../worker/memstore.mjs');
const data = loadData();

const MIN_CLASS = 5;
const STRICT_10 = true;   // #10 land 時翻
const BASE = 'https://games.csiesheep.com/covervote/api/';
const T_BEFORE = new Date('2026-11-10T12:00:00+08:00');
const T_IN = new Date('2026-11-20T12:00:00+08:00');
const race = data.races.find(r => data.passages.some(p => p.race === r.id))?.id;
const ps = data.passages.filter(p => p.race === race);
const name = Object.fromEntries(data.candidates.map(c => [c.id, c.name]));
const other = p => data.candidates.find(c => c.raceId === race && c.id !== p.candidateId && ps.some(q => q.candidateId === c.id))?.name;

const call = async (store, method, path, body, now = T_BEFORE, qs = '') =>
  api.handleApi(new Request(BASE + path + qs, method === 'GET' ? { method } : { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), { store, now, data });
const json = async r => { const t = await r.text(); try { return JSON.parse(t); } catch { return { _raw: t, _status: r.status }; } };

const results = {};
const run = async (k, fn) => { try { results[k] = await fn(); } catch (e){ results[k] = (e && e.message) || String(e); } };
let available = false;

if (api?.handleApi && mem?.memStore && ps.length >= 2){
  // 探測：class 端點存在嗎？不存在（404 或 null）→ 整組 TODO。
  const probe = await call(mem.memStore(), 'GET', `class/ABC234/${race}`);
  available = !!probe && probe.status === 200;

  if (available){
    await run('count', async () => {
      const s = mem.memStore(), [a] = ps;
      for (let i = 0; i < 3; i++) await call(s, 'POST', 'play', { race, verdict: 'same', class: 'ABC234' });
      await call(s, 'POST', 'play', { race, verdict: 'same' });                       // 沒帶班級
      await call(s, 'POST', 'play', { race, verdict: 'same', class: 'abc234' });     // 小寫：格式不對
      await call(s, 'POST', 'play', { race, verdict: 'same', class: 'ABC10O' });     // 含 1、0、O：格式不對
      await call(s, 'POST', 'play', { race, verdict: 'same', class: ['ABC234'] });   // 不是字串：陣列轉字串會變成合法代碼（BE #10 回報的洞）
      await call(s, 'POST', 'guess', { race, class: 'ABC234', guesses: [{ passage: a.id, name: name[a.candidateId] }, { passage: ps[1].id, name: other(ps[1]) }] });
      const c = await json(await call(s, 'GET', `class/ABC234/${race}`));
      const st = await json(await call(s, 'GET', `stats/${race}`));
      // 格式不對的代碼不得以任何形式進 store（它們用自己的鍵存，不會影響 ABC234 的數字，所以要直接看鍵）
      const badKeys = s.keys().filter(k => /abc234|ABC10O/.test(k));
      if (badKeys.length) return `格式不對的代碼被存了：${badKeys.join('、')}`;
      const errs = [eq(c.plays, 3, '班級局數（沒帶班級與格式不對的不算）'), eq(c.guesses?.answers, 2, '班級答題數'), eq(c.guesses?.correct, 1, '班級答對數'),
        eq(st.plays, 7, '全站局數（帶班級的照樣算進全站）')].filter(x => x !== true);
      return errs.length ? errs.join('；') : ok(true, `班級 3 局（陣列代碼不算）、答題 2 對 1；全站 7 局`);
    });

    await run('min', async () => {
      const s = mem.memStore();
      for (let i = 0; i < MIN_CLASS - 1; i++) await call(s, 'POST', 'play', { race, verdict: 'different', class: 'QQQ222' });
      const under = await json(await call(s, 'GET', `class/QQQ222/${race}`));
      await call(s, 'POST', 'play', { race, verdict: 'same', class: 'QQQ222' });
      const at = await json(await call(s, 'GET', `class/QQQ222/${race}`));
      if ('verdicts' in under) return `班級未滿 ${MIN_CLASS} 局不應有 verdicts：${JSON.stringify(under.verdicts)}`;
      if (!at.verdicts) return `班級滿 ${MIN_CLASS} 局應有 verdicts`;
      const errs = [eq(at.verdicts.different, 4, 'different'), eq(at.verdicts.same, 1, 'same')].filter(x => x !== true);
      return errs.length ? errs.join('；') : ok(true, `4 局沒有、5 局有：${JSON.stringify(at.verdicts)}`);
    });

    await run('blackout', async () => {
      const s = mem.memStore();
      for (let i = 0; i < 8; i++) await call(s, 'POST', 'play', { race, verdict: 'same', class: 'ZZZ999' });
      await call(s, 'POST', 'guess', { race, class: 'ZZZ999', guesses: [{ passage: ps[0].id, name: name[ps[0].candidateId] }] });
      const r = await call(s, 'GET', `class/ZZZ999/${race}`, null, T_IN); const raw = await r.text(); const j = JSON.parse(raw);
      const errs = [];
      if ('verdicts' in j || /same|different/.test(raw)) errs.push(`禁止期不得回傳 verdicts：${raw}`);
      if (j.plays !== 8) errs.push(`禁止期局數照常，應為 8，實際 ${j.plays}`);
      if (j.guesses?.answers !== 1) errs.push(`禁止期猜作者匯總照常，應為 1，實際 ${j.guesses?.answers}`);
      return errs.length ? errs.join('；') : ok(true, '禁止期：沒有 verdicts，局數與猜作者照常');
    });

    await run('internal', async () => {
      const s = mem.memStore();
      await call(s, 'POST', 'play', { race, verdict: 'same', class: 'NTR234' }, T_BEFORE, '?internal=1');
      await call(s, 'POST', 'guess', { race, class: 'NTR234', guesses: [{ passage: ps[0].id, name: name[ps[0].candidateId] }] }, T_BEFORE, '?internal=1');
      const c = await json(await call(s, 'GET', `class/NTR234/${race}`));
      const errs = [eq(c.plays, 0, 'internal=1 的班級局'), eq(c.guesses?.answers, 0, 'internal=1 的班級猜測')].filter(x => x !== true);
      return errs.length ? errs.join('；') : ok(true, 'internal=1 班級不計');
    });

    await run('badcode', async () => {
      const r = await call(mem.memStore(), 'GET', `class/abc/${race}`);
      return r && r.status === 400 ? ok(true, '格式不對的代碼 GET 回 400') : `格式不對的代碼應回 400，實際 ${r && r.status}`;
    });
  }
}

const show = k => () => {
  if (!api?.handleApi || !mem?.memStore) return 'worker/api.mjs 或 memstore 不見了';
  if (ps.length < 2) return 'TODO: 母體不足：沒有至少 2 段的選區';
  if (!available) return (STRICT_10 ? '' : 'TODO: ') + 'GET /api/class/<code>/<race> 還沒有（#10）';
  return results[k];
};
section('課堂版（#10）');
check('班級計數：只算格式正確的代碼；帶班級的局照樣算進全站', show('count'));
check(`班級未滿 ${MIN_CLASS} 局不顯示 verdicts`, show('min'));
check('禁止期：班級也不回傳 verdicts，局數與猜作者照常', show('blackout'));
check('internal=1 的班級局與猜測不計', show('internal'));
check('格式不對的代碼 GET 回 400', show('badcode'));
