// 表格「掲載データ」の行を検証し、サイトに出す Program に変換する。
//
// 方針（2026-10-29 決定）:
// - 表格の構造が壊れている（見出しの欠落・重複）→ fatal。ビルドを止める
// - 「公開」行の問題 → error。その行だけサイトに出さず、他はそのまま更新する
// - 「公開」行の注意点 → warning。サイトには出す
// 「非公開」行は ID の重複以外は検証しない（表格のチェック列と同じ）。
import {
  CATEGORIES, COLUMNS, CONFIRMS, GRADES, PUBLISH, REGION_BLOCKS, ROUTES, STATUS_OVERRIDES, TAGS, YES_NO,
  type ColumnKey, type Program,
} from './schema.ts';
import { judgeDepth, needsRecheck, parseDateCell, recruitStatus } from './derive.ts';

export type Cell = string | number | boolean;
export type Level = 'fatal' | 'error' | 'warning';

export interface Issue {
  level: Level;
  row?: number; // 表格の行番号（見出しが1行目）
  id?: Cell;
  column?: string; // 例: 「確認方法」（Y列）
  message: string;
}

export interface ValidationResult {
  programs: Program[];
  issues: Issue[];
  counts: { rows: number; publishRequested: number; published: number; skipped: number };
}

const columnLetter = (index: number): string => {
  let s = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

const isUrl = (s: string) => /^https?:\/\/\S+$/.test(s);

export function validateSheet(rows: Cell[][], today: string): ValidationResult {
  const issues: Issue[] = [];
  const result = (programs: Program[] = [], counts = { rows: 0, publishRequested: 0, published: 0, skipped: 0 }) =>
    ({ programs, issues, counts });

  // --- 見出し ---
  const header = (rows[0] ?? []).map((h) => String(h).trim());
  const index = {} as Record<ColumnKey, number>;
  for (const [key, label] of Object.entries(COLUMNS) as [ColumnKey, string][]) {
    const found = header.flatMap((h, i) => (h === label ? [i] : []));
    if (found.length === 0) issues.push({ level: 'fatal', message: `見出し「${label}」の列が見つからない（名前を変えた・消した可能性）` });
    else if (found.length > 1) issues.push({ level: 'fatal', message: `見出し「${label}」の列が ${found.length} つある` });
    else index[key] = found[0]!;
  }
  if (issues.some((i) => i.level === 'fatal')) return result();

  // --- ID の重複（非公開の行も含めて見る。ID は再利用しない約束のため） ---
  const idRows = new Map<string, number[]>();
  rows.slice(1).forEach((r, i) => {
    const id = String(r[index.id] ?? '').trim();
    if (id) idRows.set(id, [...(idRows.get(id) ?? []), i + 2]);
  });

  const programs: Program[] = [];
  let rowCount = 0;
  let publishRequested = 0;

  rows.slice(1).forEach((r, i) => {
    const rowNo = i + 2;
    const raw = (key: ColumnKey): Cell => r[index[key]] ?? '';
    const text = (key: ColumnKey): string => String(raw(key)).trim();
    if (!text('id') && !text('name')) return; // 空行
    rowCount++;

    const rowIssues: Issue[] = [];
    const add = (level: Level, key: ColumnKey | null, message: string) =>
      rowIssues.push({
        level, row: rowNo, id: raw('id'), message,
        ...(key ? { column: `「${COLUMNS[key]}」（${columnLetter(index[key])}列）` } : {}),
      });

    const publish = text('publish');
    if (publish && !(PUBLISH as readonly string[]).includes(publish)) {
      add('error', 'publish', `「${publish}」は使えない値（公開／非公開）。非公開として扱った`);
    }
    if (publish !== '公開') {
      issues.push(...rowIssues);
      return;
    }
    publishRequested++;

    // 1つの値（選択肢）。空は null、選択肢外は error
    const one = <T extends string>(key: ColumnKey, choices: readonly T[]): T | null => {
      const v = text(key);
      if (!v) return null;
      if ((choices as readonly string[]).includes(v)) return v as T;
      add('error', key, `「${v}」は選択肢にない値`);
      return null;
    };
    // 複数選択（「a, b」）。選択肢外が1つでもあれば error
    const many = <T extends string>(key: ColumnKey, choices: readonly T[]): T[] => {
      const values = [...new Set(text(key).split(/[,、，]/).map((s) => s.trim()).filter(Boolean))];
      const bad = values.filter((v) => !(choices as readonly string[]).includes(v));
      if (bad.length) add('error', key, `「${bad.join('」「')}」は選択肢にない値`);
      return values.filter((v) => !bad.includes(v)) as T[];
    };
    const date = (key: ColumnKey): string | null => {
      const v = parseDateCell(raw(key));
      if (v === undefined) {
        add('error', key, `「${raw(key)}」を日付として読めない（例: 2026-10-23）`);
        return null;
      }
      return v;
    };

    // ID・名称
    const idText = text('id');
    const id = Number(idText);
    if (!idText) add('error', 'id', 'ID が空');
    else if (!Number.isInteger(id) || id <= 0) add('error', 'id', `ID「${idText}」は正の整数でない`);
    else if ((idRows.get(idText) ?? []).length > 1) {
      add('error', 'id', `ID ${idText} が複数の行にある（${idRows.get(idText)!.join('・')}行目）`);
    }
    if (!text('name')) add('error', 'name', '名称が空');

    // 選択肢
    const category = one('category', CATEGORIES);
    if (!text('category')) add('error', 'category', '種別が空');
    const tags = many('tags', TAGS);
    const grades = many('grades', GRADES);
    const route = one('route', ROUTES);
    const regionBlock = one('regionBlock', REGION_BLOCKS);
    const hasOutput = one('hasOutput', YES_NO);
    const hasMentor = one('hasMentor', YES_NO);
    const overMonth = one('overMonth', YES_NO);
    const needsOfficial = one('needsOfficial', YES_NO);
    const statusOverride = one('statusOverride', STATUS_OVERRIDES);
    const confirm = one('confirm', CONFIRMS);

    // 公開基準（表格のチェック列と同じ規則）
    if (!text('confirm')) {
      add('error', 'confirm', '確認方法が空のため公開できない');
    } else if (confirm === '未確認' || confirm === '矛盾あり') {
      add('error', 'confirm', `確認方法が「${confirm}」のため公開できない`);
    } else if (confirm && needsOfficial !== 'なし' && confirm !== '公式で確認') {
      add('error', 'needsOfficial', `費用・宿泊・現地参加が「${needsOfficial ?? '空'}」のため、公式で確認しないと公開できない`);
    }

    // URL
    const sourceUrl = text('sourceUrl');
    if (!sourceUrl) add('error', 'sourceUrl', '出典URLが空');
    else if (!isUrl(sourceUrl)) add('error', 'sourceUrl', `「${sourceUrl}」はURLとして読めない`);
    const officialUrl = text('officialUrl') || null;
    if (officialUrl && !isUrl(officialUrl)) add('error', 'officialUrl', `「${officialUrl}」はURLとして読めない`);

    // 日付
    const deadline = date('deadline');
    const lastChecked = date('lastChecked');
    const recheck = needsRecheck(lastChecked, today);

    // 注意（サイトには出す）
    if (recheck) add('warning', 'lastChecked', lastChecked ? `最終確認から90日を過ぎている（${lastChecked}）` : '最終確認日が空');
    if (!tags.length && !text('tags')) add('warning', 'tags', '未入力');
    if (!grades.length && !text('grades')) add('warning', 'grades', '未入力');
    if (!route && !text('route')) add('warning', 'route', '未入力');
    if (!regionBlock && !text('regionBlock')) add('warning', 'regionBlock', '未入力（地方ブロックで絞り込むと出てこない）');

    issues.push(...rowIssues);
    if (rowIssues.some((x) => x.level === 'error')) return;

    programs.push({
      id,
      category: category!,
      name: text('name'),
      organizer: text('organizer'),
      tags,
      grades,
      target: text('target'),
      period: text('period'),
      deadlineText: text('deadlineText'),
      deadline,
      status: recruitStatus(deadline, statusOverride, today),
      cost: text('cost'),
      area: text('area'),
      region: text('region'),
      regionBlock,
      selection: text('selection'),
      route,
      depth: judgeDepth([hasOutput, hasMentor, overMonth]),
      depthCriteria: { hasOutput, hasMentor, overMonth },
      confirm: confirm!,
      sourceUrl,
      officialUrl,
      lastChecked,
      needsRecheck: recheck,
    });
  });

  programs.sort((a, b) => a.id - b.id);
  return result(programs, {
    rows: rowCount,
    publishRequested,
    published: programs.length,
    skipped: publishRequested - programs.length,
  });
}
