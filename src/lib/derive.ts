// 表格の値から自動で決まる項目（表格の数式と同じ規則）。
import type { Depth, RecruitStatus, StatusOverride, YesNo } from './schema.ts';

export const RECHECK_DAYS = 90;

const tier = (points: number): Exclude<Depth, '判定不能'> =>
  points >= 3 ? '深入' : points === 2 ? '実践' : '体験';

/** あり=1点。不明を「あり」と見ても「なし」と見ても同じ段階なら確定、変わるなら判定不能。未入力も判定不能 */
export function judgeDepth(criteria: (YesNo | null)[]): Depth {
  if (criteria.some((c) => c === null)) return '判定不能';
  const low = criteria.filter((c) => c === 'あり').length;
  const high = low + criteria.filter((c) => c === '不明').length;
  return tier(low) === tier(high) ? tier(low) : '判定不能';
}

/** 締切日の当日までは募集中。手動の募集状況があればそちらを優先 */
export function recruitStatus(
  deadline: string | null,
  override: StatusOverride | null,
  today: string,
): RecruitStatus {
  if (override === '募集終了') return 'closed';
  if (override === '随時募集') return 'rolling';
  if (!deadline) return 'unknown';
  return deadline < today ? 'closed' : 'open';
}

export function needsRecheck(lastChecked: string | null, today: string): boolean {
  if (!lastChecked) return true;
  return daysBetween(lastChecked, today) > RECHECK_DAYS;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/** 日本時間の今日（YYYY-MM-DD）。BUILD_DATE があればそれを使う（テスト用） */
export function todayJst(env: Record<string, string | undefined> = process.env): string {
  if (env.BUILD_DATE) return env.BUILD_DATE;
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * セルの値を YYYY-MM-DD にする。Sheets API のシリアル値（1899-12-30 起点）と、
 * 文字列で入力された「2026-10-23」「2026/10/23」を受け付ける。解釈できなければ undefined
 */
export function parseDateCell(value: unknown): string | null | undefined {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000).toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    const m = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (!m) return undefined;
    const iso = `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
    const d = new Date(`${iso}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(iso) ? iso : undefined;
  }
  return undefined;
}
