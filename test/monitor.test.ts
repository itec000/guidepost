import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLUMNS } from '../src/lib/schema.ts';
import {
  RESULT_HEADER, SIGNAL, buildTargets, compareFingerprint, decodeBody, findNewYear, fingerprintLines, htmlToLines,
  isDue, judge, mentionsDeadline, parseResults, parseRobots, resultToCells, robotsAllows, sameUrl, sortResults,
  type ResultRow, type Target,
} from '../src/lib/monitor.ts';

const TODAY = '2026-10-29';
const HEADER = Object.values(COLUMNS);
const sheetRow = (v: Partial<Record<string, string | number>>) => HEADER.map((h) => v[h] ?? '');

const target = (over: Partial<Target> = {}): Target => ({
  id: '1', name: 'テスト', kind: '出典', url: 'https://example.com/a', deadline: '2026-11-20', status: 'open', ...over,
});
const page = (lines: string[], finalUrl = 'https://example.com/a') =>
  ({ kind: 'page', finalUrl, lines, fingerprint: fingerprintLines(lines) }) as const;

test('確認する URL の一覧：出典と、出典と違う公式URL', () => {
  const t = buildTargets([
    HEADER,
    sheetRow({ ID: 1, 名称: 'A', 締切日: 46346, 出典URL: 'https://a.jp/', 公式URL: 'https://a.jp/' }), // 46346 = 2026-11-20
    sheetRow({ ID: 2, 名称: 'B', '募集状況（手動）': '募集終了', 出典URL: 'https://b.jp/', 公式URL: 'https://b-official.jp/' }),
    sheetRow({ 名称: 'IDなし', 出典URL: 'https://c.jp/' }),
  ], TODAY);
  assert.deepEqual(t.map((x) => [x.id, x.kind, x.status]), [['1', '出典', 'open'], ['2', '出典', 'closed'], ['2', '公式', 'closed']]);
  assert.equal(t[0]!.deadline, '2026-11-20');
});

test('確認の頻度：締切60日以内は毎週、それ以外は月1回', () => {
  const prev = (checkedOn: string) => ({ checkedOn }) as ResultRow;
  assert.equal(isDue(target(), undefined, TODAY), true);
  assert.equal(isDue(target(), prev('2026-10-22'), TODAY), true); // 締切まで22日・7日前に確認
  assert.equal(isDue(target(), prev('2026-10-27'), TODAY), false);
  const far = target({ deadline: '2027-03-01' });
  assert.equal(isDue(far, prev('2026-10-22'), TODAY), false);
  assert.equal(isDue(far, prev('2026-10-01'), TODAY), true);
  assert.equal(isDue(target({ status: 'closed', deadline: '2026-06-01' }), prev('2026-10-22'), TODAY), false);
});

test('robots.txt：自分のグループ優先、最長一致、Allow 優先', () => {
  const txt = `User-agent: *\nDisallow: /private/\nAllow: /private/open\nCrawl-delay: 10\n\nUser-agent: BadBot\nDisallow: /`;
  const r = parseRobots(txt, 'MichishirubeBot');
  assert.equal(r.crawlDelay, 10);
  assert.equal(robotsAllows(r, '/'), true);
  assert.equal(robotsAllows(r, '/private/x'), false);
  assert.equal(robotsAllows(r, '/private/open/1'), true);
  assert.equal(robotsAllows(parseRobots('User-agent: michishirubebot\nDisallow: /\n\nUser-agent: *\nAllow: /', 'MichishirubeBot'), '/a'), false);
  assert.equal(robotsAllows(parseRobots('User-agent: *\nDisallow: /*.pdf$', 'X'), '/a.pdf'), false);
  assert.equal(robotsAllows(parseRobots('User-agent: *\nDisallow: /*.pdf$', 'X'), '/a.pdf?x'), true);
  assert.equal(robotsAllows(parseRobots('User-agent: *\nDisallow:', 'X'), '/a'), true);
});

test('HTML を行に分ける：スクリプト・ナビ・フッターを除き、全角を半角に', () => {
  const html = `<html><head><script>var t=1;</script><style>p{}</style></head><body>
    <nav>メニュー項目一覧</nav><h1>募集要項２０２６</h1><p>締切：１１月２０日&nbsp;（金）<br>参加費&amp;交通費</p>
    <footer>© 2026 copyright</footer></body></html>`;
  assert.deepEqual(htmlToLines(html), ['募集要項2026', '締切:11月20日 (金)', '参加費&交通費']);
  assert.ok(htmlToLines(html, { keepBoilerplate: true }).includes('メニュー項目一覧'));
});

test('文字コード：Shift_JIS のページも読める', () => {
  const sjis = new Uint8Array([0x82, 0xa0]); // 「あ」
  assert.equal(decodeBody(sjis, 'text/html; charset=Shift_JIS'), 'あ');
  const meta = new Uint8Array([...new TextEncoder().encode('<meta charset="shift_jis">'), 0x82, 0xa0]);
  assert.ok(decodeBody(meta, 'text/html').endsWith('あ'));
});

test('締切日の記載を探す', () => {
  assert.equal(mentionsDeadline(['応募締切 11月20日(金)'], '2026-11-20'), true);
  assert.equal(mentionsDeadline(['締切 2026/11/20'], '2026-11-20'), true);
  assert.equal(mentionsDeadline(['締切 11.20'], '2026-11-20'), true);
  assert.equal(mentionsDeadline(['応募締切 2026-11-20'], '2026-11-20'), true);
  assert.equal(mentionsDeadline(['締切 11月2日'], '2026-11-20'), false);
  assert.equal(mentionsDeadline(['21/11/20 更新'], '2026-01-20'), false); // 「11/20」の1は別の数字
});

test('新しい年度の記載', () => {
  assert.equal(findNewYear(['2026年度の募集は終了しました'], '2026-06-15'), null);
  assert.equal(findNewYear(['2027年度 参加者募集'], '2026-06-15'), '2027年度 参加者募集');
  assert.equal(findNewYear(['令和9年度の募集'], '2026-06-15'), '令和9年度の募集'); // 令和9年度 = 2027年度
  assert.equal(findNewYear(['2026年度 募集'], '2027-01-31'), null); // 1月締切は2026年度
  assert.equal(findNewYear(['2027年3月 成果発表会'], '2026-06-15'), null); // 募集の言葉がない
  assert.equal(findNewYear(['2027年 エントリー開始'], '2026-06-15'), '2027年 エントリー開始');
  assert.equal(findNewYear(['開催日:2027年3月26日'], '2026-06-15'), null); // 今回の回の開催日
});

test('前回の指紋との比較：増えた行を示す', () => {
  const before = fingerprintLines(['タイトル行です', '締切は11月20日']);
  const lines = ['タイトル行です', '締切は12月4日に延長'];
  const change = compareFingerprint(before, fingerprintLines(lines), lines);
  assert.deepEqual(change, { added: ['締切は12月4日に延長'], removedCount: 1 });
  assert.equal(compareFingerprint(before, before, null), null);
});

test('判定：初回は記録のみ、変化があれば要対応', () => {
  const first = judge(target(), page(['締切 11月20日']), undefined, TODAY);
  assert.equal(first.result, SIGNAL.first);
  assert.equal(first.action, '');
  const same = judge(target(), page(['締切 11月20日']), { ...first, memo: '確認済み' }, '2026-11-05');
  assert.equal(same.result, SIGNAL.same);
  assert.equal(same.memo, '確認済み'); // 手入力のメモは引き継ぐ
  const changed = judge(target(), page(['締切 11月20日', '延長しました']), first, '2026-11-05');
  assert.equal(changed.result, SIGNAL.changed);
  assert.equal(changed.action, '●');
  assert.match(changed.detail, /延長しました/);
});

test('判定：締切日が見当たらない・自動確認できない は、新しく出たときだけ要対応', () => {
  const r1 = judge(target(), page(['詳細はPDFを参照']), undefined, TODAY);
  assert.equal(r1.result, `${SIGNAL.noDeadline}`);
  assert.equal(r1.action, '●');
  const r2 = judge(target(), page(['詳細はPDFを参照']), r1, '2026-11-05');
  assert.equal(r2.result, `${SIGNAL.noDeadline}`);
  assert.equal(r2.action, '');
  const b1 = judge(target(), { kind: 'blocked', detail: 'robots.txt で自動アクセスが禁止されている' }, undefined, TODAY);
  assert.equal(b1.action, '●');
  assert.equal(b1.fingerprint, '');
  assert.equal(judge(target(), { kind: 'blocked', detail: 'x' }, b1, '2026-11-05').action, '');
});

test('判定：リンク切れと移動は毎回要対応、終了後の新年度', () => {
  assert.equal(judge(target(), { kind: 'broken', detail: 'ページがない（404）' }, undefined, TODAY).result, SIGNAL.broken);
  const moved = judge(target(), page(['締切 11月20日'], 'https://example.com/b'), undefined, TODAY);
  assert.equal(moved.result, SIGNAL.moved);
  assert.equal(moved.action, '●');
  assert.equal(sameUrl('http://example.com/a/', 'https://example.com/a#x'), true);
  assert.equal(sameUrl('https://www.example.com/', 'https://example.com/'), true);
  const closed = target({ status: 'closed', deadline: '2026-06-15' });
  const r = judge(closed, page(['2027年度 募集要項を公開しました']), undefined, TODAY);
  assert.equal(r.result, SIGNAL.newYear);
  assert.equal(r.action, '●');
});

test('チェック結果タブの読み書きと並び順', () => {
  const row = judge(target(), page(['締切 11月20日']), undefined, TODAY);
  const parsed = parseResults([[...RESULT_HEADER], resultToCells(row)]);
  assert.deepEqual(parsed.get('1 https://example.com/a'), row);
  assert.equal(parseResults([['違う見出し'], resultToCells(row)]).size, 0);
  const sorted = sortResults([{ ...row, id: '10' }, { ...row, id: '2' }, { ...row, id: '30', action: '●' }]);
  assert.deepEqual(sorted.map((r) => r.id), ['30', '2', '10']);
});
