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
| `npm run monitor` | 掲載中の項目のページを確認し、表格の「チェック結果」タブに書く（`MONITOR_DRY_RUN=1` なら `.cache/monitor-result.json` に出すだけ） |
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

## 掲載中の項目の確認（`.github/workflows/monitor.yml`）

毎週月曜 7:00（日本時間）。「掲載データ」の出典URL・公式URLを読み、結果を「チェック結果」タブに書く。「掲載データ」は変更しない。

- 確認の頻度：締切まで60日以内の項目は毎週、それ以外は約4週に1回（手動実行で「すべて確認」も選べる）
- 知らせる内容：リンク切れ、移動、ページの変化（増えた行の例つき）、締切後の項目に新しい年度の記載、募集中なのに登録の締切日がページに見当たらない、自動確認できない（robots.txt で禁止・混雑・応答なし）
- 「要対応」の●は、リンク切れ・移動・変化は毎回、それ以外は新しく出たときだけ付く。対応したら●を消してよい（確認しない週は残る）
- 「対応メモ」は人が書く欄で、次回以降も引き継ぐ
- アクセスの作法：1件ずつ、4秒以上あける、robots.txt の Disallow と Crawl-delay に従う、429/503 ならそのサイトはその回は中止

準備（表格への書き込みに必要）：

1. 表格の「掲載データ」「候補」「除外」タブを保護し、編集できる人を自分と運営者だけにする（サービスアカウントを含めない）
2. そのうえでサービスアカウントの権限を「閲覧者」から「編集者」に変える
