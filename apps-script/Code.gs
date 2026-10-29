/**
 * 表格に「サイト」メニューを追加し、「サイトを更新」で GitHub Actions のビルドを始める。
 *
 * 設定（Apps Script の「プロジェクトの設定 → スクリプト プロパティ」）:
 *   GITHUB_REPO   例: your-name/snownight-site
 *   GITHUB_TOKEN  fine-grained token。対象はこのリポジトリだけ、権限は Actions: Read and write だけ
 *                 （表格の編集者は誰でもこの値を見られるので、コードを書き換えられる権限は付けない）
 */

const WORKFLOW_FILE = 'build.yml';
const COOLDOWN_SECONDS = 120; // 連打で何度もビルドしないように

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('サイト')
    .addItem('サイトを更新', 'updateSite')
    .addItem('更新の状況を見る', 'showStatusLink')
    .addToUi();
}

function updateSite() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const repo = props.getProperty('GITHUB_REPO');
  const token = props.getProperty('GITHUB_TOKEN');
  if (!repo || !token) {
    ui.alert('設定がまだです', 'スクリプト プロパティに GITHUB_REPO と GITHUB_TOKEN を登録してください。', ui.ButtonSet.OK);
    return;
  }

  const cache = CacheService.getScriptCache();
  if (cache.get('lastRequest')) {
    ui.alert('更新中です', '少し前に更新を始めたところです。2分ほど待ってからサイトを確認してください。', ui.ButtonSet.OK);
    return;
  }

  const res = UrlFetchApp.fetch(
    'https://api.github.com/repos/' + repo + '/actions/workflows/' + WORKFLOW_FILE + '/dispatches',
    {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      payload: JSON.stringify({ ref: 'main' }),
      muteHttpExceptions: true,
    },
  );

  if (res.getResponseCode() === 204) {
    cache.put('lastRequest', '1', COOLDOWN_SECONDS);
    SpreadsheetApp.getActive().toast('1〜2分でサイトに反映されます。', 'サイトの更新を始めました', 8);
  } else {
    ui.alert(
      '更新を始められませんでした',
      'GitHub からの応答: ' + res.getResponseCode() + '\n' +
        'トークンの期限切れや権限の不足が考えられます。サイトの担当者に知らせてください。',
      ui.ButtonSet.OK,
    );
  }
}

function showStatusLink() {
  const repo = PropertiesService.getScriptProperties().getProperty('GITHUB_REPO');
  const url = 'https://github.com/' + repo + '/actions/workflows/' + WORKFLOW_FILE;
  const html = HtmlService.createHtmlOutput(
    '<p style="font-family:sans-serif;font-size:14px;line-height:1.7">' +
      '緑のチェックは成功、赤の × は失敗です。失敗したときは、開いたページの「検証して公開データを作る」に原因が出ています。</p>' +
      '<p style="font-family:sans-serif"><a href="' + url + '" target="_blank">更新の状況を開く</a></p>',
  ).setWidth(360).setHeight(160);
  SpreadsheetApp.getUi().showModalDialog(html, '更新の状況');
}
