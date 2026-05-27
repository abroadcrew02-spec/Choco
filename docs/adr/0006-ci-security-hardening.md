# ADR-0006: CI セキュリティ統合（cargo audit + 画像デコーダ硬化 + Tauri 設定）

| 項目 | 値 |
|------|---|
| Status | Accepted |
| Date | 2026-05-27 |
| Deciders | 開発チーム |
| 関連 | requirements.md §6.7, architecture.md §10, §15 |

## Context

レビュー指摘 Sec-M2 / Sec-M3 を受け、以下のセキュリティ対策を CI および設計レベルで恒久化する必要がある。

- 依存クレートの既知脆弱性検知（`cargo audit`）
- 画像デコード時のフォーマット偽装（拡張子と中身の不一致）への耐性
- Tauri WebView の Content Security Policy 設定
- Tauri capabilities による Rust 側 API の最小権限化

これらは個別の実装事項であると同時に、CI と設計書で恒久的に縛らないと退行しやすいため、単独 ADR として確定させる。

## Decision

以下 4 点を恒久ルールとして採用する。詳細は architecture.md §15「Tauri セキュリティ設定」セクションを正典として参照、本 ADR は判断根拠を記録する。

### 1. CI に `cargo audit` を統合

`.github/workflows/build.yml` に以下のジョブを追加。

- `rustsec/audit-check@v2` または `cargo install cargo-audit && cargo audit` を毎 PR で実行
- `Cargo.lock` の存在を必須化（依存バージョン固定）
- 重大度 `critical` / `high` の脆弱性検出時は CI を fail させる
- `medium` 以下は警告として PR コメントに表示し、ブロックはしない
- 週次 cron で main ブランチに対して再実行（新規 RustSec advisory への即応）

### 2. 画像デコーダの硬化

`src-tauri/src/decoder/` で画像デコード時に **`image::io::Reader::with_guessed_format()`** を使用する。

- 拡張子に依存せず、マジックバイトでフォーマットを判定
- 拡張子と中身が一致しない（例: PNG 拡張子で実際は WebP）入力でも安全にデコード
- 拡張子偽装による不正フォーマット経路の利用を防止
- `with_guessed_format()` でフォーマット判定不能なファイルは `AppError::Validation` で拒否

実装イメージ:

```rust
use image::io::Reader as ImageReader;

#[tauri::command]
pub async fn open_image(path: String) -> Result<DecodedImage, AppError> {
    // path はダイアログ経由のみ受理（capabilities で制約、§15 参照）
    let reader = ImageReader::open(&path)
        .map_err(|e| AppError::FileIo(e.to_string()))?
        .with_guessed_format()
        .map_err(|e| AppError::Decode(e.to_string()))?;

    // 上限検証（要件 §6.3）
    let (w, h) = reader.into_dimensions()
        .map_err(|e| AppError::Decode(e.to_string()))?;
    validate_dimensions(w, h)?;

    let img = ImageReader::open(&path)?
        .with_guessed_format()?
        .decode()
        .map_err(|e| AppError::Decode(e.to_string()))?;

    // ... 以降 RGBA 化
}
```

### 3. Tauri CSP 設定

`src-tauri/tauri.conf.json` の `app.security.csp` を明示設定する。

- `default-src 'self'` を基本
- `script-src 'self' 'wasm-unsafe-eval'`（WASM 実行のため必須）
- `style-src 'self' 'unsafe-inline'`（React 由来のインラインスタイルを許容）
- `img-src 'self' data: blob:`（base64 埋め込み・ImageBitmap 由来 blob URL）
- `connect-src 'self' https://github.com https://*.githubusercontent.com`（updater 用 public ミラー、ADR-0005 と整合）
- `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`

詳細は architecture.md §15 を正典とする。

### 4. Tauri capabilities の最小権限化

`src-tauri/capabilities/` 配下を以下方針で構成する。

- `default.json`: アプリ全体で許可する最小コマンドセット
- `open_image` 等のファイル受理コマンドは **ダイアログ経由のパスのみ受理**
  - DnD でファイルパスを直接 invoke 引数として受け取る経路を作らず、Tauri のファイルダイアログ API または DnD イベントから取得したパスのみを使用
  - 任意パス文字列を JS から `open_image` に渡してフルパス読み取りを許可する設計は禁止
- `fs` プラグインのスコープは設定しない（または最小化）。Choco のファイル IO は専用 `#[tauri::command]` でラップする
- `shell` / `process` プラグインは未使用、明示的に無効化

詳細は architecture.md §15 を正典とする。

## Consequences

### 採用根拠

- `cargo audit` は RustSec Advisory Database を参照する業界標準。Rust エコシステムで脆弱性検知の de facto standard
- `with_guessed_format()` は `image` クレート公式が提示するフォーマット偽装対策
- CSP / capabilities は Tauri v2 のセキュリティモデルが前提とする層であり、設定欠如はそのままアタックサーフェス拡大に直結する

### 採用しない代替案

| 代替案 | 不採用理由 |
|--------|-----------|
| `cargo deny` を採用 | より広範な制御が可能だが、Choco 規模では `cargo audit` で十分。設定の複雑さが利点を上回らない |
| 画像デコードを WASM 側に寄せる | image クレートは Tauri Core の方が高速かつ image::io::Reader が Rust ネイティブで使える。WASM 化メリットなし |
| CSP を `default-src *` 等で緩める | 攻撃面が広がる。本質的な安全対策がない |
| capabilities を細粒度に分割しない | デフォルトで全権限になりがちで Tauri v2 のセキュリティモデルを使い切れない |

### リスクと対策

| リスク | 対策 |
|--------|------|
| `cargo audit` の偽陽性で CI が頻繁に fail | 重大度 critical / high のみブロック、medium 以下は警告 |
| advisory 公開直後の `cargo audit` 更新遅延 | 週次 cron で main ブランチに対して再実行 |
| `with_guessed_format()` 判定漏れ | 判定不能を明示エラーとして拒否、対応形式（PNG/JPEG/WebP/BMP）以外は受理しない |
| CSP `wasm-unsafe-eval` の許可 | WASM 実行に必須（仕様上の制約）。alternative の `'strict-dynamic'` は WASM 未対応のため代替不可 |
| capabilities 漏れによる予期せぬ API 露出 | コードレビューで `tauri.conf.json` および `capabilities/*.json` の差分を必ず確認 |

### 影響範囲

- `.github/workflows/build.yml` `cargo audit` ジョブ追加 + 週次 cron
- `src-tauri/Cargo.toml` `Cargo.lock` 管理ルール（コミット必須）
- `src-tauri/src/decoder/` `with_guessed_format()` 使用の徹底
- `src-tauri/tauri.conf.json` CSP / capabilities 参照
- `src-tauri/capabilities/*.json` 最小権限定義
- `src-tauri/src/commands/file_io.rs` `open_image` のパス受理ルール

## 改訂履歴

| Ver | 日付 | 変更内容 |
|-----|------|---------|
| 1.0 | 2026-05-27 | 初版。レビュー指摘 Sec-M2 / Sec-M3 を恒久ルール化 |
