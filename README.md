# ポケカ一人回し

ポケモンカードゲームのデッキをブラウザ上で読み込み、初手確認、ドロー、サイドセット、カード移動を練習する静的Webアプリです。

## 使い方

```bash
npm install
npm run dev
```

本番用ファイルは次で生成します。

```bash
npm run build
```

生成先は `dist` です。

## デッキ読み込み

- デッキコード、または `https://www.pokemon-card.com/deck/confirm.html/deckID/{deckCode}` 形式のURLを入力できます。
- 公式サイトのCORS制限で直接読み込みできない場合は、公式デッキ表示ページのHTMLを貼り付けて読み込めます。
- カードは次の形に正規化して扱います。

```ts
type Card = {
  id: string;
  name: string;
  imageUrl: string;
  count: number;
  category?: "pokemon" | "trainer" | "energy";
};
```

## GitHub Pages

`.github/workflows/deploy.yml` を含めています。GitHub Pages の Source を GitHub Actions に設定すると、`main` ブランチへの push で `npm run build` の結果が公開されます。
