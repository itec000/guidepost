// 発見元（scripts/sources.ts）の一覧ページを読み、新しいリンクを表格の「候補」タブの末尾に足す。
//
//   SHEET_ID=... GOOGLE_SERVICE_ACCOUNT_KEY='...' MONITOR_INFO_URL=https://.../about/#bot npm run discover
//
// - DISCOVER_DRY_RUN=1 … 表格に書かず .cache/discover-result.json に出す（前回分は .cache/discover-state.json）
// - BUILD_DATE=YYYY-MM-DD … 今日の日付を差し替える（テスト用）
//
// 書くのは「候補」タブへの追記と「発見の記録」タブだけ。「掲載データ」「除外」は読むだけ。
// Actions のログは公開されるので、発見元ごとの件数だけを出す（見つけた項目の名前は出さない）。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { todayJst } from '../src/lib/derive.ts';
import { decodeBody } from '../src/lib/monitor.ts';
import {
  CANDIDATE_HEADER, CANDIDATE_SHEET, STATE_HEADER, STATE_SHEET, candidateToCells, collectExisting, extractLinks,
  failedSource, judgeSource, normalizeUrl, parseStates, stateFormatRequests, stateToCells,
  type Cell, type SourceOutcome, type SourceState,
} from '../src/lib/discover.ts';
import { SOURCES } from './sources.ts';
import { getPage, isHtml, sheetTabs, sheetsApi as api, sheetsClient, type Client } from './lib/web.ts';

const DRY_RUN = Boolean(process.env.DISCOVER_DRY_RUN);
const CACHE_DIR = new URL('../.cache/', import.meta.url);
const STATE_FILE = new URL('discover-state.json', CACHE_DIR);
const RESULT_FILE = new URL('discover-result.json', CACHE_DIR);
const READ_TABS = ['掲載データ', CANDIDATE_SHEET, '除外'] as const;

async function readSheet(client: Client, sheetId: string) {
  const tabs = await sheetTabs(client, sheetId);
  const stateTabId = tabs.get(STATE_SHEET) ?? null;
  const params = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' });
  for (const name of READ_TABS) params.append('ranges', name);
  if (stateTabId !== null) params.append('ranges', STATE_SHEET);
  const res = await client.request<{ valueRanges: { values?: Cell[][] }[] }>({ url: api(sheetId, `/values:batchGet?${params}`) });
  const values = res.data.valueRanges.map((v) => v.values ?? []);
  return { existingTabs: values.slice(0, READ_TABS.length), candidates: values[1]!, state: stateTabId !== null ? values[3]! : [], stateTabId };
}

async function appendCandidates(client: Client, sheetId: string, rows: string[][]) {
  if (rows.length === 0) return;
  // RAW: 外部サイトの文字が「=」で始まっても数式として動かないように
  await client.request({
    url: api(sheetId, `/values/${encodeURIComponent(`${CANDIDATE_SHEET}!A:J`)}:append?valueInputOption=RAW&insertDataOption=OVERWRITE`),
    method: 'POST',
    data: { values: rows },
  });
}

async function writeState(client: Client, sheetId: string, states: SourceState[], existingTabId: number | null) {
  let tabId = existingTabId;
  if (tabId === null) {
    const res = await client.request<{ replies: { addSheet: { properties: { sheetId: number } } }[] }>({
      url: api(sheetId, ':batchUpdate'), method: 'POST',
      data: { requests: [{ addSheet: { properties: { title: STATE_SHEET } } }] },
    });
    tabId = res.data.replies[0]!.addSheet.properties.sheetId;
  }
  const range = encodeURIComponent(STATE_SHEET);
  await client.request({ url: api(sheetId, `/values/${range}:clear`), method: 'POST' });
  await client.request({
    url: api(sheetId, `/values/${range}!A1?valueInputOption=RAW`), method: 'PUT',
    data: { values: [[...STATE_HEADER], ...states.map(stateToCells)] },
  });
  await client.request({ url: api(sheetId, ':batchUpdate'), method: 'POST', data: { requests: stateFormatRequests(tabId) } });
}

async function main() {
  const sheetId = process.env.SHEET_ID;
  if (!sheetId) throw new Error('SHEET_ID が未設定');
  const today = todayJst();
  const client = await sheetsClient(DRY_RUN);
  const sheet = await readSheet(client, sheetId);

  // 「候補」の見出しが変わっていたら、列がずれて書き込まないよう止める
  const header = (sheet.candidates[0] ?? []).map((h) => String(h).trim());
  if (CANDIDATE_HEADER.some((h, i) => header[i] !== h)) {
    throw new Error(`「${CANDIDATE_SHEET}」の見出しが想定と違う（${CANDIDATE_HEADER.join(' / ')}）`);
  }
  if (sheet.existingTabs[0]!.length < 2) throw new Error('「掲載データ」を読めなかった');

  const existing = collectExisting(sheet.existingTabs);
  const prevStates = DRY_RUN
    ? new Map((JSON.parse(await readFile(STATE_FILE, 'utf-8').catch(() => '[]')) as SourceState[]).map((s) => [s.name, s]))
    : parseStates(sheet.state);

  const outcomes: SourceOutcome[] = [];
  for (const source of SOURCES) {
    const prev = prevStates.get(source.name);
    const page = await getPage(source.url);
    let outcome: SourceOutcome;
    if (page.kind !== 'page') outcome = failedSource(source, prev, page.detail, today);
    else if (!isHtml(page.contentType, page.bytes)) outcome = failedSource(source, prev, 'HTML ではない', today);
    else {
      const links = extractLinks(decodeBody(page.bytes, page.contentType), page.finalUrl, source);
      outcome = judgeSource(source, links, prev, existing, today);
    }
    // 同じ回のなかで、別の発見元から同じ項目が出ても1回だけにする
    for (const c of outcome.candidates) existing.urls.add(normalizeUrl(c.url));
    outcomes.push(outcome);
    console.log(`${source.name}: ${outcome.state.result}`);
  }

  const rows = outcomes.flatMap((o, i) => o.candidates.map((c) => candidateToCells(c, SOURCES[i]!, today)));
  const states = outcomes.map((o) => o.state);
  console.log(`発見元 ${SOURCES.length} 件、新しい候補 ${rows.length} 件`);

  if (DRY_RUN) {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(STATE_FILE, JSON.stringify(states, null, 2));
    await writeFile(RESULT_FILE, JSON.stringify(rows, null, 2));
    console.log('DISCOVER_DRY_RUN のため表格には書かず、.cache/discover-result.json に保存');
  } else {
    // 先に候補を足す。記録の更新に失敗しても、次回は「候補」にある URL として除かれるので重複しない
    await appendCandidates(client, sheetId, rows);
    await writeState(client, sheetId, states, sheet.stateTabId);
    console.log(`「${CANDIDATE_SHEET}」に ${rows.length} 行を追加し、「${STATE_SHEET}」を更新`);
  }
}

await main();
