# Pokewan

ポケモンカードゲームの練習用Webアプリです。

- `index.html`: 一人回しページ
- `online.html`: オンライン二人対戦ページ

## 開発

```bash
npm install
npm run dev
```

本番用ファイルは次で生成します。

```bash
npm run build
```

生成先は `dist` です。GitHub Pagesでは `npm run build` の成果物を公開します。

## 一人回しページ

デッキコード、または次の形式の公式URLを入力できます。

```text
https://www.pokemon-card.com/deck/confirm.html/deckID/{deckCode}
```

公式サイトのCORS制限で直接読み込みできない場合は、公式デッキ表示ページのHTMLを貼り付けて読み込めます。

## オンライン二人対戦ページ

公開URLの例:

```text
https://nekochanninaritai.github.io/Pokewan/online.html
```

MVPとして次の機能があります。

- ルーム作成
- ルーム参加
- プレイヤーA / Bで参加
- 公式デッキページHTMLからデッキ読み込み
- 初手7枚
- サイド6枚
- 山札シャッフル
- 1枚ドロー
- カードの移動先選択
- 番を渡す
- 公開ゾーンの同期
- 山札枚数、手札枚数、サイド残り枚数の同期
- 自分だけ山札確認

### 非公開情報の扱い

相手に見せてはいけない情報はFirebaseへ送信しません。

Firebaseへ送る情報:

- バトル場
- ベンチ
- トラッシュ
- ロストゾーン
- スタジアム
- 状態
- 山札枚数
- 手札枚数
- サイド枚数
- 番のプレイヤー

ブラウザ内のlocalStorageだけに保存する情報:

- 自分の山札
- 自分の手札
- 自分のサイド
- 自分だけが確認中の山札内容

CSSで隠すだけではなく、相手クライアントへ非公開カード配列を送らない設計です。

## Firebase Realtime Database設定

GitHub Pagesは静的ホスティングなので、オンライン同期にはFirebase Realtime Databaseを使います。

1. Firebase Consoleでプロジェクトを作成
2. Realtime Databaseを作成
3. Database URLを確認
4. `public/firebaseConfig.js` の `databaseURL` を自分のURLへ変更

設定例は `public/firebaseConfig.example.js` にも置いています。

例:

```js
window.POKEWAN_FIREBASE_CONFIG = {
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
};
```

カジュアル用途のテスト用ルール例:

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

公開リポジトリに本番用の認証情報や秘密鍵は置かないでください。FirebaseのWeb APIキーは秘密鍵ではありませんが、ルール設定で読み書き範囲を制御してください。

## GitHub Pages

`.github/workflows/deploy.yml` を含めています。GitHub Pagesの Source を `GitHub Actions` に設定すると、`main` ブランチへのpushで `npm run build` の結果が公開されます。

## 今回追加した主なファイル

- `online.html`
- `src/online.tsx`
- `src/online.css`
- `public/firebaseConfig.example.js`
- `scripts/build.mjs`

## 今回変更した主なファイル

- `package.json`
- `src/App.tsx`
- `src/styles.css`
- `src/deckParser.ts`
- `README.md`
