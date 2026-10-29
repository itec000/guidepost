// 表格の列定義と選択肢。scripts/seed_to_sheet.py の COLUMNS と揃えること。

export const CATEGORIES = ['コンテスト', '大学プログラム', 'インターン', 'ボランティア', '研究助成'] as const;
export const TAGS = [
  '科学・研究', '数学・情報', 'ビジネス・起業', '福祉・医療', '教育・子ども', '環境・エネルギー',
  '地域・まちづくり', '国際・協力', '歴史・文化・人文', '社会課題・政策', '芸術・表現・メディア',
  'スポーツ・イベント運営',
] as const;
export const GRADES = ['中学生', '高1', '高2', '高3', '記載なし'] as const;
export const REGION_BLOCKS = [
  '全国', 'オンライン', '北海道・東北', '関東', '中部', '関西', '中国・四国', '九州・沖縄',
] as const;
export const ROUTES = ['個人で応募', '学校経由', '個人・学校どちらも可', '公式ページに記載なし'] as const;
export const YES_NO = ['あり', 'なし', '不明'] as const;
export const CONFIRMS = ['公式で確認', '二次情報で確認', '未確認', '矛盾あり'] as const;
export const STATUS_OVERRIDES = ['募集終了', '随時募集'] as const;
export const PUBLISH = ['公開', '非公開'] as const;

export type Category = (typeof CATEGORIES)[number];
export type Tag = (typeof TAGS)[number];
export type Grade = (typeof GRADES)[number];
export type RegionBlock = (typeof REGION_BLOCKS)[number];
export type Route = (typeof ROUTES)[number];
export type YesNo = (typeof YES_NO)[number];
export type Confirm = (typeof CONFIRMS)[number];
export type StatusOverride = (typeof STATUS_OVERRIDES)[number];

export type Depth = '体験' | '実践' | '深入' | '判定不能';
export type RecruitStatus = 'open' | 'closed' | 'rolling' | 'unknown';

// key → 表格の見出し。チェック・体験の深さ（数式列）は読まない
export const COLUMNS = {
  id: 'ID',
  publish: '公開',
  category: '種別',
  name: '名称',
  organizer: '主催',
  tags: '分野タグ',
  grades: '対象学年',
  target: '対象（原文）',
  period: '期間・日程',
  deadlineText: '締切（表示用）',
  deadline: '締切日',
  statusOverride: '募集状況（手動）',
  cost: '費用',
  area: '実施場所',
  region: '地域',
  regionBlock: '地方ブロック',
  selection: '選考',
  route: '応募ルート',
  hasOutput: '成果物',
  hasMentor: '指導者・メンター',
  overMonth: '1か月以上',
  needsOfficial: '費用・宿泊・現地参加',
  confirm: '確認方法',
  sourceUrl: '出典URL',
  officialUrl: '公式URL',
  lastChecked: '最終確認日',
  note: '内部メモ',
} as const;
export type ColumnKey = keyof typeof COLUMNS;

/** サイトに出す1件分。内部メモ・公開フラグ・費用等の確認区分は含めない */
export interface Program {
  id: number;
  category: Category;
  name: string;
  organizer: string;
  tags: Tag[];
  grades: Grade[];
  target: string;
  period: string;
  deadlineText: string;
  deadline: string | null; // YYYY-MM-DD
  status: RecruitStatus;
  cost: string;
  area: string;
  region: string;
  regionBlock: RegionBlock | null;
  selection: string;
  route: Route | null;
  depth: Depth;
  depthCriteria: { hasOutput: YesNo | null; hasMentor: YesNo | null; overMonth: YesNo | null };
  confirm: Confirm;
  sourceUrl: string;
  officialUrl: string | null;
  lastChecked: string | null; // YYYY-MM-DD
  needsRecheck: boolean;
}
