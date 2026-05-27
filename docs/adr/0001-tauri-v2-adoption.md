# ADR-0001: デスクトップフレームワークに Tauri v2 を採用する

| 項目 | 値 |
|------|---|
| Status | Accepted |
| Date | 2026-05-27 |
| Deciders | 開発チーム |
| 関連 | requirements.md §6.5, §7 |

## Context

Choco は社内向け Windows デスクトップアプリとして以下の制約を持つ。

- インストーラサイズ目標 ≤ 15MB
- インストール後ディスク使用量 ≤ 60MB
- コールド起動 ≤ 3.0 秒（Min 機: Core i3-8th / 4GB RAM / HDD）
- 通常時メモリ消費 ≤ 512MB、ピーク ≤ 1.0GB
- フロントエンドは TypeScript + React + Konva を採用予定
- 画像処理の重い部分は Rust (WASM + ネイティブ) で実装する方針

これらを満たすデスクトップフレームワークを選定する。

候補:
1. **Tauri v2** - WebView2 (システム同梱) + Rust ネイティブバックエンド
2. **Electron** - Chromium 同梱 + Node.js
3. **WebView2 直接呼び出し** - C++/C# で WebView2 を直接ホスト
4. **Native Win32 + WebView2** - Rust + windows-rs で自前ホスト

## Decision

**Tauri v2** を採用する。

## Consequences

### 採用根拠（数値ベース）

| 指標 | Tauri v2 | Electron | 備考 |
|------|---------|---------|------|
| インストーラサイズ | 約 3-10MB | 約 80-150MB | Tauri は WebView2 を OS 同梱の Edge 利用、Electron は Chromium 同梱 |
| アイドル時メモリ | 約 40-100MB | 約 150-300MB | 一般的な比較値、※Choco での実測は M1 で検証 |
| 起動時間 | 短い | 長い | Chromium 同梱の初期化コストを回避 |
| Rust 連携 | ネイティブ統合 | NAPI 経由で複雑 | Choco は Rust 製 WASM + Rust ネイティブ処理が中核なので統合容易性が大きい |
| 自動更新 | tauri-plugin-updater (Ed25519 内蔵) | electron-updater 等 | 要件で署名検証必須 |
| 学習コスト | 中（Rust 必要） | 低（JS のみ） | チームに Rust 経験あり前提で許容 |

要件の 15MB / 60MB / 3 秒 起動 / 1GB メモリピーク は、Electron では達成困難。Tauri v2 では十分な余裕で達成可能と判断。

### 採用しない理由（他候補）

- **Electron**: バンドルサイズ・メモリ・起動時間すべてで要件未達リスクが高い。社内ツールとはいえ Min 仕様 4GB RAM を考えるとピーク 1GB の予算で Chromium 常駐は厳しい
- **WebView2 直接ホスト (C++/C#)**: 開発生産性が著しく低下。UI 状態管理・IPC・更新機構をすべて自前実装する必要があり、リリース時期に間に合わない
- **Native Win32 + WebView2 (Rust + windows-rs)**: WebView2 のホスティング自体は可能だが、Tauri が提供する commands / event / updater / packager をすべて再実装することになり工数が見合わない

### トレードオフ・リスク

| 項目 | 影響 | 対応 |
|------|------|------|
| WebView2 ランタイム前提 | Win10 22H2 / Win11 は標準で同梱されるが、極稀に未インストール環境がある | インストーラに WebView2 Bootstrapper を同梱（Tauri 標準サポート） |
| Tauri v2 は比較的新しい | 2024年以降に v2 安定版リリース、エコシステム成熟度は v1 より浅い | 公式 updater plugin・主要 OS バインディングは v2 で安定。実装で問題発生時は v1 へのフォールバックも視野（※要検証） |
| Rust 学習コスト | チーム全体での Rust 習熟度に差 | Rust 担当を分離し、フロント担当は TS のみで完結する範囲を明確化（commands API 層を整備） |
| OffscreenCanvas / SharedArrayBuffer | WebView2 での挙動が一部要検証 | M1 初期に PoC（architecture.md V3, V5） |

### 後続の判断

- WebView2 ランタイム非依存化（同梱化）は当面検討しない。要件 OS で標準同梱されるため
- macOS / Linux 対応は要件外（§4.4）。Tauri v2 はマルチプラットフォームだが Choco は Windows 限定実装で進める
- Tauri v1 への切替が必要になった場合は、commands 層を抽象化済みのため移行コストは限定的
