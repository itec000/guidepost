# ミチシルベ（仮称）

高校生向けの探究・体験の機会をまとめた静態サイト。データの正本は Google 表格で、GitHub Actions が毎日読み込んで GitHub Pages に公開する。

```
Google 表格 →（サービスアカウントで読む）→ 検証 → 公開する行・列だけ src/data/programs.json → Astro → GitHub Pages
```

## コマンド

| コマンド | 内容 |
|---|---|
| `npm run fetch` | 表格を読んで `.cache/sheet.json` に保存（`SHEET_ID` がなければローカルの fixture） |
| `npm run data` | 検証して `src/data/programs.json` を作る。結果の全件は `.cache/build-report.json` |
| `npm run build:all` | fetch → data → build |
| `npm run dev` | 開発サーバー（http://localhost:4321） |
| `npm test` | 検証・自動計算のテスト |

`.cache/` には内部メモを含む表格の生データが入るので、リポジトリに入れない。

## 検証の方針

- 表格の構造が壊れている（見出しの欠落・重複）、または公開できる行が 0 件 → ビルドを止める
- 「公開」の行に公開基準を満たさない問題がある → その行だけ載せない
- 注意（最終確認から90日超、未入力の項目）→ 載せたうえで知らせる

## 公開の設定（GitHub）

- Settings → Pages → Source: **GitHub Actions**
- Settings → Secrets and variables → Actions
  - Variables: `SHEET_ID`（表格の URL の `/d/` と `/edit` の間）
  - Secrets: `GOOGLE_SERVICE_ACCOUNT_KEY`（サービスアカウントの鍵 JSON の中身）
- 表格の「サイトを更新」ボタン: `apps-script/Code.gs` の説明を参照
