// tests/acc_schema.mjs — data/ 照 data/schema.mjs 的欄位定義。orchestrator 所有。
import { section, check, ok } from './harness.js';
import { validate } from '../data/schema.mjs';
import { loadData } from '../tools/build_public.mjs';

const data = loadData();

section('資料結構');

check('data/ 通過 validate()', () => {
  const errs = validate(data);
  return errs.length ? errs.slice(0, 8).join('；')
    : ok(true, `${data.elections.length} 場選舉、${data.races.length} 個選區、${data.candidates.length} 位候選人、${data.passages.length} 段`);
});

// validate() 自己也要能紅：拿一段真資料，各弄壞一個地方，每一種都要被抓到。
check('validate() 抓得到缺欄位、壞 race、壞候選人、長度不符', () => {
  const p = data.passages[0];
  if (!p) return '母體是空的：data/passages.json 沒有段落';
  const { candidateId, ...noCand } = p;
  const cases = {
    '缺 candidateId': noCand,
    'race 不存在': { ...p, race: 'nope.mayor.x' },
    'candidateId 不存在': { ...p, candidateId: 'c-nope' },
    'length 不符': { ...p, length: p.length + 1 },
  };
  const missed = Object.entries(cases)
    .filter(([, bad]) => validate({ ...data, passages: [bad] }).length === 0).map(([k]) => k);
  return missed.length ? `沒抓到：${missed.join('、')}` : ok(true, `${Object.keys(cases).length} 種壞資料都被抓到`);
});

// #6：選舉的 pollBlackoutFrom 必填、是帶時區的 ISO 時間、早於投票日。缺了後端會 fail closed（整段禁止期），
// 但那是安全網，不是規格——資料錯了要在 validate 就紅。STRICT_6S 在 #6 land 時翻。
const STRICT_6S = false;
check('validate() 抓得到缺 pollBlackoutFrom、格式錯、晚於投票日', () => {
  const e = data.elections[0];
  if (!e) return '母體是空的：沒有選舉';
  const { pollBlackoutFrom, ...noBO } = e;
  const bad = {
    '缺 pollBlackoutFrom': { ...data, elections: [noBO] },
    '沒有時區': { ...data, elections: [{ ...e, pollBlackoutFrom: '2026-11-18T00:00:00' }] },
    '晚於投票日': { ...data, elections: [{ ...e, pollBlackoutFrom: '2026-11-29T00:00:00+08:00' }] },
  };
  const missed = Object.entries(bad).filter(([, d]) => validate(d).length === 0).map(([k]) => k);
  if (missed.length) return (STRICT_6S ? '' : 'TODO: ') + `沒抓到：${missed.join('、')}`;
  return ok(true, `${Object.keys(bad).length} 種壞 pollBlackoutFrom 都被抓到`);
});

// #1 加的規則（orchestrator 裁決：姓名是前端的鍵；號次抽籤前 null；議題顯示名只有一份）。
// 每一種壞資料都要被抓到，而且合法的變化（number null、正整數號次）不能被誤抓。
check('validate() 抓得到號次、姓名重複、議題表的錯，且不誤抓合法號次', () => {
  // 每個壞案例只改一個地方、其他照原樣：只要基準資料本身合法，「有錯」就只能是這一處造成的。
  const base = validate(data);
  if (base.length) return `基準資料本身不合法，下面的案例分不出是誰造成的：${base[0]}`;
  const c = data.candidates[0], p = data.passages[0];
  if (!c || !p) return '母體是空的：沒有候選人或段落';
  const twin = { ...c, id: c.id + '-twin', name: c.name + '甲', number: null };
  const withCand = (fn) => ({ ...data, candidates: data.candidates.map((x, i) => i === 0 ? fn(x) : x) });
  const bad = {
    '缺 number': withCand(({ number, ...rest }) => rest),
    'number 1.5': withCand(x => ({ ...x, number: 1.5 })),
    'number "1"': withCand(x => ({ ...x, number: '1' })),
    'number 0': withCand(x => ({ ...x, number: 0 })),
    '同選區號次重複': { ...data, candidates: [...data.candidates.map((x, i) => i === 0 ? { ...x, number: 1 } : x), { ...twin, number: 1 }] },
    '同選區姓名重複': { ...data, candidates: [...data.candidates, { ...twin, name: c.name }] },
    'issueId 不在議題表': { ...data, passages: data.passages.map((x, i) => i === 0 ? { ...x, issueId: 'no-such-issue' } : x) },
    '議題表 id 重複': { ...data, issues: [...data.issues, data.issues[0]] },
    '議題沒有 label': { ...data, issues: [{ ...data.issues[0], label: '' }, ...data.issues.slice(1)] },
  };
  const missed = Object.entries(bad).filter(([, d]) => validate(d).length === 0).map(([k]) => k);
  const good = { ...data, candidates: data.candidates.map((x, i) => ({ ...x, number: i + 1 })) };
  const falsePos = validate(good);
  if (missed.length) return `沒抓到：${missed.join('、')}`;
  if (falsePos.length) return `合法的正整數號次被誤抓：${falsePos.slice(0, 3).join('；')}`;
  return ok(true, `${Object.keys(bad).length} 種壞資料都被抓到，合法號次沒被誤抓`);
});
