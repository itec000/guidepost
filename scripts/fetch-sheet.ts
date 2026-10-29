// Google 表格の生データを .cache/sheet.json に保存する。
//
// 表格に接続する場合（GitHub Actions・本番）:
//   SHEET_ID=<表格のID> GOOGLE_SERVICE_ACCOUNT_KEY='<鍵JSONの中身>' npm run fetch
//   （鍵はファイルでもよい: GOOGLE_APPLICATION_CREDENTIALS=path/to/key.json）
// SHEET_ID がなければ .cache/sheet-fixture.json（scripts/export_fixture.py で作る）を使う。
//
// 出力は Sheets API の values.batchGet と同じ形: { シート名: 行の配列 }。
// 日付はシリアル値のまま。解釈と検証は次の段階（build-data）で行う。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { GoogleAuth } from 'google-auth-library';

export const SHEETS = ['掲載データ', '候補', '除外'] as const;
export type Cell = string | number | boolean;
export type SheetData = Record<(typeof SHEETS)[number], Cell[][]>;

const CACHE_DIR = new URL('../.cache/', import.meta.url);
const OUT = new URL('sheet.json', CACHE_DIR);
const FIXTURE = new URL('sheet-fixture.json', CACHE_DIR);

async function fetchFromApi(sheetId: string): Promise<SheetData> {
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    ...(key ? { credentials: JSON.parse(key) } : {}),
  });
  const client = await auth.getClient();
  const params = new URLSearchParams({
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
  });
  for (const name of SHEETS) params.append('ranges', name);
  const res = await client.request<{ valueRanges: { values?: Cell[][] }[] }>({
    url: `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchGet?${params}`,
  });
  return Object.fromEntries(
    SHEETS.map((name, i) => [name, res.data.valueRanges[i]?.values ?? []]),
  ) as SheetData;
}

async function main() {
  const sheetId = process.env.SHEET_ID;
  let data: SheetData;
  if (sheetId) {
    data = await fetchFromApi(sheetId);
    console.log(`fetched sheet ${sheetId}`);
  } else if (process.env.CI) {
    // GitHub Actions で SHEET_ID を設定し忘れたとき、古いデータで公開しないように止める
    throw new Error('SHEET_ID が未設定（リポジトリの Settings → Variables に登録する）');
  } else {
    data = JSON.parse(await readFile(FIXTURE, 'utf-8'));
    console.log('SHEET_ID が未設定のため、ローカルの fixture を使用');
  }
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(OUT, JSON.stringify(data));
  console.log(SHEETS.map((s) => `${s}: ${Math.max(data[s].length - 1, 0)} 行`).join(', '));
}

await main();
