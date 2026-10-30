// 監視（monitor.ts）と発見（discover.ts）で共通の、外部サイトへのアクセスと表格への接続。
//
// アクセスの作法: 1件ずつ順番に、どのサイトでも前のアクセスから4秒以上あける、
// robots.txt（Disallow・Crawl-delay）に従う、429/503 ならそのサイトはその回はもうアクセスしない。
import { GoogleAuth } from 'google-auth-library';
import { parseRobots, robotsAllows, type RobotsRules } from '../../src/lib/monitor.ts';

export const BOT = 'MichishirubeBot';
const INFO_URL = process.env.MONITOR_INFO_URL;
if (!INFO_URL && process.env.CI) throw new Error('MONITOR_INFO_URL が未設定（User-Agent に載せる説明ページ）');
const USER_AGENT = `${BOT}/0.1 (+${INFO_URL ?? 'local test'})`;

const GAP_MS = 4_000;
const MAX_CRAWL_DELAY_S = 60; // robots.txt の Crawl-delay がこれより長いサイトは自動で見ない
const MAX_RETRY_AFTER_S = 120;
export const TIMEOUT_MS = 30_000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 表格

export async function sheetsClient(readonly: boolean) {
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const auth = new GoogleAuth({
    scopes: [`https://www.googleapis.com/auth/spreadsheets${readonly ? '.readonly' : ''}`],
    ...(key ? { credentials: JSON.parse(key) } : {}),
  });
  return auth.getClient();
}
export type Client = Awaited<ReturnType<typeof sheetsClient>>;
export const sheetsApi = (sheetId: string, path = '') => `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}${path}`;

/** タブ名 → sheetId（数値） */
export async function sheetTabs(client: Client, sheetId: string): Promise<Map<string, number>> {
  const meta = await client.request<{ sheets: { properties: { title: string; sheetId: number } }[] }>({
    url: sheetsApi(sheetId, '?fields=sheets.properties(title,sheetId)'),
  });
  return new Map(meta.data.sheets.map((s) => [s.properties.title, s.properties.sheetId]));
}

// ---------------------------------------------------------------- アクセス

export type PageResult =
  | { kind: 'page'; finalUrl: string; contentType: string; bytes: Uint8Array }
  | { kind: 'broken'; detail: string }
  | { kind: 'blocked'; detail: string };

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

const networkReason = (e: unknown): PageResult => {
  const err = e as { name?: string; cause?: { code?: string } };
  if (err.name === 'TimeoutError') return { kind: 'blocked', detail: `${TIMEOUT_MS / 1000} 秒以内に応答がない` };
  if (err.cause?.code === 'ENOTFOUND') return { kind: 'broken', detail: 'ドメインが見つからない（サイトが閉鎖された可能性）' };
  return { kind: 'blocked', detail: `接続できない（${err.cause?.code ?? err.name ?? 'エラー'}）` };
};

/** robots.txt を守りながら1ページ取ってくる。リダイレクト先のサイトの robots.txt も確認する */
export async function getPage(rawUrl: string): Promise<PageResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
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

    try {
      return { kind: 'page', finalUrl: url.href, contentType: res.headers.get('content-type') ?? '', bytes: await readLimited(res) };
    } catch (e) {
      return networkReason(e);
    }
  }
  return { kind: 'blocked', detail: 'リダイレクトが多すぎる' };
}

/** HTML として扱うか（Content-Type がないときは中身の先頭で判断） */
export const isHtml = (contentType: string, bytes: Uint8Array) =>
  /html|xml/i.test(contentType) || (!contentType && /^\s*</.test(new TextDecoder().decode(bytes.subarray(0, 64))));
