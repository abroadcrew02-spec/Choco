# ADR-0005: 自動アップデート構成（Public 配信ミラー + Ed25519 署名）

| 項目 | 値 |
|------|---|
| Status | Accepted |
| Date | 2026-05-27 |
| Deciders | 開発チーム |
| 関連 | requirements.md §5.7, §6.7, §9.1, §11, architecture.md §10 |

## Context

要件で自動アップデートが必須機能 (F13) として定義されており、以下の制約がある。

- 利用者は社内のみ
- 署名方式: Ed25519
- 秘密鍵保管: GitHub Actions Secrets
- 配信形式: 差分アップデート対応（フル配信フォールバック可）
- 更新確認: 起動時バックグラウンド
- 自動アップデート差分サイズ目標 ≤ 5MB
- 自動アップデート失敗時のフォールバック（旧バージョン維持）必須
- 署名検証失敗時はインストール拒否
- Sentry 等の外部エラー収集は採用しない（要件 R4）
- ダウングレード攻撃への防御を実装段階で考慮

実装手段の候補:

1. **tauri-plugin-updater（公式プラグイン）** - Ed25519 内蔵、Tauri v2 と密結合
2. **electron-updater** - Electron 用、不採用（ADR-0001 で Tauri v2 採用）
3. **自前実装** - Tauri Core から HTTP fetch + 署名検証 + ファイル置換
4. **Squirrel / WiX 連携** - Windows ネイティブインストーラベースの更新

配信先（リポジトリ可視性）の選択肢:

A. **private リポジトリ + クライアント認証**（PAT 埋め込み / GitHub App / 中継プロキシ）
B. **配信用 public リポジトリ（ミラー）+ private ソースリポジトリ**（バイナリのみ公開、ソースコードは非公開）
C. **CDN / 社内 NAS にミラー** - 配信構成を自前で構築

## Decision

**tauri-plugin-updater + 配信用 public リポジトリ（ミラー）+ private ソースリポジトリ + Ed25519 鍵を GitHub Actions Secrets** で運用する。

- ソースコードは private リポジトリ（`<org>/choco`）で管理
- ビルド成果物（`.msi`, `.msi.sig`, `latest.json`）の配信専用に public リポジトリ（`<org>/choco-releases`）を別途用意
- 配信物の完全性・真正性は **Ed25519 署名のみで担保**（クライアント側に秘匿情報を一切埋め込まない）
- public リポジトリは配信物のみ含み、ソース・履歴・Issue は含めない
- ダウングレード攻撃に対しては、クライアント側で「取得バージョン < インストール済みバージョン」の場合は更新を拒否しログ記録する

## Consequences

### 採用根拠

- **認証不要**: クライアントに PAT・GitHub App トークン等の秘匿情報を一切埋め込まない。バイナリ抽出による漏洩リスクを根本排除
- **改竄耐性**: 配信パスが public であっても、Ed25519 署名検証により改竄バイナリのインストールは拒否される
- **ソース非公開**: ソースコード本体は private リポジトリのままで、社外公開は配信バイナリのみに限定
- **シンプル**: 中継プロキシ・社内 NAS・GitHub App の運用負荷がない
- **tauri-plugin-updater 標準動作**: 公式プラグインの想定する `endpoints` をそのまま使え、HTTP GET 1 回で latest.json と .msi を取得可能

### ダウングレード攻撃対策

`tauri-plugin-updater` のバージョン比較挙動を確認した上で、以下の防御層を設ける。

| 層 | 対策 |
|----|------|
| プラグイン標準 | `tauri-plugin-updater` は通常「新バージョンのみインストール」を行う。バージョン比較ロジックは plugin に委譲（※実装着手時に semver 比較挙動を検証） |
| アプリ側追加検証 | Updater イベントハンドラで `取得バージョン < インストール済みバージョン` を検出した場合、更新を中止しログに WARN 記録（実装ルールとして必須） |
| 配信側 | `latest.json` 生成時に古いバージョンを意図的に上書きしない運用ルール（ロールバック用の旧バージョン配信は別 endpoint で実施） |

`requirements.md §9.1` 改訂履歴にダウングレード防御の明示を追記。

### 全体フロー

```
┌─────────────────────────────────────────────────────┐
│ 開発者                                                 │
│   git tag v1.x.x && git push --tags                  │
│   （操作対象は private ソースリポ）                      │
└────────────────────┬────────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────────┐
│ GitHub Actions (.github/workflows/release.yml)        │
│   1. Rust + WASM + TS ビルド                          │
│   2. tauri build → .msi 生成                          │
│   3. Secrets から Ed25519 秘密鍵を取得                  │
│   4. .msi に対する署名生成 (.msi.sig)                   │
│   5. latest.json 生成                                  │
│      - version, pub_date, platforms.windows.url, sig   │
│   6. **public ミラー (<org>/choco-releases) に**       │
│      .msi / .msi.sig / latest.json をアップロード      │
└────────────────────┬────────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────────┐
│ クライアント (Choco 起動時)                              │
│   1. tauri-plugin-updater がバックグラウンドで          │
│      <org>/choco-releases の latest.json を取得         │
│      （認証ヘッダ不要・public URL）                      │
│   2. バージョン比較                                      │
│      - 取得バージョン > 現在バージョン → 通知             │
│      - 取得バージョン <= 現在バージョン → 無視 + ログ     │
│   3. ユーザー同意で .msi ダウンロード                     │
│   4. Ed25519 公開鍵で署名検証                            │
│   5. 検証 OK → インストール実行 → 再起動                 │
│   6. 検証 NG / DL 失敗 → 旧版維持、トースト通知           │
└─────────────────────────────────────────────────────┘
```

### リポジトリ構成

| リポジトリ | 可視性 | 内容 | アクセス |
|----------|--------|------|---------|
| `<org>/choco` | private | ソースコード、Issue、PR、CI 設定 | 開発メンバーのみ |
| `<org>/choco-releases` | public | `.msi`, `.msi.sig`, `latest.json` のみ。リリースタグごとに配置 | 全世界からダウンロード可能（ただし社内利用前提） |

CI Workflow は private リポで起動し、`peter-evans/repository-dispatch` または `actions/github-script` 等で public ミラーへ成果物を push する（実装手順は M5 で確定）。

### 鍵管理

| 項目 | 内容 |
|------|------|
| 鍵生成 | `tauri signer generate -w ~/.tauri/choco.key`（初回のみ運用手順書で実施） |
| 秘密鍵保管 | private ソースリポの GitHub Actions Secrets (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) |
| 公開鍵 | `tauri.conf.json` の `plugins.updater.pubkey` にコミット（バイナリに焼き込まれる） |
| 鍵ローテーション | 公開鍵更新を含むメジャー版リリース時のみ実施。古い公開鍵を持つクライアントは手動更新が必要となる旨を運用手順書に明記 |

### Tauri 設定例

```jsonc
// src-tauri/tauri.conf.json (抜粋)
{
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": [
        "https://github.com/<org>/choco-releases/releases/latest/download/latest.json"
      ],
      "dialog": false,
      "pubkey": "<base64 encoded ed25519 public key>"
    }
  }
}
```

- public エンドポイントなので認証ヘッダ不要
- `dialog: false` で標準ダイアログを使わず、アプリ内のトースト UI で通知する（UX 統一）
- 進捗イベントを購読してダウンロード進捗を表示

### フォールバック仕様

| 状況 | 動作 |
|------|------|
| latest.json 取得失敗（ネット断） | サイレント（次回起動時に再試行） |
| ダウンロード失敗 | トースト通知（再試行ボタン）、旧版維持 |
| Ed25519 署名検証失敗 | エラートースト + 配信物即破棄、旧版維持、ログ記録 |
| ダウングレード検知 | 更新中止、WARN ログ記録、ユーザーには通知しない |
| インストール途中失敗 | tauri-plugin-updater が原子的更新を保証（旧版維持） |
| 公開鍵不一致（鍵ローテーション後の旧クライアント） | 検証失敗扱い。手動更新案内 |

### Considered Alternatives（採用しなかった配信構成）

過去案として検討したが本 ADR では不採用となった案を、判断経緯保存のため列挙する。

#### A-1: private リポジトリ + クライアントに PAT 埋め込み

- メリット: リポジトリ単一化、シンプルな構成
- デメリット: バイナリリバースエンジニアリングで PAT 漏洩リスク。漏洩時に組織全体のアクセス権が脅威に晒される
- → **不採用**（機密情報のクライアント埋め込み禁止）

#### A-2: private リポジトリ + 中継プロキシサーバ

- メリット: クライアントに秘匿情報を持たせない
- デメリット: 社内プロキシサーバの運用が新規発生。社内ツール程度のためオーバーキル
- → **不採用**（運用負荷過大）

#### A-3: private リポジトリ + GitHub App Device Flow

- メリット: 初回起動時のみ OAuth 認証で以降は refresh token、PAT より安全
- デメリット: 初回起動 UX が複雑化、社内全員の OAuth 同意フローが必要、token 失効時の再認証導線も実装が必要
- → **不採用**（社内ツールの起動 UX として過剰）

#### A-4: GitHub App / Fine-grained PAT を初回インストール時のみ手動配布

- メリット: クライアント認証情報を最小化
- デメリット: 配布運用フローが必要、メンバー入れ替えのたびに発行作業
- → **不採用**（運用負荷高）

#### C-1: 自前実装

- メリット: 完全な制御
- デメリット: Ed25519 検証 + 差分パッチ + 原子的更新 + ロールバックを自前実装する工数とリスク
- → **不採用**

#### C-2: Squirrel / WiX ベース更新

- Tauri v2 のパッケージング (WiX) と整合は取れるが、tauri-plugin-updater が同等以上を提供
- → **不採用**

### 採用しない代替案（配信戦略以外）

#### サーバ側で動的バージョン分岐 / A-B テスト

- スコープ外（社内利用、全員同じ版でよい）
- → **不採用**

### 差分アップデート

tauri-plugin-updater は差分（patch）配信に対応。.msi の差分生成は MSI 仕様の制約があり、フル msi 配信になる場合がある。目標差分サイズ 5MB はインストーラ全体（15MB）に対し ※要検証。

差分が現実的でない場合は フル msi 配信 + 高速 CDN 配信に倒すことも視野（要件 §6.5 の目標は努力目標）。

### リスクと対策

| リスク | 対策 |
|--------|------|
| 秘密鍵漏洩 | Actions Secrets は最小権限の Workflow からのみアクセス、ログ出力禁止、Audit Log 定期確認 |
| 公開鍵を含む `tauri.conf.json` の改ざん | コミットレビュー + ブランチ保護で対策 |
| public 配信物の改竄 | Ed25519 署名検証で検知、改竄バイナリはインストール拒否 |
| ダウングレード攻撃 | クライアント側でバージョン比較、古いバージョンは無視 + WARN ログ |
| GitHub サービス障害 | フォールバック手順（インストーラ手動配布）を運用手順書に明記 |
| 鍵紛失 | バックアップ手順を運用手順書で必須化（オフラインの安全な保管場所） |
| WebView2 未インストール環境での起動失敗 | Tauri の WebView2 Bootstrapper 同梱で対応 |
| 配信ミラーへの push 失敗 | CI で再試行 + 失敗時は Slack 等で運用通知 |

### 計測・検証項目（※要検証）

- `tauri-plugin-updater` の semver 比較挙動（特にプレリリース版・ビルドメタデータ付き）
- 差分アップデートのフォーマット (.msi の patch 可否) と実効サイズ
- 初回更新通知から再起動完了までの所要時間
- Min 仕様 PC でのインストール完了時間
- public ミラー push の CI Workflow 構成（最小権限トークン）

### 影響範囲

- `src-tauri/Cargo.toml` tauri-plugin-updater 追加
- `src-tauri/src/main.rs` updater 初期化 + ダウングレード検知ハンドラ
- `src-tauri/tauri.conf.json` 公開鍵 + endpoints（public URL）
- `.github/workflows/release.yml` ビルド + 署名 + public ミラーへ配信
- `src/ipc/updater.ts` フロント側 UI 連携
- `src/components/Dialogs/UpdateToast.tsx` 通知 UI
- 運用手順書 (リポジトリ外): 鍵生成・バックアップ・ローテーション・障害時手順・public ミラー運用

## 改訂履歴

| Ver | 日付 | 変更内容 |
|-----|------|---------|
| 1.0 | 2026-05-27 | 初版（private リポ + クライアント認証構成） |
| 1.1 | 2026-05-27 | レビュー指摘 C1/C2 を反映。配信用 public ミラー + Ed25519 署名のみで完結する構成に全面書き換え。ダウングレード防御層を明記。PAT 埋め込み・GitHub App Device Flow 等の不採用案を Considered Alternatives に記録 |
