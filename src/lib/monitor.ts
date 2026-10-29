// 阶段 5「掲載中の項目の監視」の判定ロジック（ネットワークや表格に触れない部分）。
//
// 方針: 程序は「見つけて知らせる」だけ。結果は表格の「チェック結果」タブに書き、
// 掲載データは変更しない。判断と修正は人が行う。
import { createHash } from 'node:crypto';
import { COLUMNS, STATUS_OVERRIDES, type RecruitStatus, type StatusOverride } from './schema.ts';
import { daysBetween, parseDateCell, recruitStatus } from './derive.ts';

export type Cell = string | number | boolean;

export const RESULT_SHEET = 'チェック結果';
export const RESULT_HEADER = [
  'ID', '名称', 'URLの種類', 'URL', '要対応', '結果', '詳細', '自動確認日', '対応メモ', '指紋（自動・編集しない）',
] as const;

/** 締切がこの日数以内なら毎週、それ以外は月1回 */
export const SOON_DAYS = 60;
const WEEKLY_INTERVAL = 6; // 週1回の実行で毎回対象になるよう、少し短め
const MONTHLY_INTERVAL = 27;

export const SIGNAL = {
  first: '初回（記録のみ）',
  same: '変化なし',
  changed: '変化あり',
  newYear: '新しい年度の記載',
  noDeadline: '締切日が見当たらない',
  moved: '移動',
  broken: 'リンク切れ',
  blocked: '自動確認できず',
} as const;
export type Signal = keyof typeof SIGNAL;

/** 毎回知らせるもの（直すまで続く問題・新しい変化） */
const ALWAYS_ACTION: Signal[] = ['changed', 'moved', 'broken'];
/** 前回の結果になかったときだけ知らせるもの（毎週同じ注意が並ばないように） */
const NEW_ACTION: Signal[] = ['newYear', 'noDeadline', 'blocked'];

export interface Target {
  id: string;
  name: string;
  kind: '出典' | '公式';
  url: string;
  deadline: string | null;
  status: RecruitStatus;
}

export interface ResultRow {
  id: string;
  name: string;
  kind: string;
  url: string;
  action: string; // '●' または ''
  result: string; // 「・」区切りの SIGNAL の値
  detail: string;
  checkedOn: string; // YYYY-MM-DD
  memo: string; // 人が書く。程序は引き継ぐだけ
  fingerprint: string;
}

// ---------------------------------------------------------------- 対象を選ぶ

/** 「掲載データ」から確認する URL の一覧を作る。公開・非公開を問わず、ID と URL がある行すべて */
export function buildTargets(rows: Cell[][], today: string): Target[] {
  const header = (rows[0] ?? []).map((h) => String(h).trim());
  const col = (label: string) => {
    const i = header.indexOf(label);
    if (i < 0) throw new Error(`「掲載データ」に見出し「${label}」がない`);
    return i;
  };
  const c = {
    id: col(COLUMNS.id), name: col(COLUMNS.name), deadline: col(COLUMNS.deadline),
    override: col(COLUMNS.statusOverride), source: col(COLUMNS.sourceUrl), official: col(COLUMNS.officialUrl),
  };
  const targets: Target[] = [];
  for (const r of rows.slice(1)) {
    const text = (i: number) => String(r[i] ?? '').trim();
    const id = text(c.id);
    if (!id) continue;
    const override = STATUS_OVERRIDES.includes(text(c.override) as StatusOverride) ? (text(c.override) as StatusOverride) : null;
    const deadline = parseDateCell(r[c.deadline]) ?? null;
    const base = { id, name: text(c.name), deadline, status: recruitStatus(deadline, override, today) };
    const source = text(c.source);
    const official = text(c.official);
    if (source) targets.push({ ...base, kind: '出典', url: source });
    if (official && official !== source) targets.push({ ...base, kind: '公式', url: official });
  }
  return targets;
}

export const targetKey = (t: { id: string; url: string }) => `${t.id} ${t.url}`;

/** 前回の自動確認からの日数で、今回確認するかを決める */
export function isDue(t: Target, prev: ResultRow | undefined, today: string): boolean {
  const last = prev ? parseDateCell(prev.checkedOn) : null;
  if (!last) return true;
  const soon = t.status === 'open' && t.deadline !== null && daysBetween(today, t.deadline) <= SOON_DAYS;
  return daysBetween(last, today) >= (soon ? WEEKLY_INTERVAL : MONTHLY_INTERVAL);
}

/** 「チェック結果」タブの値を読む。見出しの並びが違えば空として扱う（作り直す） */
export function parseResults(rows: Cell[][]): Map<string, ResultRow> {
  const map = new Map<string, ResultRow>();
  const header = (rows[0] ?? []).map((h) => String(h).trim());
  if (RESULT_HEADER.some((h, i) => header[i] !== h)) return map;
  for (const r of rows.slice(1)) {
    const v = (i: number) => String(r[i] ?? '').trim();
    const row: ResultRow = {
      id: v(0), name: v(1), kind: v(2), url: v(3), action: v(4), result: v(5), detail: v(6),
      checkedOn: parseDateCell(r[7]) ?? v(7), memo: v(8), fingerprint: v(9),
    };
    if (row.id && row.url) map.set(targetKey(row), row);
  }
  return map;
}

export const resultToCells = (r: ResultRow): string[] =>
  [r.id, r.name, r.kind, r.url, r.action, r.result, r.detail, r.checkedOn, r.memo, r.fingerprint];

/** 列幅（px）。指紋は人が見るものではないので隠す。毎回そろえ直すので、手で変えた幅は次の確認で戻る */
const COLUMN_WIDTHS = [48, 220, 84, 240, 64, 170, 440, 100, 220, 0];

/** 「チェック結果」タブの見た目（Sheets API batchUpdate の requests） */
export function formatRequests(tabId: number) {
  const cols = (start: number, end = start + 1) => ({ sheetId: tabId, dimension: 'COLUMNS', startIndex: start, endIndex: end });
  const cells = (startColumnIndex: number, endColumnIndex: number, startRowIndex = 0, endRowIndex?: number) =>
    ({ sheetId: tabId, startColumnIndex, endColumnIndex, startRowIndex, ...(endRowIndex ? { endRowIndex } : {}) });
  return [
    { updateSheetProperties: { properties: { sheetId: tabId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
    ...COLUMN_WIDTHS.map((px, i) => ({
      updateDimensionProperties: {
        range: cols(i),
        properties: px ? { pixelSize: px, hiddenByUser: false } : { hiddenByUser: true },
        fields: px ? 'pixelSize,hiddenByUser' : 'hiddenByUser',
      },
    })),
    // 全体を上ぞろえ、名称・結果・詳細・対応メモは折り返す
    { repeatCell: { range: cells(0, 10), cell: { userEnteredFormat: { verticalAlignment: 'TOP', wrapStrategy: 'CLIP' } }, fields: 'userEnteredFormat(verticalAlignment,wrapStrategy)' } },
    ...[[1, 2], [5, 7], [8, 9]].map(([a, b]) => ({
      repeatCell: { range: cells(a!, b!), cell: { userEnteredFormat: { wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat.wrapStrategy' },
    })),
    { repeatCell: { range: cells(4, 5), cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat.horizontalAlignment' } },
    { repeatCell: { range: cells(0, 10, 0, 1), cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.93, green: 0.94, blue: 0.96 } } }, fields: 'userEnteredFormat(textFormat.bold,backgroundColor)' } },
  ];
}

/** 要対応を上に、あとは ID 順 */
export function sortResults(rows: ResultRow[]): ResultRow[] {
  const num = (id: string) => (Number.isFinite(Number(id)) ? Number(id) : Infinity);
  return [...rows].sort((a, b) =>
    Number(Boolean(b.action)) - Number(Boolean(a.action)) || num(a.id) - num(b.id) || a.id.localeCompare(b.id) || a.kind.localeCompare(b.kind));
}

// ---------------------------------------------------------------- robots.txt

export interface RobotsRules {
  rules: { allow: boolean; pattern: string }[];
  crawlDelay: number | null; // 秒
}

/** RFC 9309 に沿った簡易パーサ。自分の名前のグループがあればそれ、なければ * のグループを使う */
export function parseRobots(text: string, agent: string): RobotsRules {
  type Group = { agents: string[]; rules: RobotsRules['rules']; crawlDelay: number | null };
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === 'user-agent') {
      if (!lastWasAgent || !current) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'allow' || key === 'disallow') {
      if (value) current.rules.push({ allow: key === 'allow', pattern: value });
    } else if (key === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }
  const name = agent.toLowerCase();
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && name.includes(a)));
  const chosen = mine.length > 0 ? mine : groups.filter((g) => g.agents.includes('*'));
  return {
    rules: chosen.flatMap((g) => g.rules),
    crawlDelay: chosen.reduce<number | null>((d, g) => (g.crawlDelay === null ? d : Math.max(d ?? 0, g.crawlDelay)), null),
  };
}

const patternToRegExp = (pattern: string) =>
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')}`);

/** 一番長く一致したルールに従う。同じ長さなら Allow を優先。どれにも一致しなければ許可 */
export function robotsAllows(robots: RobotsRules, pathAndQuery: string): boolean {
  let best: { allow: boolean; length: number } | null = null;
  for (const r of robots.rules) {
    if (!patternToRegExp(r.pattern).test(pathAndQuery)) continue;
    const length = r.pattern.length;
    if (!best || length > best.length || (length === best.length && r.allow)) best = { allow: r.allow, length };
  }
  return best?.allow ?? true;
}

// ---------------------------------------------------------------- ページの中身

/** Content-Type の charset、なければ <meta charset> を見て文字コードを決める（Shift_JIS・EUC-JP のサイトがある） */
export function decodeBody(bytes: Uint8Array, contentType: string): string {
  const fromHeader = contentType.match(/charset=["']?([\w-]+)/i)?.[1];
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
  const fromMeta = head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  for (const label of [fromHeader, fromMeta, 'utf-8']) {
    if (!label) continue;
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      // 知らない文字コード名なら次を試す
    }
  }
  return new TextDecoder().decode(bytes);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * HTML を「行」の配列にする。全角英数は半角にそろえる（NFKC）。
 * 変化の比較用には、ナビゲーション・フッター・サイドバーなど毎回変わりやすい部分も捨てる。
 * 締切日を探すときは捨てない（まとめサイトはサイドバーに締切を書くことがある）
 */
export function htmlToLines(html: string, { keepBoilerplate = false } = {}): string[] {
  const drop = keepBoilerplate ? 'script|style|noscript|template|svg' : 'script|style|noscript|template|svg|nav|footer|aside|iframe';
  const text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(new RegExp(`<(${drop})\\b[\\s\\S]*?<\\/\\1\\s*>`, 'gi'), ' ')
    .replace(/<(br|\/?(p|div|li|ul|ol|tr|table|h[1-6]|dt|dd|dl|section|article|header|main|blockquote|pre|th|td))\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
      }
      return ENTITIES[e.toLowerCase()] ?? all;
    })
    .normalize('NFKC');
  return text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length >= 4);
}

const shortHash = (s: string, length: number) => createHash('sha256').update(s).digest('hex').slice(0, length);
const MAX_LINES = 2000; // セルの上限（5万文字）に収める

/** 指紋：HTML は行ごとの短いハッシュを並べたもの（どの行が増えたか分かる）、それ以外はファイル全体のハッシュ */
export function fingerprintLines(lines: string[]): string {
  return `L:${lines.slice(0, MAX_LINES).map((l) => shortHash(l, 8)).join('')}`;
}
export const fingerprintBytes = (bytes: Uint8Array) => `B:${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}`;

const lineHashes = (fp: string) => new Set(fp.slice(2).match(/.{8}/g) ?? []);

export interface Change {
  added: string[];
  removedCount: number;
}

/** 前回の指紋と比べる。種類が違う（HTML ↔ PDF）ときは「変わった」とだけ言う */
export function compareFingerprint(prev: string, current: string, lines: string[] | null): Change | null {
  if (prev === current) return null;
  if (!prev.startsWith('L:') || !current.startsWith('L:') || !lines) return { added: [], removedCount: 0 };
  const before = lineHashes(prev);
  const now = lineHashes(current);
  const added = [...new Set(lines.slice(0, MAX_LINES))].filter((l) => !before.has(shortHash(l, 8)));
  const removedCount = [...before].filter((h) => !now.has(h)).length;
  return added.length || removedCount ? { added, removedCount } : null;
}

/** 年度の始まり（4月）で区切った年度 */
export const fiscalYear = (date: string) => {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return m >= 4 ? y : y - 1;
};

/** 締切後の項目について、前回の締切より新しい年度・年の募集らしい記載を探す */
export function findNewYear(lines: string[], deadline: string): string | null {
  const fy = fiscalYear(deadline);
  const year = Number(deadline.slice(0, 4));
  for (const line of lines) {
    const fys = [
      ...[...line.matchAll(/(20\d{2})\s*年度/g)].map((m) => Number(m[1])),
      ...[...line.matchAll(/令和\s*(元|\d{1,2})\s*年度/g)].map((m) => 2018 + (m[1] === '元' ? 1 : Number(m[1]))),
    ];
    if (fys.some((y) => y > fy)) return line;
    if (/募集|応募|エントリー/.test(line) && [...line.matchAll(/(20\d{2})\s*年(?!度)/g)].some((m) => Number(m[1]) > year)) return line;
  }
  return null;
}

/** 登録した締切日（月・日）がページのどこかに書かれているか。「11月20日」「11/20」「11.20」「2026-11-20」など */
export function mentionsDeadline(lines: string[], deadline: string): boolean {
  const [y, m, d] = deadline.split('-').map(Number) as [number, number, number];
  const md = `0?${m}\\s*月\\s*0?${d}\\s*日`;
  const slash = `0?${m}\\s*[/.]\\s*0?${d}(?!\\d)`;
  const iso = `${y}-0?${m}-0?${d}(?!\\d)`;
  const re = new RegExp(`(?<!\\d)(${md}|${slash}|${iso})`);
  return lines.some((l) => re.test(l));
}

// ---------------------------------------------------------------- 判定

export type FetchOutcome =
  | { kind: 'page'; finalUrl: string; lines: string[] | null; fullLines?: string[]; fingerprint: string }
  | { kind: 'broken'; detail: string }
  | { kind: 'blocked'; detail: string };

/** URL の比較用：http/https、www. の有無、末尾の /、# 以降の違いは同じとみなす */
export const sameUrl = (a: string, b: string) => {
  const norm = (u: string) => u.replace(/^http:/, 'https:').replace(/^https:\/\/www\./, 'https://').replace(/#.*$/, '').replace(/\/+$/, '');
  return norm(a) === norm(b);
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function judge(t: Target, outcome: FetchOutcome, prev: ResultRow | undefined, today: string): ResultRow {
  const signals: Signal[] = [];
  const details: string[] = [];
  let fingerprint = prev?.fingerprint ?? '';

  if (outcome.kind === 'broken') {
    signals.push('broken');
    details.push(outcome.detail);
  } else if (outcome.kind === 'blocked') {
    signals.push('blocked');
    details.push(`${outcome.detail}。手作業で確認する`);
  } else {
    fingerprint = outcome.fingerprint;
    if (!sameUrl(outcome.finalUrl, t.url)) {
      signals.push('moved');
      details.push(`移動先：${outcome.finalUrl}`);
    }
    const change = prev?.fingerprint ? compareFingerprint(prev.fingerprint, outcome.fingerprint, outcome.lines) : null;
    if (change) {
      signals.push('changed');
      const examples = change.added.slice(0, 3).map((l) => `「${clip(l, 60)}」`).join('');
      details.push(outcome.lines
        ? `追加 ${change.added.length} 行・削除 ${change.removedCount} 行${examples ? `。追加の例：${examples}` : ''}`
        : 'ファイルの内容が変わった');
    }
    if (outcome.lines && t.deadline) {
      if (t.status === 'closed') {
        const line = findNewYear(outcome.lines, t.deadline);
        if (line) {
          signals.push('newYear');
          details.push(`次の募集の可能性：「${clip(line, 80)}」`);
        }
      } else if (t.status === 'open' && !mentionsDeadline(outcome.fullLines ?? outcome.lines, t.deadline)) {
        signals.push('noDeadline');
        details.push(`登録の締切日（${Number(t.deadline.slice(5, 7))}/${Number(t.deadline.slice(8))}）がこのページに見当たらない。延長・変更か、別ページ（PDFなど）に書かれている`);
      }
    }
    if (signals.length === 0) signals.push(prev?.fingerprint ? 'same' : 'first');
  }

  const before = new Set((prev?.result ?? '').split('・'));
  const action = signals.some((s) => ALWAYS_ACTION.includes(s) || (NEW_ACTION.includes(s) && !before.has(SIGNAL[s])));
  return {
    id: t.id, name: t.name, kind: t.kind, url: t.url,
    action: action ? '●' : '',
    result: signals.map((s) => SIGNAL[s]).join('・'),
    detail: details.join(' ／ '),
    checkedOn: today,
    memo: prev?.memo ?? '',
    fingerprint,
  };
}

/** 確認しなかった URL は前回の行をそのまま残す（名称だけ最新にする） */
export const carryOver = (t: Target, prev: ResultRow): ResultRow => ({ ...prev, name: t.name, kind: t.kind });
