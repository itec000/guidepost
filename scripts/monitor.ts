// 掲載中の項目の出典・公式ページを確認し、結果を表格の「チェック結果」タブに書く。
//
//   SHEET_ID=... GOOGLE_SERVICE_ACCOUNT_KEY='...' MONITOR_INFO_URL=https://.../about/#bot npm run monitor
//
// - MONITOR_DRY_RUN=1 … 表格に書かず .cache/monitor-result.json に出す（ローカルで試すとき。前回分もこのファイルから読む）
// - MONITOR_ALL=1 …… 前回からの日数に関係なく全部確認する
// - BUILD_DATE=YYYY-MM-DD … 今日の日付を差し替える（テスト用）
//
// 書くのは「チェック結果」タブだけ。「掲載データ」は読むだけで変更しない。
// アクセスの作法: 1件ずつ順番に、間隔をあけて、robots.txt に従い、429/503 なら引き下がる。
// Actions のログは公開されるので、ID と結果の種類だけを出す（名称・内部メモは出さない）。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { GoogleAuth } from 'google-auth-library';
import { todayJst } from '../src/lib/derive.ts';
import {
  RESULT_HEADER, RESULT_SHEET, buildTargets, carryOver, decodeBody, fingerprintBytes, fingerprintLines,
  htmlToLines, isDue, judge, parseResults, parseRobots, resultToCells, robotsAllows, sortResults, targetKey,
  type Cell, type FetchOutcome, type ResultRow, type RobotsRules, type Target,
} from '../src/lib/monitor.ts';

const SOURCE_SHEET = '掲載データ';
const BOT = 'MichishirubeBot';
const INFO_URL = process.env.MONITOR_INFO_URL;
if (!INFO_URL && process.env.CI) throw new Error('MONITOR_INFO_URL が未設定（User-Agent に載せる説明ページ）');
const USER_AGENT = `${BOT}/0.1 (+${INFO_URL ?? 'local test'})`;

const GAP_MS = 4_000; // どのサイトでも、前のアクセスから最低これだけあける
const MAX_CRAWL_DELAY_S = 60; // robots.txt の Crawl-delay がこれより長いサイトは自動確認しない
const MAX_RETRY_AFTER_S = 120;
const TIMEOUT_MS = 30_000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;

const DRY_RUN = Boolean(process.env.MONITOR_DRY_RUN);
const CHECK_ALL = Boolean(process.env.MONITOR_ALL);
const CACHE_DIR = new URL('../.cache/', import.meta.url);
const RESULT_FILE = new URL('monitor-result.json', CACHE_DIR);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 表格

async function sheetsClient() {
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const scope = DRY_RUN ? 'spreadsheets.readonly' : 'spreadsheets';
  const auth = new GoogleAuth({
    scopes: [`https://www.googleapis.com/auth/${scope}`],
    ...(key ? { credentials: JSON.parse(key) } : {}),
  });
  return auth.getClient();
}
type Client = Awaited<ReturnType<typeof sheetsClient>>;
const api = (sheetId: string, path = '') => `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}${path}`;

async function readSheet(client: Client, sheetId: string) {
  const meta = await client.request<{ sheets: { properties: { title: string } }[] }>({
    url: api(sheetId, '?fields=sheets.properties.title'),
  });
  const hasResults = meta.data.sheets.some((s) => s.properties.title === RESULT_SHEET);
  const params = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' });
  params.append('ranges', SOURCE_SHEET);
  if (hasResults) params.append('ranges', RESULT_SHEET);
  const res = await client.request<{ valueRanges: { values?: Cell[][] }[] }>({ url: api(sheetId, `/values:batchGet?${params}`) });
  return {
    source: res.data.valueRanges[0]?.values ?? [],
    results: hasResults ? res.data.valueRanges[1]?.values ?? [] : [],
    hasResults,
  };
}

async function writeSheet(client: Client, sheetId: string, rows: ResultRow[], hasResults: boolean) {
  if (!hasResults) {
    await client.request({
      url: api(sheetId, ':batchUpdate'), method: 'POST',
      data: { requests: [{ addSheet: { properties: { title: RESULT_SHEET, gridProperties: { frozenRowCount: 1 } } } }] },
    });
  }
  const range = encodeURIComponent(RESULT_SHEET);
  await client.request({ url: api(sheetId, `/values/${range}:clear`), method: 'POST' });
  // RAW: 人が書いたメモが「=」で始まっても数式にしない
  await client.request({
    url: api(sheetId, `/values/${range}!A1?valueInputOption=RAW`), method: 'PUT',
    data: { values: [[...RESULT_HEADER], ...rows.map(resultToCells)] },
  });
}

// ---------------------------------------------------------------- アクセス

interface Host {
  robots: RobotsRules | 'deny';
  delayMs: number;
  lastAt: number;
  stopped?: string; // 429 などでこの回はもうアクセスしない理由
}
const hosts = new Map<string, Host>();
let lastRequestAt = 0;

async function politeFetch(url: URL, host: Host | null, redirect: RequestRedirect = 'manual'): Promise<Response> {
  const wait = Math.max(lastRequestAt + GAP_MS, (host?.lastAt ?? 0) + (host?.delayMs ?? 0)) - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  if (host) host.lastAt = lastRequestAt;
  return fetch(url, {
    redirect,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8',
      'accept-language': 'ja,en;q=0.5',
    },
  });
}

/** robots.txt は RFC 9309 に従う：4xx は制限なし、5xx・つながらない は全部禁止として扱う */
async function hostFor(url: URL): Promise<Host> {
  const known = hosts.get(url.origin);
  if (known) return known;
  const host: Host = { robots: 'deny', delayMs: GAP_MS, lastAt: 0 };
  hosts.set(url.origin, host);
  try {
    const res = await politeFetch(new URL('/robots.txt', url.origin), null, 'follow');
    host.lastAt = lastRequestAt;
    if (res.status >= 200 && res.status < 300) {
      host.robots = parseRobots(await res.text(), BOT);
    } else if (res.status >= 400 && res.status < 500) {
      host.robots = { rules: [], crawlDelay: null }; // 見つからない → 制限なし扱い
      await res.body?.cancel();
    } else {
      await res.body?.cancel();
    }
  } catch {
    // つながらない → deny のまま
  }
  if (host.robots !== 'deny' && host.robots.crawlDelay !== null) {
    if (host.robots.crawlDelay > MAX_CRAWL_DELAY_S) host.stopped = `robots.txt の Crawl-delay が ${host.robots.crawlDelay} 秒と長い`;
    host.delayMs = Math.max(GAP_MS, host.robots.crawlDelay * 1000);
  }
  return host;
}

async function readLimited(res: Response): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size >= MAX_BYTES) {
      await reader.cancel();
      break;
    }
  }
  return Buffer.concat(chunks);
}

const networkReason = (e: unknown): FetchOutcome => {
  const err = e as { name?: string; cause?: { code?: string } };
  if (err.name === 'TimeoutError') return { kind: 'blocked', detail: `${TIMEOUT_MS / 1000} 秒以内に応答がない` };
  if (err.cause?.code === 'ENOTFOUND') return { kind: 'broken', detail: 'ドメインが見つからない（サイトが閉鎖された可能性）' };
  return { kind: 'blocked', detail: `接続できない（${err.cause?.code ?? err.name ?? 'エラー'}）` };
};

async function check(t: Target): Promise<FetchOutcome> {
  let url: URL;
  try {
    url = new URL(t.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
  } catch {
    return { kind: 'broken', detail: 'URL の形式が正しくない' };
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const host = await hostFor(url);
    if (host.stopped) return { kind: 'blocked', detail: host.stopped };
    if (host.robots === 'deny') return { kind: 'blocked', detail: 'robots.txt を確認できない（サーバーエラーまたは接続できない）' };
    if (!robotsAllows(host.robots, url.pathname + url.search)) return { kind: 'blocked', detail: 'robots.txt で自動アクセスが禁止されている' };

    let res: Response;
    try {
      res = await politeFetch(url, host);
      if (res.status === 429 || res.status === 503) {
        const after = Number(res.headers.get('retry-after'));
        await res.body?.cancel();
        if (!(after > 0 && after <= MAX_RETRY_AFTER_S)) {
          host.stopped = `サーバーが混雑している（${res.status}）`;
          return { kind: 'blocked', detail: host.stopped };
        }
        await sleep(after * 1000);
        res = await politeFetch(url, host);
      }
    } catch (e) {
      return networkReason(e);
    }

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      await res.body?.cancel();
      url = new URL(res.headers.get('location')!, url);
      continue;
    }
    if (res.status === 404 || res.status === 410) {
      await res.body?.cancel();
      return { kind: 'broken', detail: `ページがない（${res.status}）` };
    }
    if (!res.ok) {
      await res.body?.cancel();
      if (res.status === 429 || res.status === 503) host.stopped = `サーバーが混雑している（${res.status}）`;
      return { kind: 'blocked', detail: `サーバーの応答が ${res.status}` };
    }

    let bytes: Uint8Array;
    try {
      bytes = await readLimited(res);
    } catch (e) {
      return networkReason(e);
    }
    const type = res.headers.get('content-type') ?? '';
    if (/html|xml/i.test(type) || (!type && /^\s*</.test(new TextDecoder().decode(bytes.subarray(0, 64))))) {
      const html = decodeBody(bytes, type);
      const lines = htmlToLines(html);
      const fullLines = htmlToLines(html, { keepBoilerplate: true });
      return { kind: 'page', finalUrl: url.href, lines, fullLines, fingerprint: fingerprintLines(lines) };
    }
    return { kind: 'page', finalUrl: url.href, lines: null, fingerprint: fingerprintBytes(bytes) };
  }
  return { kind: 'blocked', detail: 'リダイレクトが多すぎる' };
}

// ---------------------------------------------------------------- 本体

async function main() {
  const sheetId = process.env.SHEET_ID;
  if (!sheetId) throw new Error('SHEET_ID が未設定');
  const today = todayJst();
  const client = await sheetsClient();
  const { source, results, hasResults } = await readSheet(client, sheetId);

  const targets = buildTargets(source, today);
  if (targets.length === 0) throw new Error('確認する URL が 1 件もない（「掲載データ」の読み取りに失敗した可能性）');
  // 試すときは、表格の代わりに前回の .cache/monitor-result.json を「前回」として使う
  const prev = DRY_RUN
    ? new Map((JSON.parse(await readFile(RESULT_FILE, 'utf-8').catch(() => '[]')) as ResultRow[]).map((r) => [targetKey(r), r]))
    : parseResults(results);

  const out: ResultRow[] = [];
  let checked = 0;
  for (const t of targets) {
    const before = prev.get(targetKey(t));
    if (!CHECK_ALL && before && !isDue(t, before, today)) {
      out.push(carryOver(t, before));
      continue;
    }
    const row = judge(t, await check(t), before, today);
    out.push(row);
    checked++;
    console.log(`#${t.id} ${t.kind}: ${row.result}${row.action ? '（要対応）' : ''}`);
  }

  const sorted = sortResults(out);
  const actions = sorted.filter((r) => r.action).length;
  console.log(`確認 ${checked} 件 / 対象 ${targets.length} 件、要対応 ${actions} 件`);

  if (DRY_RUN) {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(RESULT_FILE, JSON.stringify(sorted, null, 2));
    console.log('MONITOR_DRY_RUN のため表格には書かず、.cache/monitor-result.json に保存');
  } else {
    await writeSheet(client, sheetId, sorted, hasResults);
    console.log(`表格の「${RESULT_SHEET}」タブを更新`);
  }
}

await main();
