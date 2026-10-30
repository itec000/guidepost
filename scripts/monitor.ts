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
import { todayJst } from '../src/lib/derive.ts';
import {
  RESULT_HEADER, RESULT_SHEET, buildTargets, carryOver, decodeBody, fingerprintBytes, fingerprintLines, formatRequests,
  htmlToLines, isDue, judge, parseResults, resultToCells, sortResults, targetKey,
  type Cell, type FetchOutcome, type ResultRow, type Target,
} from '../src/lib/monitor.ts';
import { getPage, isHtml, sheetTabs, sheetsApi as api, sheetsClient, type Client } from './lib/web.ts';

const SOURCE_SHEET = '掲載データ';

const DRY_RUN = Boolean(process.env.MONITOR_DRY_RUN);
const CHECK_ALL = Boolean(process.env.MONITOR_ALL);
const CACHE_DIR = new URL('../.cache/', import.meta.url);
const RESULT_FILE = new URL('monitor-result.json', CACHE_DIR);

// ---------------------------------------------------------------- 表格

async function readSheet(client: Client, sheetId: string) {
  const tabId = (await sheetTabs(client, sheetId)).get(RESULT_SHEET) ?? null;
  const params = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' });
  params.append('ranges', SOURCE_SHEET);
  if (tabId !== null) params.append('ranges', RESULT_SHEET);
  const res = await client.request<{ valueRanges: { values?: Cell[][] }[] }>({ url: api(sheetId, `/values:batchGet?${params}`) });
  return {
    source: res.data.valueRanges[0]?.values ?? [],
    results: tabId !== null ? res.data.valueRanges[1]?.values ?? [] : [],
    tabId,
  };
}

async function writeSheet(client: Client, sheetId: string, rows: ResultRow[], existingTabId: number | null) {
  let tabId = existingTabId;
  if (tabId === null) {
    const res = await client.request<{ replies: { addSheet: { properties: { sheetId: number } } }[] }>({
      url: api(sheetId, ':batchUpdate'), method: 'POST',
      data: { requests: [{ addSheet: { properties: { title: RESULT_SHEET } } }] },
    });
    tabId = res.data.replies[0]!.addSheet.properties.sheetId;
  }
  const range = encodeURIComponent(RESULT_SHEET);
  await client.request({ url: api(sheetId, `/values/${range}:clear`), method: 'POST' });
  // RAW: 人が書いたメモが「=」で始まっても数式にしない
  await client.request({
    url: api(sheetId, `/values/${range}!A1?valueInputOption=RAW`), method: 'PUT',
    data: { values: [[...RESULT_HEADER], ...rows.map(resultToCells)] },
  });
  await client.request({ url: api(sheetId, ':batchUpdate'), method: 'POST', data: { requests: formatRequests(tabId) } });
}

// ---------------------------------------------------------------- アクセス

async function check(t: Target): Promise<FetchOutcome> {
  const page = await getPage(t.url);
  if (page.kind !== 'page') return page;
  if (isHtml(page.contentType, page.bytes)) {
    const html = decodeBody(page.bytes, page.contentType);
    const lines = htmlToLines(html);
    const fullLines = htmlToLines(html, { keepBoilerplate: true });
    return { kind: 'page', finalUrl: page.finalUrl, lines, fullLines, fingerprint: fingerprintLines(lines) };
  }
  return { kind: 'page', finalUrl: page.finalUrl, lines: null, fingerprint: fingerprintBytes(page.bytes) };
}

// ---------------------------------------------------------------- 本体

async function main() {
  const sheetId = process.env.SHEET_ID;
  if (!sheetId) throw new Error('SHEET_ID が未設定');
  const today = todayJst();
  const client = await sheetsClient(DRY_RUN);
  const { source, results, tabId } = await readSheet(client, sheetId);

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
    await writeSheet(client, sheetId, sorted, tabId);
    console.log(`表格の「${RESULT_SHEET}」タブを更新`);
  }
}

await main();
