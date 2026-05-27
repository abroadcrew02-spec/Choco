# ADR-0003: WASM 境界の引き方（1MP 閾値・処理単位ベース）

| 項目 | 値 |
|------|---|
| Status | Accepted |
| Date | 2026-05-27 |
| Deciders | 開発チーム |
| 関連 | requirements.md §6.2, §7, architecture.md §7 |

## Context

Choco の編集処理は性能予算が混在する。

| 処理 | 予算 | 性質 |
|------|------|------|
| ブラシ描画 | 16ms (60fps) | 操作直結・極低レイテンシ |
| Flood Fill (FHD) | 200ms | 全画面 BFS・CPU bound |
| マジックワンド (FHD) | 300ms | 全画面色差スキャン |
| マスクペイント | 体感即時 | 中規模ピクセル更新 |
| Layered SVG パス抽出 | 出力で 2 秒以内に寄与 | 連結成分解析 + 輪郭抽出 |
| カラーピック | 即時 | 単一画素読込 |

実装言語の選択肢:
- JavaScript（Canvas2D API + 純 JS）
- WebAssembly（Rust → wasm-bindgen）

すべてを WASM に寄せると IPC オーバーヘッド（postMessage / wasm 境界の引数コピー）が UI スレッドのブラシ予算を食う。すべてを JS に寄せると Flood Fill 200ms / マジックワンド 300ms の達成が困難。

境界線を明確化する必要がある。

## Decision

**「全画面走査または 1MP 以上のピクセル数を伴う処理」を WASM、それ以外は JS（Main thread / Worker thread）** で実装する。

### 具体的な振り分け

| 処理 | 実装場所 | 根拠 |
|------|---------|------|
| ブラシ 1 ストローク | Main thread + Canvas2D | 16ms 予算厳守、IPC コスト回避、局所処理 |
| カラーピック / スポイト | Main thread | 単一画素読込 |
| ズーム・パン描画 | Main thread + Konva | Konva の Stage 機能で完結 |
| 透明背景市松表示 | Main thread + Konva Pattern | UI 装飾 |
| Flood Fill | WASM (Worker) | 全画面 BFS、200ms 予算 |
| マジックワンド | WASM (Worker) | 全画面色差スキャン |
| マスクペイントの選択範囲適用 | WASM (Worker) | 大量ピクセル更新 + bitmap 演算 |
| 選択範囲 + Delete (透過化) | WASM (Worker) | 選択範囲内ピクセル全走査 |
| Layered SVG パス抽出 | WASM (Worker) | 連結成分解析 + Marching Squares |
| ラスタ出力時のレイヤー合成 | Worker (TS, Canvas API) | OffscreenCanvas で十分高速 |
| 画像デコード | Tauri Core (Rust ネイティブ) | image クレートが最速、WASM より速い |

閾値の運用基準: **画素数 1,000,000 (約 1MP) 以上、または全画面走査が必須の処理 → WASM**。

## Consequences

### 採用根拠

#### IPC オーバーヘッドの見積もり（※要検証）

- Main → Worker postMessage: 短メッセージで 0.1〜数 ms（環境依存）
- Worker → WASM: 引数コピー（wasm-bindgen の `&[u8]`）。FHD 画像 1 枚 = 8MB のコピーで数 ms オーダー

ブラシは pointermove ごとに発生し、1 イベントあたり 16ms 予算なので IPC で数 ms 取られる選択は許容できない。Main thread Canvas2D で完結させる。

Flood Fill は 1 操作 1 回限りで 200ms 予算なので、初期化に数 ms 使っても影響軽微。WASM 実装で BFS 本体を高速化するメリットが上回る。

#### Rust/WASM の優位性

- メモリ管理: タイル単位の連続バッファ（Vec<u8>）で SIMD / キャッシュ親和性が高い
- rayon ベースの並列化（タイル単位）が Worker 内で完結可能（※WASM の rayon-wasm は実験的。MVP では単一スレッド実装、性能未達なら検討）
- 型安全な BFS / DFS 実装。スタックオーバーフロー回避のためスキャンライン方式採用

### JS 側でやる場面の根拠

- ブラシは局所処理（ストローク範囲のタイルのみ）で、Canvas2D の `globalCompositeOperation` と `arc()` の組合せで 1ms 未満で描ける
- IPC 経由でないため、入力イベントから描画反映までのレイテンシが最小

### 採用しない代替案

1. **全部 JS** - Flood Fill 200ms (FHD) は純 JS でも頑張れば達成可能だがマージンが薄く、4K 600ms / マジックワンド (FHD) 300ms / SVG 出力までトータルで考えると WASM 化が安全
2. **全部 WASM** - ブラシまで IPC 経由になり 16ms 予算が危険。pointermove の頻発に対する postMessage コストが無視できない
3. **WebGPU / WebGL シェーダで全処理** - 統合 GPU・WebView2 上での安定性が要件に対し過剰なリスク。要件 §7.2 で不採用が確定済み
4. **動的閾値（ランタイム計測で WASM/JS を切替）** - 実装複雑度に対し得るものが少ない。1MP 閾値の固定で十分

### リスクと対策

| リスク | 対策 |
|--------|------|
| WASM 初期化コスト（起動 3 秒予算への影響） | Worker での非同期 instantiate + 必要時遅延ロード |
| WASM ヒープ 256MB 上限 | タイル単位の処理に分割、巨大画像で一度に全タイルを WASM に持ち込まない |
| WASM ↔ JS のデータ受け渡しコスト | Transferable ArrayBuffer の活用、結果は dirty タイルだけ返却 |
| SharedArrayBuffer 検証 | M2 で PoC、利用可能なら境界コスト削減のオプションとして追加 |
| 1MP 閾値の境界事例 | 実機ベンチでブレを実測し、必要なら閾値調整（※要検証） |

### 境界変更の判断基準

性能予算未達が発生した場合、以下の順で対応:
1. WASM 側のアルゴリズム最適化（スキャンライン / SIMD / タイル並列）
2. SharedArrayBuffer による境界コスト削減
3. 1MP 閾値の引き下げ（より小さな処理を WASM に移す）
4. Tauri Core (ネイティブ Rust) への移譲（WASM より高速だが IPC オーバーヘッド大）

逆に WASM 化のオーバーヘッドが性能に悪影響を与える処理が発見されたら、JS 側に戻す。

### タイル状態の Source of Truth（Arch-M1）

タイルピクセルデータの正典（Source of Truth）は **WASM 側 `CanvasState`** とする。JS 側 `TileManager` は表示用キャッシュとして機能する。

| 関心事 | 正典 | キャッシュ |
|--------|------|----------|
| ピクセルデータ（RGBA バイト列） | WASM `CanvasState.layers[].tiles[].rgba` | JS `Tile.bitmap` (ImageBitmap) |
| dirty フラグ | WASM 側で操作完了時に算出 | JS 側は再描画トリガーとして保持 |
| swap 状態（resident / on-disk） | JS `TileManager`（LRU 制御の主体） | WASM 側は常駐タイルのみ保持し、swap-out 時に JS から ingest される |
| 選択範囲（SelectionMask） | WASM `CanvasState.selection` | JS 側は ID と境界矩形のみ保持 |

ブラシ操作は例外として Main thread Canvas2D で先行更新し、`pointerup` 時にまとめて WASM 側へ反映する（操作レイテンシ優先）。WASM 側は最終的な真値を保持するため、Undo・Flood Fill・SVG 出力等の全画面処理は WASM の `CanvasState` を参照する。

### 影響範囲

- `crates/choco-wasm/src/` 全モジュール
- `src/worker/compute.worker.ts` Worker での WASM 公開 API
- `src/canvas/BrushEngine.ts` Main thread Canvas2D 実装
- `src/canvas/TileManager.ts` 双方からアクセスされる中核

## 改訂履歴

| Ver | 日付 | 変更内容 |
|-----|------|---------|
| 1.0 | 2026-05-27 | 初版 |
| 1.1 | 2026-05-27 | レビュー指摘 Arch-M1 を反映。タイル状態の Source of Truth を WASM 側 `CanvasState` に確定、JS 側 `TileManager` を表示用キャッシュと位置付ける |
