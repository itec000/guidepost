import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CANDIDATE_HEADER, MAX_NEW_PER_SOURCE, STATE_HEADER, candidateToCells, collectExisting, extractLinks, failedSource,
  judgeSource, normalizeName, normalizeUrl, parseStates, stateToCells, type FoundLink, type Source,
} from '../src/lib/discover.ts';

const TODAY = '2026-10-30';
const source: Source = { name: 'テスト一覧', url: 'https://example.com/list', link: /^https:\/\/example\.com\/articles\/\d+$/ };
const noExisting = { urls: new Set<string>(), names: new Set<string>() };
const links = (...ids: number[]): FoundLink[] => ids.map((id) => ({ url: `https://example.com/articles/${id}`, title: `募集 ${id} 番` }));

test('URL と名前の正規化', () => {
  assert.equal(normalizeUrl('http://www.example.com/a/?utm_source=x&id=1#top'), 'https://example.com/a?id=1');
  assert.equal(normalizeUrl('https://example.com/a'), normalizeUrl('https://www.example.com/a/'));
  assert.equal(normalizeName('高校生 探究コンテスト２０２６！'), normalizeName('高校生探究コンテスト2026'));
});

test('一覧ページから詳細リンクを拾う', () => {
  const html = `
    <nav><a href="/about">サイトについて</a></nav>
    <a href="/articles/12"><img alt=""></a>
    <a class="title" href="/articles/12">高校生の<b>探究</b>ボランティア&amp;交流</a>
    <a href='https://example.com/articles/13?utm_source=top'>大学の夏の研究体験</a>
    <a href=/articles/14>オンライン説明会のお知らせ</a>
    <a href="/articles/abc">対象外</a>`;
  const found = extractLinks(html, 'https://example.com/list', { link: /^https:\/\/example\.com\/articles\/\d+(\?.*)?$/ });
  assert.deepEqual(found.map((l) => [l.url, l.title]), [
    ['https://example.com/articles/12', '高校生の 探究 ボランティア&交流'],
    ['https://example.com/articles/13', '大学の夏の研究体験'],
    ['https://example.com/articles/14', 'オンライン説明会のお知らせ'],
  ]);
  const onlyHigh = extractLinks(html, 'https://example.com/list', { link: /\/articles\/\d+/, include: /高校生|研究/ });
  assert.equal(onlyHigh.length, 2);
});

test('カード全体のリンクは見出しを名前に、画像だけなら alt、除外語は外す', () => {
  const html = `
    <a href="/articles/1"><span>国内/単発</span><h3 class="x">地域の清掃ボランティア</h3><p>2026年11月 説明文…</p></a>
    <a href="/articles/2"><div class="card-title">高校生ビジネスコンテスト</div><time>10/30</time></a>
    <a href="/articles/3"><img src="a.jpg" alt="夏の研究体験プログラム"></a>
    <a href="/articles/4"><h3>写真展《小学生限定》</h3></a>`;
  const found = extractLinks(html, 'https://example.com/', { link: /\/articles\/\d+$/, exclude: /小学生限定/ });
  assert.deepEqual(found.map((l) => l.title), ['地域の清掃ボランティア', '高校生ビジネスコンテスト', '夏の研究体験プログラム']);
});

test('matchCard ならカードのタグや説明にも include を当てる', () => {
  const html = `
    <a href="/articles/1"><ul><li>中高生歓迎</li></ul><p class="m-panel__title">国際協力ワークショップ</p></a>
    <a href="/articles/2"><p class="m-panel__title">社会人向けセミナー</p></a>`;
  const opts = { link: /\/articles\/\d+$/, include: /中高生/ };
  assert.deepEqual(extractLinks(html, 'https://example.com/', opts).length, 0);
  assert.deepEqual(extractLinks(html, 'https://example.com/', { ...opts, matchCard: true }), [
    { url: 'https://example.com/articles/1', title: '国際協力ワークショップ' },
  ]);
});

test('RSS から拾う', () => {
  const rss = `<rss><channel><title>一覧</title><link>https://example.com/</link>
    <item><title><![CDATA[高校生デザインコンテスト２０２６]]></title><link>https://example.com/contest-2026/</link></item>
    <item><title>お知らせ &amp; 結果</title><link>https://example.com/news/1/</link></item>
    <item><title>研究費「A&#038;B賞」</title><link>https://example.com/grant-2027/?utm_source=rss&#038;utm_medium=rss</link></item>
  </channel></rss>`;
  const found = extractLinks(rss, 'https://example.com/feed/', { link: /^https:\/\/example\.com\/[a-z0-9-]+-20\d\d\/$/, feed: true });
  assert.deepEqual(found, [
    { url: 'https://example.com/contest-2026/', title: '高校生デザインコンテスト2026' },
    { url: 'https://example.com/grant-2027/', title: '研究費「A&B賞」' },
  ]);
});

test('初回は記録だけ、2回目から新しいリンクを候補にする', () => {
  const first = judgeSource(source, links(1, 2, 3), undefined, noExisting, TODAY);
  assert.equal(first.candidates.length, 0);
  assert.match(first.state.result, /初回：3 件/);
  const second = judgeSource(source, links(2, 3, 4, 5), first.state, noExisting, '2026-11-06');
  assert.deepEqual(second.candidates.map((c) => c.url), ['https://example.com/articles/4', 'https://example.com/articles/5']);
  assert.equal(second.state.newCount, 2);
  // 一覧から消えたリンク（1）がまた出ても、一度見たものは候補にしない
  const third = judgeSource(source, links(1, 4, 5), second.state, noExisting, '2026-11-13');
  assert.equal(third.candidates.length, 0);
});

test('掲載データ・候補・除外にあるものは候補にしない', () => {
  const existing = collectExisting([
    [['ID', '名称', '出典URL', '公式URL'], [1, '募集 4 番', 'https://other.jp/', '']],
    [[...CANDIDATE_HEADER], ['別の名前', '', '', '', '', 'http://www.example.com/articles/5/', '', '', '', '']],
    [['名称', '主催', '理由', '除外日', '再確認先'], ['除外したもの', '', '', '', 'https://example.com/articles/6']],
  ]);
  const first = judgeSource(source, links(1), undefined, existing, TODAY);
  const second = judgeSource(source, links(1, 4, 5, 6, 7), first.state, existing, '2026-11-06');
  assert.deepEqual(second.candidates.map((c) => c.url), ['https://example.com/articles/7']);
  assert.match(second.state.result, /登録済み 3 件は除いた/);
});

test('新しいリンクが多すぎる・0件・読めないときは候補にしない', () => {
  const first = judgeSource(source, links(1), undefined, noExisting, TODAY);
  const many = Array.from({ length: MAX_NEW_PER_SOURCE + 1 }, (_, i) => i + 100);
  const flood = judgeSource(source, links(...many), first.state, noExisting, '2026-11-06');
  assert.equal(flood.candidates.length, 0);
  assert.match(flood.state.result, /多すぎる/);
  // 多すぎた分も記録はするので、次の回にまとめて出てくることはない
  assert.equal(judgeSource(source, links(...many), flood.state, noExisting, '2026-11-13').candidates.length, 0);
  const empty = judgeSource(source, [], first.state, noExisting, '2026-11-06');
  assert.match(empty.state.result, /0 件/);
  assert.equal(empty.state.known, first.state.known);
  const failed = failedSource(source, first.state, 'サーバーの応答が 500', '2026-11-06');
  assert.equal(failed.state.known, first.state.known);
});

test('記録タブの読み書き、候補の行', () => {
  const s = judgeSource(source, links(1, 2), undefined, noExisting, TODAY).state;
  assert.deepEqual(parseStates([[...STATE_HEADER], stateToCells(s)]).get('テスト一覧'), s);
  assert.equal(parseStates([['違う'], stateToCells(s)]).size, 0);
  const row = candidateToCells(links(9)[0]!, source, TODAY);
  assert.equal(row.length, CANDIDATE_HEADER.length);
  assert.deepEqual([row[0], row[5], row[6], row[7], row[8]], ['募集 9 番', 'https://example.com/articles/9', TODAY, 'プログラム', '未確認']);
});
