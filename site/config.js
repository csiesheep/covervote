// site/config.js — 選舉常數與首頁方格地圖。FE 所有。
// race id = <electionId>.<office>.<district>（TEAM.md）；這裡是整個前端唯一寫著選舉 id 的地方。
export const ELECTION_ID = '2026-local';
export const OFFICE = 'mayor';
export const raceIdOf = key => `${ELECTION_ID}.${OFFICE}.${key}`;

// 方格示意圖（6 欄 × 9 列），位置照設計稿 A1。live = 本次收錄（六都）。
export const TILES = [
  { key: 'lienchiang', area: '2/1' },
  { key: 'taipei', area: '1/5', live: true },
  { key: 'keelung', area: '1/6' },
  { key: 'taoyuan', area: '2/4', live: true },
  { key: 'newtaipei', area: '2/5', live: true },
  { key: 'hsinchucity', area: '3/3' },
  { key: 'hsinchu', area: '3/4' },
  { key: 'yilan', area: '3/5' },
  { key: 'miaoli', area: '4/3' },
  { key: 'taichung', area: '4/4', live: true },
  { key: 'hualien', area: '4/5/6/6' },
  { key: 'kinmen', area: '5/1' },
  { key: 'changhua', area: '5/3' },
  { key: 'nantou', area: '5/4' },
  { key: 'yunlin', area: '6/3' },
  { key: 'chiayicounty', area: '6/4' },
  { key: 'taitung', area: '6/5/8/6' },
  { key: 'penghu', area: '7/2' },
  { key: 'chiayicity', area: '7/3' },
  { key: 'tainan', area: '7/4', live: true },
  { key: 'kaohsiung', area: '8/4', live: true },
  { key: 'pingtung', area: '9/4' },
];
export const LIVE_KEYS = TILES.filter(t => t.live).map(t => t.key);
export const CEC_URL = 'https://www.cec.gov.tw/';
