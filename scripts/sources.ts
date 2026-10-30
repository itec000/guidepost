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
//   Peatix（検索ページは robots.txt で禁止）、JST STELLA の実施機関一覧（年1回でよい）、登竜門の HTML ページ（規約が厳しいので RSS だけ使う）、
//   東京都 Job EX 中高生職業体験（5月にまとめて募集。年1回でよい）、リコチャレのイベント一覧（リンク先が中継ページ）、
//   大学ジャーナル「高校生」タグ（GitHub Actions からは 403。月1回手で見る）、
//   connpass・Doorkeeper（robots.txt で禁止）、PR TIMES（件数が多すぎて週1回では大半を見落とす）
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
  // ---- 2026-10-30 追加（企業のプログラム・大学・研究発表・国際協力）
  {
    name: 'Qulii イベント（RSS）',
    url: 'https://qulii.jp/event/feed/',
    link: /^https:\/\/qulii\.jp\/event\/\d+$/,
    exclude: /小学生のみ|小学生限定/,
    feed: true,
  },
  {
    // 長期のものは活動支援金が出ることがある（掲載前に詳細ページで確認）
    name: 'PROJECT INDEX 高校生可',
    url: 'https://www.project-index.jp/query?job_target%5B%5D=%E9%AB%98%E6%A0%A1%E7%94%9F',
    link: /^https:\/\/www\.project-index\.jp\/intern\/\d+$/,
    exclude: /募集終了/,
    matchCard: true,
  },
  {
    // 企業の職場・研究所見学（中高生の女子が対象）
    name: 'Girls Meet STEM（RSS）',
    url: 'https://gms.shinfdn.org/tour/feed/',
    link: /^https:\/\/gms\.shinfdn\.org\/tour\/[A-Za-z0-9]{8}\/$/,
    feed: true,
  },
  {
    name: 'サイエンスキャッスル（RSS）',
    url: 'https://castle.lne.st/feed/',
    link: /^https:\/\/castle\.lne\.st\/(news|research-info|grants|science-castle-asia|teachers-info)\/(.+\/)?\d+\/$/,
    exclude: /Philippines|採択チームが決定|発表者.*決定/,
    feed: true,
  },
  {
    // 研究・教育の会社の記事全体なので、中高生向けだけにしぼる
    name: 'リバネス（RSS）',
    url: 'https://lne.st/feed/',
    link: /^https:\/\/lne\.st\/\d{4}\/\d{2}\/\d{2}\/[^/?#]+\/$/,
    include: /中高|高校生|高専生/, // 「中高・高専生参加者募集」のような書き方もある
    feed: true,
  },
  {
    name: '大学プレスセンター 高校生（RSS）',
    url: 'https://www.u-presscenter.jp/tag/%e9%ab%98%e6%a0%a1%e7%94%9f/feed',
    link: /^https:\/\/www\.u-presscenter\.jp\/article\/\d+$/,
    exclude: /セレクション|入試説明|オープンキャンパス|フェスティバル/,
    feed: true,
  },
  {
    // 「中高生歓迎」はカードのタグにだけ書かれている
    name: 'JICA PARTNER イベント・セミナー',
    url: 'https://partner.jica.go.jp/Seminar/Search',
    link: /^https:\/\/partner\.jica\.go\.jp\/Seminar\/Detail\/\d+$/,
    include: /中高生|高校生/,
    matchCard: true,
  },
];
