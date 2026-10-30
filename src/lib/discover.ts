// 阶段 6「新しい項目の発見」の判定ロジック（ネットワークや表格に触れない部分）。
//
// やり方: 決めた一覧ページ（発見元）を週1回読み、前回までに見たことのない詳細ページへのリンクを
// 「候補」タブの末尾に足す。足すだけで、既存の行・掲載データは変更しない。判断は人が行う。
import { createHash } from 'node:crypto';
import { htmlToLines } from './monitor.ts';

export type Cell = string | number | boolean;

export interface Source {
  name: string;
  /** 読む一覧ページ */
  url: string;
  /** 詳細ページへのリンクだけを拾うための条件（URL 全体に対して） */
  link: RegExp;
  /** リンクの文字にこれが含まれるものだけを候補にする（なければ全部） */
  include?: RegExp;
  /** リンクの文字にこれが含まれるものは候補にしない（小学生限定など） */
  exclude?: RegExp;
  /** include/exclude を名前ではなくリンクの中の文字全部（カードのタグ・説明など）に当てる */
  matchCard?: boolean;
  /** 一覧ページではなく RSS を読む（サイトが自動チェック用に RSS を案内している場合） */
  feed?: boolean;
}

export interface FoundLink {
  url: string;
  title: string;
}

export const STATE_SHEET = '発見の記録';
export const STATE_HEADER = ['発見元', '一覧URL', '最終確認日', '結果', '今回の候補', '既知のリンク（自動・編集しない）'] as const;
export const CANDIDATE_SHEET = '候補';
export const CANDIDATE_HEADER = ['名称', '主催', '実施場所', '期間', '費用', '出典URL', '見つけた日', '見つけた方法', '状態', 'メモ'] as const;

/** 1回に1つの発見元から候補にする上限。超えたらページの作りが変わった可能性が高いので、候補にせず知らせる */
export const MAX_NEW_PER_SOURCE = 15;
/** 既知のリンクとして覚えておく数の上限（セルの上限5万文字に収める） */
const MAX_KNOWN = 4000;

// ---------------------------------------------------------------- リンク

/** 重複判定用：http/https、www. の有無、末尾の /、# 以降、utm_ パラメータの違いは同じとみなす */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) if (key.startsWith('utm_')) u.searchParams.delete(key);
    const host = u.hostname.replace(/^www\./, '');
    return `https://${host}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return raw.trim();
  }
}

/** 名前の重複判定用：全角半角・空白・記号の違いを無視する */
export const normalizeName = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s・、。,.!！?？「」『』()（）【】\[\]"'"]/g, '');

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decodeAttr = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e: string) => {
  if (e[0] !== '#') return ENTITY[e.toLowerCase()] ?? all;
  const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
});

const plain = (html: string) => htmlToLines(`<p>${html}</p>`, { keepBoilerplate: true }).join(' ');

/**
 * リンクの名前。カード全体がリンクになっているサイトでは、日付や説明文まで入ってしまうので、
 * 中に見出し（h1〜h6）や class に title を含む要素があればそれを使う。文字がなければ画像の alt
 */
function linkTitle(inner: string): { title: string; quality: number } {
  const heading = inner.match(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1\s*>/i)?.[2]
    ?? inner.match(/<(\w+)\b[^>]*\bclass\s*=\s*["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/\1\s*>/i)?.[2];
  if (heading && plain(heading)) return { title: plain(heading), quality: 3 };
  const text = plain(inner);
  if (text) return { title: text, quality: 2 };
  const alt = inner.match(/<img\b[^>]*\balt\s*=\s*["']([^"']+)["']/i)?.[1];
  return alt ? { title: decodeAttr(alt).normalize('NFKC').trim(), quality: 1 } : { title: '', quality: 0 };
}

type Found = FoundLink & { quality: number; card: string };

const wanted = (source: Pick<Source, 'include' | 'exclude'>) => (l: Found) =>
  (!source.include || source.include.test(l.card)) && !(source.exclude && source.exclude.test(l.card));

const done = (found: Map<string, Found>, source: Pick<Source, 'include' | 'exclude'>): FoundLink[] =>
  [...found.values()].filter(wanted(source)).map(({ url, title }) => ({ url, title }));

/** 候補に書く URL から utm_ パラメータ（アクセス解析用）を外す */
function withoutTracking(raw: string): string {
  try {
    const u = new URL(raw);
    for (const key of [...u.searchParams.keys()]) if (key.startsWith('utm_')) u.searchParams.delete(key);
    return u.href;
  } catch {
    return raw;
  }
}

/** 一覧ページから、条件に合う詳細ページへのリンクを順番どおりに拾う。同じ URL へのリンクが複数あれば、一番名前らしいものを使う */
export function extractLinks(
  html: string, baseUrl: string, source: Pick<Source, 'link' | 'include' | 'exclude' | 'matchCard' | 'feed'>,
): FoundLink[] {
  const found = new Map<string, Found>();
  if (source.feed) {
    // RSS 2.0 の <item><title>…</title><link>…</link></item>
    const text = (s: string | undefined) => decodeAttr((s ?? '').replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')).trim();
    for (const item of html.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
      const url = withoutTracking(text(item[0].match(/<link>([\s\S]*?)<\/link>/i)?.[1]));
      const title = text(item[0].match(/<title>([\s\S]*?)<\/title>/i)?.[1]).normalize('NFKC').slice(0, 200);
      if (url && source.link.test(url) && !found.has(normalizeUrl(url))) found.set(normalizeUrl(url), { url, title, quality: 3, card: title });
    }
    return done(found, source);
  }
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi)) {
    const href = decodeAttr(m[1] ?? m[2] ?? m[3] ?? '');
    let url: string;
    try {
      url = withoutTracking(new URL(href, baseUrl).href);
    } catch {
      continue;
    }
    if (!source.link.test(url)) continue;
    const { title, quality } = linkTitle(m[4] ?? '');
    const key = normalizeUrl(url);
    const before = found.get(key);
    if (!before || quality > before.quality || (quality === before.quality && title.length > before.title.length)) {
      const card = source.matchCard ? `${before?.card ?? ''} ${plain(m[4] ?? '')}` : title;
      found.set(key, { url: before?.url ?? url, title: title.slice(0, 200), quality, card });
    } else if (source.matchCard) {
      before.card += ` ${plain(m[4] ?? '')}`;
    }
  }
  return done(found, source);
}

const linkHash = (url: string) => createHash('sha256').update(normalizeUrl(url)).digest('hex').slice(0, 10);
export const parseKnown = (cell: string) => new Set(cell.match(/.{10}/g) ?? []);
export const serializeKnown = (known: Set<string>) => [...known].slice(-MAX_KNOWN).join('');

// ---------------------------------------------------------------- 判定

export interface Existing {
  urls: Set<string>; // normalizeUrl 済み
  names: Set<string>; // normalizeName 済み
}

/** 掲載データ・候補・除外にすでにある URL と名称を集める */
export function collectExisting(tabs: Cell[][][]): Existing {
  const urls = new Set<string>();
  const names = new Set<string>();
  for (const rows of tabs) {
    const header = (rows[0] ?? []).map((h) => String(h).trim());
    const urlCols = header.flatMap((h, i) => (/URL|再確認先/.test(h) ? [i] : []));
    const nameCol = header.indexOf('名称');
    for (const r of rows.slice(1)) {
      for (const i of urlCols) {
        const v = String(r[i] ?? '').trim();
        if (/^https?:\/\//.test(v)) urls.add(normalizeUrl(v));
      }
      const name = nameCol >= 0 ? String(r[nameCol] ?? '').trim() : '';
      if (name) names.add(normalizeName(name));
    }
  }
  return { urls, names };
}

export interface SourceState {
  name: string;
  url: string;
  checkedOn: string;
  result: string;
  newCount: number;
  known: string; // linkHash を並べたもの
}

export interface SourceOutcome {
  state: SourceState;
  candidates: FoundLink[];
}

/**
 * 1つの発見元の結果を決める。
 * - 初回（記録がない）: 今あるリンクを全部「既知」として覚えるだけ。候補にはしない（過去の記事が大量に入るのを防ぐ）
 * - 2回目以降: 既知でないリンクのうち、掲載データ・候補・除外にないものを候補にする
 */
export function judgeSource(
  source: Source, links: FoundLink[], prev: SourceState | undefined, existing: Existing, today: string,
): SourceOutcome {
  const known = parseKnown(prev?.known ?? '');
  const base = { name: source.name, url: source.url, checkedOn: today };
  const remember = () => {
    for (const l of links) {
      const h = linkHash(l.url);
      known.delete(h); // 最近見たものを後ろに（上限で古いものから忘れる）
      known.add(h);
    }
    return serializeKnown(known);
  };

  if (links.length === 0) {
    return {
      state: { ...base, result: '対象のリンクが 0 件（ページの作りが変わった可能性。発見元の設定を見直す）', newCount: 0, known: prev?.known ?? '' },
      candidates: [],
    };
  }
  if (!prev?.known) {
    return { state: { ...base, result: `初回：${links.length} 件のリンクを記録（候補にはしない）`, newCount: 0, known: remember() }, candidates: [] };
  }

  const unseen = links.filter((l) => !known.has(linkHash(l.url)));
  const fresh = unseen.filter((l) => !existing.urls.has(normalizeUrl(l.url)) && !existing.names.has(normalizeName(l.title)));
  if (fresh.length > MAX_NEW_PER_SOURCE) {
    return {
      state: { ...base, result: `新しいリンクが ${fresh.length} 件と多すぎるため候補にしなかった（ページの作りが変わった可能性）`, newCount: 0, known: remember() },
      candidates: [],
    };
  }
  const skipped = unseen.length - fresh.length;
  return {
    state: {
      ...base,
      result: `一覧 ${links.length} 件、新しい候補 ${fresh.length} 件${skipped ? `（登録済み ${skipped} 件は除いた）` : ''}`,
      newCount: fresh.length,
      known: remember(),
    },
    candidates: fresh,
  };
}

/** 発見元を読めなかったとき：既知のリンクは前回のまま残す */
export const failedSource = (source: Source, prev: SourceState | undefined, detail: string, today: string): SourceOutcome => ({
  state: { name: source.name, url: source.url, checkedOn: today, result: `読めなかった：${detail}`, newCount: 0, known: prev?.known ?? '' },
  candidates: [],
});

// ---------------------------------------------------------------- 表格の行

export function parseStates(rows: Cell[][]): Map<string, SourceState> {
  const map = new Map<string, SourceState>();
  const header = (rows[0] ?? []).map((h) => String(h).trim());
  if (STATE_HEADER.some((h, i) => header[i] !== h)) return map;
  for (const r of rows.slice(1)) {
    const v = (i: number) => String(r[i] ?? '').trim();
    if (!v(0)) continue;
    map.set(v(0), { name: v(0), url: v(1), checkedOn: v(2), result: v(3), newCount: Number(v(4)) || 0, known: v(5) });
  }
  return map;
}

export const stateToCells = (s: SourceState): (string | number)[] => [s.name, s.url, s.checkedOn, s.result, s.newCount, s.known];

export const candidateToCells = (l: FoundLink, source: Source, today: string): string[] =>
  // 主催・実施場所・期間・費用は人が詳細ページを見て書く
  [l.title || '（名前を取得できなかった）', '', '', '', '', l.url, today, 'プログラム', '未確認', `発見元：${source.name}`];

/** 「発見の記録」タブの見た目（Sheets API batchUpdate の requests） */
export function stateFormatRequests(tabId: number) {
  const widths = [160, 320, 100, 420, 90, 0];
  return [
    { updateSheetProperties: { properties: { sheetId: tabId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
    ...widths.map((px, i) => ({
      updateDimensionProperties: {
        range: { sheetId: tabId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
        properties: px ? { pixelSize: px, hiddenByUser: false } : { hiddenByUser: true },
        fields: px ? 'pixelSize,hiddenByUser' : 'hiddenByUser',
      },
    })),
    {
      repeatCell: {
        range: { sheetId: tabId, startColumnIndex: 0, endColumnIndex: 6, startRowIndex: 0 },
        cell: { userEnteredFormat: { verticalAlignment: 'TOP', wrapStrategy: 'WRAP' } },
        fields: 'userEnteredFormat(verticalAlignment,wrapStrategy)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: tabId, startColumnIndex: 0, endColumnIndex: 6, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.93, green: 0.94, blue: 0.96 } } },
        fields: 'userEnteredFormat(textFormat.bold,backgroundColor)',
      },
    },
  ];
}
