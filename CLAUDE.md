# rail-back-on-time

遅延した新幹線を待避・抑止・進路切り替えでさばいてダイヤを戻す、ブラウザ用パズルゲームの試作。

- 仕様: [docs/SPEC.md](docs/SPEC.md)。実装前に必ず全部読み、§9 のマイルストーン順に進める
- 実装中に決めたこと: `docs/DECISIONS.md` に追記する
- 素の HTML / CSS / ES Modules。外部ライブラリとビルドツールは使わない
- `src/sim/` は DOM に依存させない（Node でテストするため）
- テスト: `npm test`（`node:test`）
- 起動: `python3 -m http.server 8000` → http://localhost:8000
