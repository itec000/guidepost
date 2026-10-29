import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeDepth, needsRecheck, parseDateCell, recruitStatus } from '../src/lib/derive.ts';
import { validateSheet, type Cell } from '../src/lib/validate.ts';
import { COLUMNS } from '../src/lib/schema.ts';

const TODAY = '2026-10-29';
const HEADER = ['ID', '公開', 'チェック', ...Object.values(COLUMNS).filter((h) => h !== 'ID' && h !== '公開')];

/** 公開できる最小限の行。overrides で列を差し替える */
function row(overrides: Record<string, Cell> = {}): Cell[] {
  const base: Record<string, Cell> = {
    ID: 1, 公開: '公開', 種別: 'コンテスト', 名称: 'テスト', 分野タグ: '科学・研究', 対象学年: '高1, 高2',
    応募ルート: '個人で応募', 地方ブロック: '全国', 成果物: 'あり', '指導者・メンター': '不明', '1か月以上': 'あり',
    '費用・宿泊・現地参加': 'なし', 確認方法: '二次情報で確認', 出典URL: 'https://example.com/',
    最終確認日: 46323, // 2026-10-28
    ...overrides,
  };
  return HEADER.map((h) => base[h] ?? '');
}
const run = (...rows: Cell[][]) => validateSheet([HEADER, ...rows], TODAY);

test('体験の深さ', () => {
  assert.equal(judgeDepth(['あり', 'あり', 'あり']), '深入');
  assert.equal(judgeDepth(['あり', 'あり', 'なし']), '実践');
  assert.equal(judgeDepth(['あり', 'なし', 'なし']), '体験');
  assert.equal(judgeDepth(['不明', 'なし', 'なし']), '体験'); // 0〜1点でどちらも体験
  assert.equal(judgeDepth(['あり', '不明', 'なし']), '判定不能'); // 1〜2点
  assert.equal(judgeDepth(['あり', 'あり', null]), '判定不能'); // 未入力
});

test('募集状況', () => {
  assert.equal(recruitStatus('2026-10-29', null, TODAY), 'open'); // 当日は募集中
  assert.equal(recruitStatus('2026-10-28', null, TODAY), 'closed');
  assert.equal(recruitStatus(null, null, TODAY), 'unknown');
  assert.equal(recruitStatus('2027-01-01', '募集終了', TODAY), 'closed');
  assert.equal(recruitStatus(null, '随時募集', TODAY), 'rolling');
});

test('要再確認は90日を超えたら', () => {
  assert.equal(needsRecheck('2026-07-31', TODAY), false); // 90日
  assert.equal(needsRecheck('2026-07-30', TODAY), true); // 91日
  assert.equal(needsRecheck(null, TODAY), true);
});

test('日付セル', () => {
  assert.equal(parseDateCell(46323), '2026-10-28');
  assert.equal(parseDateCell('2026/1/5'), '2026-01-05');
  assert.equal(parseDateCell(''), null);
  assert.equal(parseDateCell('2026-02-30'), undefined);
  assert.equal(parseDateCell('要確認'), undefined);
});

test('問題のない行は掲載され、公開しない列は出力に含まれない', () => {
  const r = run(row({ 内部メモ: '秘密' }));
  assert.equal(r.programs.length, 1);
  assert.deepEqual(r.programs[0]!.grades, ['高1', '高2']);
  assert.equal(r.programs[0]!.depth, '判定不能');
  assert.ok(!JSON.stringify(r.programs).includes('秘密'));
  assert.deepEqual(r.issues, []);
});

test('非公開の行は検証もしない', () => {
  const r = run(row({ 公開: '非公開', 確認方法: '未確認' }));
  assert.equal(r.programs.length, 0);
  assert.deepEqual(r.issues, []);
});

test('公開基準を満たさない行だけ外れる', () => {
  const r = run(row(), row({ ID: 2, '費用・宿泊・現地参加': 'あり' }), row({ ID: 3, 確認方法: '' }));
  assert.deepEqual(r.programs.map((p) => p.id), [1]);
  assert.equal(r.counts.skipped, 2);
  assert.ok(r.issues.every((i) => i.level === 'error'));
});

test('公式確認なら費用等ありでも公開できる', () => {
  const r = run(row({ '費用・宿泊・現地参加': 'あり', 確認方法: '公式で確認' }));
  assert.equal(r.programs.length, 1);
});

test('選択肢にない値は、その行だけ外れて場所が分かる', () => {
  const r = run(row({ 分野タグ: '科学・研究、宇宙' }));
  assert.equal(r.programs.length, 0);
  assert.equal(r.issues[0]!.row, 2);
  assert.match(r.issues[0]!.column!, /分野タグ.*G列/);
  assert.match(r.issues[0]!.message, /宇宙/);
});

test('ID の重複は非公開の行とも比べる', () => {
  const r = run(row(), row({ 公開: '非公開' }));
  assert.equal(r.programs.length, 0);
  assert.match(r.issues[0]!.message, /2・3行目/);
});

test('最終確認日が古い・未入力の項目は注意として出すが掲載する', () => {
  const r = run(row({ 最終確認日: '2026/7/1', 分野タグ: '' }));
  assert.equal(r.programs.length, 1);
  assert.equal(r.programs[0]!.needsRecheck, true);
  assert.deepEqual(r.issues.map((i) => i.level), ['warning', 'warning']);
});

test('見出しが変わったらビルドを止める', () => {
  const header = HEADER.map((h) => (h === '確認方法' ? '確認' : h));
  const r = validateSheet([header, row()], TODAY);
  assert.equal(r.programs.length, 0);
  assert.equal(r.issues[0]!.level, 'fatal');
  assert.match(r.issues[0]!.message, /確認方法/);
});

test('空行は数えない', () => {
  const r = run(row(), HEADER.map(() => ''), []);
  assert.equal(r.counts.rows, 1);
});
