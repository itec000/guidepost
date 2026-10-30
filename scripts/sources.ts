// 発見元：週1回読む一覧ページ。追加・削除はここを編集する。
//
// 載せる条件（2026-10-30 確認）:
// - robots.txt でその一覧ページへのアクセスが禁止されていない
// - 利用規約でスクレイピング・機械的な収集が禁止されていない
// - リンクがサーバーの HTML に含まれている（JavaScript で後から表示する一覧は読めない）
// 読むのは一覧ページだけ。詳細ページの中身は取らず、名称と URL だけを「候補」に書く（転載はしない）。
//
// 条件を満たさないので人が手で見るもの（運営ガイド参照）:
//   東大 focus のイベント一覧（JavaScript 表示）、洋々LABO の課外活動検索（JavaScript 表示）、
//   JSPS ひらめき☆ときめきサイエンス（一覧が PDF）、ボランティアプラットフォーム・国立青少年教育振興機構（アクセス拒否）、
//   Peatix（検索ページは robots.txt で禁止）、JST STELLA の実施機関一覧（年1回でよい）、登竜門の HTML ページ（規約が厳しいので RSS だけ使う）
import type { Source } from '../src/lib/discover.ts';

export const SOURCES: Source[] = [
  {
    name: 'activo 高校生',
    url: 'https://activo.jp/high_schooler',
    link: /^https:\/\/activo\.jp\/articles\/\d+$/,
  },
  {
    name: '公募ガイド 高校生',
    url: 'https://koubo.jp/student/senior',
    link: /^https:\/\/koubo\.jp\/contest\/\d+$/,
  },
  {
    // 利用規約が厳しいため、サイトが自動チェック用に案内している RSS だけを読む
    name: '登竜門 学生向け（RSS）',
    url: 'https://compe.japandesign.ne.jp/category/student/feed/',
    link: /^https:\/\/compe\.japandesign\.ne\.jp\/[a-z0-9-]+\/$/,
    exclude: /小学生限定|中学生限定/,
    feed: true,
  },
  {
    name: '高校生新聞 イベント情報',
    url: 'https://www.koukouseishinbun.jp/archive/category/%E3%82%A4%E3%83%99%E3%83%B3%E3%83%88%E6%83%85%E5%A0%B1',
    link: /^https:\/\/www\.koukouseishinbun\.jp\/articles\/-\/\d+$/,
  },
  {
    name: 'リセマム 高校生向けイベント',
    url: 'https://resemom.jp/category/event/highschool/latest/',
    link: /^https:\/\/resemom\.jp\/article\/\d{4}\/\d{2}\/\d{2}\/\d+\.html$/,
  },
  {
    name: 'トビタテ 高校生ニュース',
    url: 'https://tobitate-mext.jasso.go.jp/news/highschool.html',
    link: /^https:\/\/tobitate-mext\.jasso\.go\.jp\/news\/\d+(_\d+)?\.html$/,
  },
  {
    name: '洋々LABO イベント',
    url: 'https://you2.jp/labo/category/nyushi-news/%e3%82%a4%e3%83%99%e3%83%b3%e3%83%88/',
    link: /^https:\/\/you2\.jp\/labo\/\d+\/$/,
    exclude: /総合型選抜|推薦/, // サイドバーに出る入試の情報（掲載の対象外）
  },
  {
    name: 'グローバルエデュ 高校生',
    url: 'https://globaledu.jp/tag/high-school-students/',
    link: /^https:\/\/globaledu\.jp\/[a-z0-9-]+\/$/,
  },
  {
    name: 'マイプロジェクト アワード',
    url: 'https://myprojects.jp/award/',
    link: /^https:\/\/myprojects\.jp\/award\/[a-z0-9-]+\/$/,
  },
  {
    name: 'マイプロジェクト イベント',
    url: 'https://myprojects.jp/article/event/',
    link: /^https:\/\/myprojects\.jp\/article\/event\/[a-z0-9_-]+\/$/,
  },
  {
    name: '東大 金曜特別講座',
    url: 'https://high-school.c.u-tokyo.ac.jp/',
    link: /^https:\/\/high-school\.c\.u-tokyo\.ac\.jp\/lecture_time\/\d{4}[sw]\.html$/,
  },
];
