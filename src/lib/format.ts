// 表示用の文字列。ページとカードで共通に使う。
import type { Program } from './schema.ts';
import data from '../data/programs.json';

export const SITE_NAME = 'ミチシルベ';
export const generatedOn: string = data.generatedOn;
export const programs = data.programs as Program[];

/** base（GitHub Pages のリポジトリ名）を付けたパス */
export const url = (path: string) => `${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`;

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** 2026-12-04 → 2026年12月4日（金） */
export function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WEEKDAYS[d.getUTCDay()]}）`;
}

/** 2026-12-04 → 12/4（今年以外は 2027/1/7） */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const md = `${m}/${d}`;
  return y === Number(generatedOn.slice(0, 4)) ? md : `${y}/${md}`;
}

/** 2026-10-28 → 2026/10/28 */
export const slashDate = (iso: string) => iso.replaceAll('-', '/');

/** カード右上の締切表示 */
export function deadlineLabel(p: Program): { text: string; tone: Program['status'] } {
  switch (p.status) {
    case 'closed': return { text: '募集終了', tone: 'closed' };
    case 'rolling': return { text: '随時募集', tone: 'rolling' };
    case 'open': return { text: `締切 ${shortDate(p.deadline!)}`, tone: 'open' };
    default: return { text: '締切は詳細を確認', tone: 'unknown' };
  }
}

/** 締切が近い順。締切のないもの → 終了したもの の順に後ろへ */
export function byDeadline(a: Program, b: Program): number {
  const rank = (p: Program) => (p.status === 'closed' ? 3 : p.status === 'open' ? 0 : p.status === 'rolling' ? 1 : 2);
  return rank(a) - rank(b) || (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || a.id - b.id;
}

export const DEPTH_HELP = {
  体験: '成果物・指導者・1か月以上のうち0〜1つ。短い参加で雰囲気を知る',
  実践: '成果物・指導者・1か月以上のうち2つ',
  深入: '成果物・指導者・1か月以上の3つがそろう',
  判定不能: '公式の情報だけでは判断できない',
} as const;

export const CRITERIA = [
  ['hasOutput', '成果物（発表・作品・報告など）'],
  ['hasMentor', '指導者・メンター'],
  ['overMonth', '1か月以上続く'],
] as const;
