// .cache/sheet.json（npm run fetch の出力）を検証して、サイト用のデータを作る。
//
//   src/data/programs.json   公開する行・公開する列だけ。リポジトリに入れてよい
//   .cache/build-report.json 検証結果の全件（表格への書き戻し・通知用）
//
// 表格の構造が壊れている、または公開できる行が 0 件のときは終了コード 1（サイトを更新しない）。
// ログは公開リポジトリの Actions で誰でも見られるので、内部メモなど公開しない列の値は出さない。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { todayJst } from '../src/lib/derive.ts';
import { validateSheet, type Cell, type Issue } from '../src/lib/validate.ts';

const SHEET = new URL('../.cache/sheet.json', import.meta.url);
const REPORT = new URL('../.cache/build-report.json', import.meta.url);
const DATA_DIR = new URL('../src/data/', import.meta.url);
const OUT = new URL('programs.json', DATA_DIR);

const LABEL = { fatal: '停止', error: '× 非掲載', warning: '△ 注意' } as const;

function formatIssue(i: Issue): string {
  const where = [i.row && `${i.row}行目`, i.id !== undefined && i.id !== '' && `ID ${i.id}`, i.column]
    .filter(Boolean)
    .join(' ');
  return `[${LABEL[i.level]}] ${where ? `${where}: ` : ''}${i.message}`;
}

async function main() {
  const sheet = JSON.parse(await readFile(SHEET, 'utf-8')) as Record<string, Cell[][]>;
  const today = todayJst();
  const { programs, issues, counts } = validateSheet(sheet['掲載データ'] ?? [], today);

  if (!issues.some((i) => i.level === 'fatal') && programs.length === 0) {
    issues.push({ level: 'fatal', message: '公開できる行が 0 件（誤操作の可能性があるので更新しない）' });
  }
  const fatal = issues.some((i) => i.level === 'fatal');

  await writeFile(REPORT, JSON.stringify({ date: today, counts, issues, ok: !fatal }, null, 1));
  for (const i of issues) console.log(formatIssue(i));
  console.log(
    `${today}: ${counts.rows} 行中「公開」${counts.publishRequested} 件 → 掲載 ${counts.published} 件・` +
      `非掲載 ${counts.skipped} 件、注意 ${issues.filter((i) => i.level === 'warning').length} 件`,
  );

  if (fatal) {
    console.error('表格に直す必要がある問題があるため、サイトは更新しない');
    process.exit(1);
  }
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(OUT, JSON.stringify({ generatedOn: today, programs }, null, 1) + '\n');
}

await main();
