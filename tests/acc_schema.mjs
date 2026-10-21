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
