# Choco アーキテクチャ設計書 v1.0

| 項目 | 内容 |
|------|------|
| バージョン | 1.0 |
| 作成日 | 2026-05-27 |
| ステータス | 初版 |
| 関連文書 | docs/requirements.md, docs/adr/*.md |

本書は要件定義書 v1.0 を前提とした実装レベルの設計指針を示す。各重要判断の背景は `docs/adr/` 配下を参照。

---

## 1. システム全体構成

### 1.1 プロセス構成

```
┌──────────────────────────────────────────────────────────────────┐
│ Tauri Application Process (Windows .exe)                          │
│                                                                    │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ WebView2 (Edge Chromium)                                     │  │
│  │                                                              │  │
│  │  ┌─────────────────────┐    ┌──────────────────────────┐   │  │
│  │  │ Main Thread (UI)    │    │ Web Worker (Heavy Compute)│   │  │
│  │  │  - React 18         │    │  - OffscreenCanvas        │   │  │
│  │  │  - Konva.js Stage   │◄──►│  - WASM instance          │   │  │
│  │  │  - Zustand store    │comlink - Tile compression IO   │   │  │
│  │  │  - Brush realtime   │    │  - Flood Fill / Wand      │   │  │
│  │  └─────────┬───────────┘    └──────────┬───────────────┘   │  │
│  └────────────┼───────────────────────────┼─────────────────────┘  │
│               │ Tauri IPC (invoke / event)│                        │
│               ▼                           ▼                        │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ Tauri Core (Rust, native thread pool)                       │  │
│  │  - File IO (open / save dialog)                             │  │
│  │  - Image decode (image crate)                               │  │
│  │  - Tile swap to disk (lz4_flex + tempfile)                  │  │
│  │  - Auto Updater (tauri-plugin-updater + Ed25519)            │  │
│  │  - rayon worker pool (CPU 並列処理)                           │  │
│  └────────────────────────────────────────────────────────────┘   │
│                              │                                     │
└──────────────────────────────┼─────────────────────────────────────┘
                               ▼
              ┌────────────────────────────────┐
              │ Local Disk                     │
              │  %TEMP%\choco\<session>\       │
              │    tiles\<id>.lz4              │
              │    undo\<step>.patch           │
              └────────────────────────────────┘
                               ▲
                               │ HTTPS
              ┌────────────────────────────────┐
              │ GitHub Releases (public mirror) │
              │  <org>/choco-releases          │
              │  - 配信パッケージ (.msi)         │
              │  - <app>.msi.sig (Ed25519)     │
              │  - latest.json                 │
              └────────────────────────────────┘
```

### 1.2 レイヤ責務一覧

| レイヤ | 言語 | 主責務 | 主要ライブラリ |
|--------|------|--------|---------------|
| UI Layer | TS / React | UI 描画・入力処理・状態管理・ブラシ即時描画 | React 18, Konva.js, Zustand |
| Worker Layer | TS + WASM | 重い画像処理・タイル圧縮・OffscreenCanvas | comlink, wasm-bindgen 生成バインディング |
| WASM Module | Rust → WASM | Flood Fill, Magic Wand, Path 抽出, ピクセル演算 | image, imageproc |
| Tauri Core | Rust | ファイル IO, 一時ファイル管理, 自動更新, OS 連携 | tauri v2, rayon, lz4_flex, tempfile |

---

## 2. ディレクトリ構成

```
choco/
├── src/                            # フロントエンド (TS/React)
│   ├── main.tsx                    # エントリポイント
│   ├── App.tsx
│   ├── components/                 # UI コンポーネント
│   │   ├── Canvas/
│   │   │   ├── CanvasStage.tsx     # Konva Stage ラッパ
│   │   │   ├── BrushLayer.tsx
│   │   │   ├── SelectionLayer.tsx
│   │   │   └── CheckerLayer.tsx    # 透明表示用市松
│   │   ├── Toolbar/
│   │   ├── ColorPicker/
│   │   ├── LayerPanel/
│   │   └── Dialogs/
│   ├── store/                      # Zustand stores
│   │   ├── documentStore.ts        # 画像・レイヤー状態
│   │   ├── toolStore.ts            # 選択中ツール・パラメータ
│   │   ├── historyStore.ts         # Undo/Redo
│   │   └── viewStore.ts            # ズーム・パン
│   ├── canvas/                     # キャンバスコア
│   │   ├── TileManager.ts          # タイル LRU + dirty 追跡
│   │   ├── Tile.ts                 # 256x256 ピクセル単位
│   │   ├── Renderer.ts             # Konva 連携描画
│   │   ├── BrushEngine.ts          # JS Canvas でのブラシ
│   │   └── Compositor.ts           # レイヤー合成
│   ├── worker/                     # Web Worker 関連
│   │   ├── compute.worker.ts       # comlink で expose
│   │   ├── wasmLoader.ts           # WASM 初期化
│   │   └── api.ts                  # Worker 公開 API 型
│   ├── ipc/                        # Tauri IPC ラッパ
│   │   ├── fs.ts                   # ファイル IO
│   │   ├── updater.ts              # 更新確認
│   │   └── tileSwap.ts             # タイル退避/復元
│   ├── io/                         # 入出力
│   │   ├── importers/
│   │   │   ├── png.ts
│   │   │   ├── jpeg.ts
│   │   │   ├── webp.ts
│   │   │   └── bmp.ts
│   │   └── exporters/
│   │       ├── raster.ts           # PNG/JPEG/WebP
│   │       └── layeredSvg.ts
│   ├── history/                    # Undo/Redo
│   │   ├── PatchRecorder.ts
│   │   ├── PatchApplier.ts
│   │   └── types.ts
│   ├── hooks/
│   ├── utils/
│   └── types/                      # 共通型定義
│
├── src-tauri/                      # Tauri Core (Rust)
│   ├── src/
│   │   ├── main.rs
│   │   ├── commands/               # #[tauri::command]
│   │   │   ├── mod.rs
│   │   │   ├── file_io.rs
│   │   │   ├── tile_swap.rs
│   │   │   └── decode.rs
│   │   ├── tile/                   # サーバ側タイル管理
│   │   │   ├── storage.rs
│   │   │   └── compression.rs
│   │   ├── decoder/                # 画像デコード
│   │   ├── updater/                # アップデータ設定
│   │   └── error.rs
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── icons/
│
├── crates/
│   └── choco-wasm/                 # WASM モジュール (Rust)
│       ├── src/
│       │   ├── lib.rs              # wasm-bindgen エクスポート
│       │   ├── flood_fill.rs       # スキャンライン Flood Fill
│       │   ├── magic_wand.rs
│       │   ├── selection.rs        # 選択範囲 bitmap
│       │   ├── path_extract.rs     # SVG パス抽出
│       │   └── color.rs            # 色差計算
│       └── Cargo.toml
│
├── tests/
│   ├── unit/                       # vitest
│   ├── integration/                # playwright (WebView2)
│   └── benchmarks/                 # criterion (Rust)
│
├── .github/
│   └── workflows/
│       ├── build.yml
│       └── release.yml             # Ed25519 署名 + GitHub Releases
│
├── docs/
│   ├── requirements.md
│   ├── architecture.md
│   └── adr/
│
├── package.json
├── vite.config.ts
├── tsconfig.json
└── README.md
```

---

## 3. データフロー（代表シーケンス）

### 3.1 画像読込

```
User                UI(Main)         Tauri Core         Worker             WASM
 │  Drop file        │                │                  │                  │
 ├─────────────────►│                │                  │                  │
 │                   │ invoke         │                  │                  │
 │                   │  open_image    │                  │                  │
 │                   ├──────────────►│                  │                  │
 │                   │                │ image::decode    │                  │
 │                   │                │ (背景threaded)    │                  │
 │                   │                │                  │                  │
 │                   │ 検証OK (size)   │                  │                  │
 │                   │◄──────────────┤                  │                  │
 │                   │                │                  │                  │
 │                   │ RGBA buffer (transfer)            │                  │
 │                   ├─────────────────────────────────►│                  │
 │                   │                │                  │ splitToTiles()   │
 │                   │                │                  │ 256x256 単位      │
 │                   │                │                  │                  │
 │                   │ Tile metadata + 可視タイル ImageBitmap                │
 │                   │◄─────────────────────────────────┤                  │
 │                   │                │                  │                  │
 │                   │ Konva.Image に描画                 │                  │
 │ 表示完了           │                │                  │                  │
 │◄─────────────────┤                │                  │                  │
```

判定ポイント:
- 16MP 超 / 50MB 超 / 長辺 8192px 超は Tauri Core で読み込み前に拒否（エラーダイアログ）
- 透過情報を保持するため内部表現は RGBA8 固定
- 1MP 以下の画像は Worker に渡さず Main で直接処理しても良い（コピーコスト削減）

### 3.2 ブラシ描画（即時系・60fps 必須）

```
User              UI(Main)               TileManager
 │ pointermove     │                      │
 ├───────────────►│                       │
 │                 │ getTilesUnderStroke() │
 │                 ├──────────────────────►│
 │                 │ 影響タイル配列         │
 │                 │◄──────────────────────┤
 │                 │ BrushEngine.stroke()  │
 │                 │  - 該当タイルだけに描画 │
 │                 │  - dirty フラグ立て    │
 │                 │ Konva 再描画 (request) │
 │ 表示更新         │                       │
 │◄───────────────┤                       │
```

- Worker は経由しない（IPC オーバーヘッドが 16ms 予算を食う）
- Main thread の Canvas2D で完結。タイル単位の `OffscreenCanvas` を使い `drawImage` で Konva に合成
- pointerup 時に PatchRecorder へ dirty タイルの差分を記録

### 3.3 Flood Fill（重処理系）

```
User           UI(Main)        Worker          WASM
 │ click        │               │              │
 ├────────────►│               │              │
 │              │ proxy.flood   │              │
 │              ├──────────────►│              │
 │              │               │ flood_fill() │
 │              │               ├─────────────►│
 │              │               │ (rayon並列)   │
 │              │               │ 結果 mask    │
 │              │               │◄─────────────┤
 │              │               │ 差分タイル抽出 │
 │              │ 更新済 tiles   │              │
 │              │◄──────────────┤              │
 │              │ History.push  │              │
 │              │ Konva 再描画   │              │
 │ 表示更新      │               │              │
 │◄────────────┤               │              │
```

### 3.4 マジックワンド → Shift追加 → マスクペイント → Delete（代表複合シーケンス）

要件 §5.3 で互いに加算・減算で組合せ可能とされる選択フローの代表ケース。Arch-M2 指摘によりシーケンス図を明示する。

```
User                UI(Main)             Worker            WASM
 │  click (wand)     │                    │                 │
 ├──────────────────►│                    │                 │
 │                   │ proxy.magicWand    │                 │
 │                   │  (mode: replace)   │                 │
 │                   ├───────────────────►│                 │
 │                   │                    │ magic_wand()    │
 │                   │                    ├────────────────►│
 │                   │                    │  色差スキャン     │
 │                   │                    │  SelectionMask  │
 │                   │                    │  を WASM に生成   │
 │                   │                    │ {selectionId,   │
 │                   │                    │  bounds}        │
 │                   │                    │◄────────────────┤
 │                   │ {selectionId,bounds}                 │
 │                   │◄───────────────────┤                 │
 │                   │ 選択範囲枠を Konva    │                 │
 │                   │   に描画             │                 │
 │ Shift + click     │                    │                 │
 ├──────────────────►│                    │                 │
 │                   │ proxy.magicWand    │                 │
 │                   │  (mode: add)       │                 │
 │                   ├───────────────────►│                 │
 │                   │                    │ magic_wand(add) │
 │                   │                    ├────────────────►│
 │                   │                    │ 既存 mask に OR  │
 │                   │                    │ {bounds 更新}    │
 │                   │                    │◄────────────────┤
 │                   │ {bounds}           │                 │
 │                   │◄───────────────────┤                 │
 │                   │ 選択範囲枠を再描画    │                 │
 │ マスクペイントツール選択 → drag                              │
 ├──────────────────►│                    │                 │
 │                   │ pointerdown        │                 │
 │                   │  ストロークパス収集   │                 │
 │                   │ pointerup          │                 │
 │                   │ proxy.paintSelection (mode: add)     │
 │                   ├───────────────────►│                 │
 │                   │                    │ paint_selection │
 │                   │                    ├────────────────►│
 │                   │                    │ SelectionMask に│
 │                   │                    │ ストロークを書込   │
 │                   │                    │◄────────────────┤
 │                   │ {bounds}           │                 │
 │                   │◄───────────────────┤                 │
 │ Delete キー        │                    │                 │
 ├──────────────────►│                    │                 │
 │                   │ proxy.deleteSelected                 │
 │                   ├───────────────────►│                 │
 │                   │                    │ delete_selected │
 │                   │                    ├────────────────►│
 │                   │                    │ 選択範囲内の α=0  │
 │                   │                    │ dirty タイル抽出  │
 │                   │                    │ TilePatch[] 返す │
 │                   │                    │◄────────────────┤
 │                   │ {patches, bitmaps} │                 │
 │                   │◄───────────────────┤                 │
 │                   │ History.push       │                 │
 │                   │ TileManager 更新    │                 │
 │                   │ Konva 再描画        │                 │
 │ 表示更新           │                    │                 │
 │◄──────────────────┤                    │                 │
```

要点:

- 選択範囲（SelectionMask）の正典は WASM 側に置く（ADR-0003 Source of Truth）。Main thread は `selectionId` と `bounds` のみ保持
- Shift / Alt の add / subtract モードは Tauri IPC を介さず Worker 側 API の引数として完結
- マスクペイントは pointerup 時にまとめて 1 呼び出し（pointermove 毎の RPC は避ける）
- Delete は影響タイルが選択範囲の bounds に限定されるため、history entry は最小タイル数に収まる

### 3.5 保存（Layered SVG）

```
UI(Main)         Worker              WASM            Tauri Core
 │ exportSvg()    │                   │                │
 ├──────────────►│                   │                │
 │                │ path_extract()    │                │
 │                ├──────────────────►│                │
 │                │ 色域ごとパス         │                │
 │                │◄──────────────────┤                │
 │                │ 背景 PNG エンコード   │                │
 │ SVG文字列       │                   │                │
 │◄──────────────┤                   │                │
 │ invoke save_file                  │                │
 ├──────────────────────────────────────────────────►│
 │                                                    │ ファイル書込
 │ 完了                                                │
 │◄──────────────────────────────────────────────────┤
```

---

## 4. 主要型・インタフェース設計

### 4.1 TypeScript 側コア型

```ts
// src/types/canvas.ts

export type PixelCoord = { x: number; y: number };
export type TileCoord = { tx: number; ty: number };

export const TILE_SIZE = 256;

export interface Tile {
  coord: TileCoord;
  // 常駐時のみ実体あり。スワップ中は null（メタデータのみ保持）
  bitmap: ImageBitmap | null;
  // 圧縮済みデータの所在（スワップ時のみ）
  swapId: string | null;
  width: number;        // 端タイルは 256 未満になる
  height: number;
  dirty: boolean;       // 直近の操作で変更されたか
  lastAccessed: number; // LRU 用 (performance.now())
}

export interface Layer {
  id: string;
  name: string;
  kind: 'background' | 'edit';
  visible: boolean;
  opacity: number;        // 0.0 - 1.0
  locked: boolean;
  tiles: Map<string, Tile>; // key = `${tx},${ty}`
}

export interface CanvasDocument {
  id: string;
  width: number;
  height: number;
  layers: Layer[];          // [背景, 編集] 順
  activeLayerId: string;
  createdAt: number;
}

export interface Selection {
  // 選択範囲は 1bpp bitmap として WASM 側で保持
  // フロントは ID のみ保持し、操作時に WASM へ問い合わせる
  id: string;
  bounds: { x: number; y: number; w: number; h: number };
}
```

### 4.2 Undo/Redo パッチ型

```ts
// src/history/types.ts

export interface TilePatch {
  layerId: string;
  coord: TileCoord;
  // 各ピクセルの RGBA 差分 (XOR 形式で保存し、適用時に再 XOR で双方向対応)
  // - 全タイル差分が小さい場合は xorBytes 形式
  // - 全画素変更レベルの差分は fullBytes 形式に切替
  encoding: 'xor' | 'full';
  before: Uint8Array;   // タイル全体の RGBA バイト列または XOR バイト列
  after: Uint8Array;
}

export interface HistoryEntry {
  id: string;
  label: string;        // 'Brush', 'Flood Fill' 等
  timestamp: number;
  patches: TilePatch[]; // 1 操作で複数タイル変更され得る
}

export interface HistoryState {
  entries: HistoryEntry[];   // 最大 30
  cursor: number;            // -1 = 何もない / 0 以上 = 適用済み最新位置
}
```

`xor` と `full` の選択は **圧縮後の実サイズを比較して小さい方を採用** する動的判定とする（§6.3 参照）。

### 4.3 Worker 公開 API（comlink）

```ts
// src/worker/api.ts

export interface ComputeApi {
  init(opts: { wasmUrl: string }): Promise<void>;

  // 画像読込: Tauri Core から受け取った RGBA バッファをタイル化
  ingestImage(args: {
    rgba: Uint8Array;       // transferable
    width: number;
    height: number;
  }): Promise<{
    tileMeta: TileMeta[];
    visibleBitmaps: { coord: TileCoord; bitmap: ImageBitmap }[];
  }>;

  floodFill(args: {
    layerId: string;
    seed: PixelCoord;
    tolerance: number;      // 0-255
    color: [number, number, number, number];
  }): Promise<{ patches: TilePatch[]; bitmaps: TileBitmap[] }>;

  magicWand(args: {
    seed: PixelCoord;
    tolerance: number;
    mode: 'replace' | 'add' | 'subtract';
  }): Promise<{ selectionId: string; bounds: Bounds }>;

  paintSelection(args: {
    selectionId: string;
    deltaPath: PathSegment[];
    mode: 'add' | 'subtract';
  }): Promise<{ bounds: Bounds }>;

  deleteSelected(args: {
    layerId: string;
    selectionId: string;
  }): Promise<{ patches: TilePatch[]; bitmaps: TileBitmap[] }>;

  exportSvgPaths(args: {
    layerId: string;
  }): Promise<{ paths: { color: string; d: string }[] }>;

  // タイルスワップ
  swapOutTile(coord: TileCoord): Promise<{ swapId: string }>;
  swapInTile(swapId: string): Promise<{ bitmap: ImageBitmap }>;
}

export interface TileMeta { coord: TileCoord; width: number; height: number; }
export interface TileBitmap { coord: TileCoord; bitmap: ImageBitmap; }
export interface Bounds { x: number; y: number; w: number; h: number; }
export interface PathSegment { /* マスクペイントのストローク表現 */ }
```

### 4.4 Rust (WASM) 側

```rust
// crates/choco-wasm/src/lib.rs

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct CanvasState {
    width: u32,
    height: u32,
    layers: Vec<LayerData>,
    selection: Option<SelectionMask>,
}

pub struct LayerData {
    id: String,
    tiles: TileGrid,
}

pub struct TileGrid {
    cols: u32,
    rows: u32,
    tiles: Vec<TileBuf>,   // index = ty * cols + tx
}

pub struct TileBuf {
    width: u16,
    height: u16,
    rgba: Vec<u8>,         // width * height * 4
}

/// 選択範囲は 1bpp bitmap (8ピクセル/byte)
pub struct SelectionMask {
    width: u32,
    height: u32,
    bytes: Vec<u8>,
}

#[wasm_bindgen]
impl CanvasState {
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32) -> Self { /* ... */ }

    pub fn ingest_layer(&mut self, layer_id: &str, rgba: &[u8]) { /* ... */ }

    pub fn flood_fill(&mut self, layer_id: &str, seed_x: u32, seed_y: u32,
                      tolerance: u8, color: u32) -> JsValue {
        // 戻り値は { patches: TilePatch[], dirty_coords: [u32, u32][] } を JS に返す
    }

    pub fn magic_wand(&mut self, seed_x: u32, seed_y: u32, tolerance: u8,
                      mode: u8) -> JsValue { /* ... */ }

    pub fn extract_paths(&self, layer_id: &str) -> JsValue { /* ... */ }
}
```

### 4.5 Tauri Core コマンド

```rust
// src-tauri/src/commands/file_io.rs

#[tauri::command]
pub async fn open_image(path: String) -> Result<DecodedImage, AppError> {
    // path はダイアログ経由のみ受理（capabilities で制約、§15 参照）
    // 画像デコーダ硬化（ADR-0006）: image::io::Reader::with_guessed_format()
}

#[tauri::command]
pub async fn save_image(path: String, data: Vec<u8>) -> Result<(), AppError> { /* ... */ }

#[tauri::command]
pub async fn swap_out_tile(rgba: Vec<u8>) -> Result<String, AppError> {
    // Rust 側で UUIDv4 を生成 → lz4_flex 圧縮 → tempfile に書出 → swap_id 返却
    // JS から tile_id を受け取らない（Sec-M1 / ADR-0002）
}

#[tauri::command]
pub async fn swap_in_tile(swap_id: String) -> Result<Vec<u8>, AppError> {
    // 1. swap_id を UUIDv4 形式バリデーション
    //    ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$
    // 2. セッションディレクトリ配下のパス組立
    // 3. canonicalize() で実体パスがセッションディレクトリ配下にあることを確認
    // 4. 読込 + lz4_flex 展開
}

#[derive(serde::Serialize)]
pub struct DecodedImage {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
    format: String,
}
```

### 4.6 BrushEngine と Main thread OffscreenCanvas の所有権・ライフサイクル（Arch-M3）

ブラシ即時描画は Main thread Canvas2D で完結する（ADR-0003）。BrushEngine の所有権とライフサイクルを以下に確定する。

```ts
// src/canvas/BrushEngine.ts

export class BrushEngine {
  // Main thread の単一インスタンス（CanvasStage マウント時に生成）
  // タイル単位の OffscreenCanvas を内部で所有
  private tileCanvases: Map<string, OffscreenCanvas>;
  private tileContexts: Map<string, OffscreenCanvasRenderingContext2D>;

  constructor(private tileManager: TileManager) {}

  beginStroke(layerId: string, params: BrushParams): void {
    // 1. 影響予測タイルを pin（C3 スワップ禁止ルール）
    // 2. resident な ImageBitmap から OffscreenCanvas を派生
    // 3. ストローク用 context を準備
  }

  moveStroke(point: PixelCoord): void {
    // pointermove ごとに呼ばれる。OffscreenCanvas に円形を arc() で描画
    // Konva に再描画 request（dirty 矩形のみ）
  }

  endStroke(): TilePatch[] {
    // 1. dirty タイルの差分を採取（XOR / full の動的判定: §6.3）
    // 2. WASM 側 CanvasState に最終結果を反映（Source of Truth 更新）
    // 3. pin 解除
    // 4. TilePatch[] を返して history に積む
  }

  dispose(): void {
    // CanvasStage アンマウント時。全 OffscreenCanvas を破棄
  }
}
```

所有権サマリ:

| リソース | 所有者 | ライフサイクル |
|----------|--------|---------------|
| BrushEngine インスタンス | CanvasStage コンポーネント | Stage マウント〜アンマウント |
| タイル単位 OffscreenCanvas | BrushEngine | beginStroke で派生、endStroke 後に再利用、dispose で破棄 |
| 再描画リクエスト | Konva Stage | BrushEngine からの dirty 通知に応じて batchDraw |
| 最終ピクセル結果 | WASM CanvasState | endStroke で WASM に反映 |
| Undo 履歴 | historyStore | endStroke で TilePatch[] を push |

スレッド境界:

- BrushEngine は **Main thread のみ** で動作（Worker には存在しない）
- BrushEngine と Worker 内 WASM の同期は endStroke 時の単発 invoke で行う（pointermove 毎の IPC は発生しない）
- ストローク途中の表示は OffscreenCanvas 経由で Konva に直接合成、WASM 経由しない

---

## 5. タイル管理戦略

### 5.1 設計概要

- タイルサイズ: 256×256 RGBA = 256KB/タイル
- 8192px 長辺 → 32×32 タイル = 1024 タイル/レイヤー = 最大 256MB/レイヤー（非圧縮）
- 2 レイヤー × 1024 タイル → 256MB × 2 = 512MB（ピーク）
- メモリ予算 1GB から逆算し、可視タイル + 編集近辺のみ常駐、それ以外は LZ4 圧縮でディスク退避

### 5.2 階層管理

```
TileManager (TS, Worker内)
 ├── residentTiles: Map<key, Tile>   // ImageBitmap を保持。LRU
 ├── swappedTiles: Map<key, string>  // key→swapId のみ
 └── dirtyTiles: Set<key>            // 直近操作で変更
```

- LRU 上限: ※暫定 256 タイル (約 64MB)。実機計測で調整
- スワップ閾値: LRU 上限超過時、最古かつ非可視・非編集対象のタイルを退避
- ディスク退避: Tauri Core 経由で `%TEMP%\choco\<session>\tiles\<swapId>.lz4` に書込
  - swap ID は Rust 側で UUIDv4 生成（ADR-0002 §「タイル swap ID 生成規約」参照）
- セッション終了時に temp ディレクトリ全削除

#### タイル状態の Source of Truth（Arch-M1）

- **正典**: WASM 側 `CanvasState`（`crates/choco-wasm/src/lib.rs`）
- **表示用キャッシュ**: JS 側 `TileManager.residentTiles`（ImageBitmap）
- 全画面処理（Flood Fill / マジックワンド / SVG 出力 / Undo）は WASM の `CanvasState` を参照
- ブラシ操作のみ Main thread Canvas2D で先行更新し、pointerup 時に WASM 側へ反映
- 詳細は ADR-0003 「タイル状態の Source of Truth」セクション参照

#### スワップタイミング制約（C3）

ブラシ等の連続操作中はタイルスワップを発生させない。原則は以下のとおり。

| タイミング | スワップ可否 |
|-----------|-------------|
| `pointerdown` 〜 `pointerup` の間 | **スワップ禁止**（resident set はストローク開始時に固定） |
| `pointerup` 後 〜 アイドル時 | 可。`requestIdleCallback` 相当のアイドル時に LRU eviction を実行 |
| ズーム・パン中 | 可。ただし入力イベント処理スレッドはブロックしない |
| Flood Fill / マジックワンド実行中 | 対象タイルは pin（スワップ禁止）、それ以外は可 |

実装ルール:

- ストローク開始時、影響タイル集合（`getTilesUnderStroke()` の結果）を `pinnedTiles` に追加
- ストローク中の eviction 対象選択時、`pinnedTiles` のタイルは除外
- 重い処理（Flood Fill 等）も同様に対象タイルを pin、完了後 unpin
- LRU eviction は `requestIdleCallback`（Worker では `setTimeout(0)` で代替）でスケジュール
- 操作中にスワップが発生するとブラシ 60fps 予算（16ms）を確実に超過するため、本ルールは性能予算達成の前提

### 5.3 dirty tracking

各タイル操作で `dirty=true` を立て、Undo 記録時に dirty タイルだけ差分採取して `dirty=false` に戻す。ブラシストロークは pointerdown〜pointerup を 1 トランザクションとして扱い、ストローク中に触れた全タイルをまとめて 1 HistoryEntry に詰める。

### 5.4 可視タイル判定

```
visibleRect = computeVisibleRect(viewState)
expandedRect = visibleRect.expand(margin = TILE_SIZE)  // プリフェッチ
visibleTileCoords = rectToTileCoords(expandedRect)
```

スクロール・ズーム変更時に可視タイルセットを再計算し、新規可視タイルを swap-in、長く不可視のタイルを swap-out 候補にマーク。

---

## 6. Undo/Redo 差分パッチ構造

### 6.1 全体方針

- 1 操作 = 1 HistoryEntry
- 1 HistoryEntry = 影響タイルごとの TilePatch 配列
- 各 TilePatch は変更前後の RGBA バイト列（XOR エンコードを基本）
- 履歴上限 30 を超えたら FIFO で破棄

### 6.2 XOR エンコード詳細

```
patch.before = tileBeforeBytes XOR tileAfterBytes
適用方向 (undo / redo) どちらも:
  newBytes = currentBytes XOR patch.before
```

メリット:
- 変更画素が少ない場合に多くが 0 になり、LZ4 等の圧縮効率が高い
- undo / redo の双方向で同じパッチを使える

### 6.3 切替判定

XOR エンコードと full エンコードのどちらが小さいかを **動的にサイズ比較で判定** する。

```
xor_bytes = compress(before XOR after)
full_bytes = compress(after)   // 圧縮後サイズで比較
if xor_bytes.len() >= full_bytes.len():
    encoding = 'full'
    payload = full_bytes
else:
    encoding = 'xor'
    payload = xor_bytes
```

判定基準を「差分密度の閾値（暫定 60%）」から「圧縮後実サイズの比較」に変更する根拠（Perf-M4 指摘）:

- 圧縮効率はバイト分布に依存するため、画素差分率と圧縮後サイズは線形対応しない
- 暫定閾値 60% は実機計測で調整が必要な未確定値だったが、サイズ実測ベースなら閾値設定そのものが不要
- 1 タイル単位の判定であり、圧縮処理は数 ms オーダーで Undo 操作レイテンシに影響しない
- 双方の圧縮結果を比較するコスト < 不適切エンコーディングによるメモリ膨張コスト

実装は `compress(before XOR after)` と `compress(after)` の両方を実行してサイズの小さい方を採用する。before は `apply_patch` 時に必要なので保持するが、ペイロードは選択された方のみ持つ。

### 6.4 メモリインパクト試算（※要検証）

- 平均影響タイル数: ブラシ 1-4 タイル / Flood Fill 数十タイル
- 1 タイル full encoding: 256KB
- 30 ステップ × 平均 10 タイル × 256KB = 75MB
- XOR + 内部圧縮で実効 1/4 想定 → 約 20MB（要実測）

---

## 7. WASM 境界とデータ受け渡し

### 7.1 境界判定ルール

| 処理 | 場所 | 理由 |
|------|------|------|
| ブラシ 1 ストローク | Main thread Canvas2D | IPC 16ms 予算厳守 |
| 局所カラーピック・スポイト | Main thread | 単一画素読込 |
| Flood Fill | WASM | 全画面 BFS、CPU bound |
| マジックワンド | WASM | 色差スキャン |
| マスクペイント（選択範囲操作） | WASM | 大量ピクセル更新 |
| Layered SVG パス抽出 | WASM | 連結成分解析 + Marching Squares |
| 出力時のレイヤー合成 | Worker (TS) | Canvas API で十分 |
| 画像デコード | Tauri Core | image クレートが最速 |

閾値の目安: ※暫定 1MP（1024×1024）以上または全画面走査が必要な処理。実機計測で再調整。

### 7.2 データ受け渡し

**画像バッファの受け渡し**:
- Tauri Core → JS: `Vec<u8>` を invoke 戻り値で受け取る（Tauri v2 は内部的に zerocopy 寄りだが完全 zerocopy ではない）。1 回限りの転送なのでコピーコスト許容
- JS Main → Worker: `Transferable` (ArrayBuffer) で所有権移譲。コピー無し
- Worker → WASM: `wasm-bindgen` の `&[u8]` 参照渡し（線形メモリへのコピー 1 回発生）

**SharedArrayBuffer の扱い**:
- WebView2 でも COOP/COEP ヘッダ設定で利用可能だが、Tauri が `tauri://` カスタムスキームを使うため設定が必要
- ※要検証: SharedArrayBuffer 利用可否 + パフォーマンス改善幅。初期実装では **Transferable で進め、性能予算未達時のオプションとして検討**

### 7.3 WASM 線形メモリ管理

- WASM ヒープ上限: 256MB (要件 §6.4)
- Rust 側で `CanvasState` を保持し、JS は不透明ハンドル (`#[wasm_bindgen]` で公開する struct) 経由でアクセス
- タイル単位のスワップは Rust 側でも実装（メモリ常駐タイル数を制限）
- 大きな結果 (TilePatch 配列など) は `JsValue` で JSON 風シリアライズし、バイト列のみ別途 `Uint8Array` ビューで返す

---

## 8. エラーハンドリング方針

### 8.1 分類とユーザー提示

| カテゴリ | 例 | 提示方法 |
|----------|-----|---------|
| 入力検証エラー | 上限超過 / 非対応形式 | モーダルダイアログ。操作続行可 |
| ファイル IO エラー | 書込失敗 / アクセス権 | モーダルダイアログ + 再試行ボタン |
| メモリ不足 | タイル割当失敗 | トースト警告 + 自動スワップアウト試行 |
| WASM パニック | unreachable / OOM | エラー画面 + 操作ログ保存。再起動推奨 |
| 自動更新失敗 | DL失敗 / 署名検証失敗 | トースト警告。次回起動時に再試行 |

### 8.2 Rust → JS のエラー型

```rust
// src-tauri/src/error.rs

#[derive(serde::Serialize, thiserror::Error, Debug)]
pub enum AppError {
    #[error("file io: {0}")]
    FileIo(String),

    #[error("image decode: {0}")]
    Decode(String),

    #[error("validation: {0}")]
    Validation(String),

    #[error("internal: {0}")]
    Internal(String),
}
```

JS 側は `try { await invoke(...) } catch (e: AppError) { ... }` でハンドリング。エラーコードで分岐し、ユーザー提示文言は i18n リソースから取得（日本語固定だが将来拡張のため）。

### 8.3 WASM パニック

`std::panic::set_hook` でパニック内容を `console.error` に送出。Worker で `unhandledrejection` を捕捉し、main thread に通知してエラー画面表示。

### 8.4 自動更新失敗時

`tauri-plugin-updater` の DL 失敗 / 検証失敗時は旧バージョンを維持したままトーストで通知。次回起動時に再確認。署名検証失敗時は配信物を即破棄。

### 8.5 ログ

- 開発ビルド: コンソール + ファイル両方
- 本番ビルド: `%LOCALAPPDATA%\Choco\logs\app.log` にローテーション付き（最大 5MB × 3 世代、※要検証で実装時調整）
- Sentry 等の外部送信は採用しない（社内利用 / 要件 R4）

---

## 9. スレッドモデル

```
┌───────────────────────────────────────────────────────────┐
│ UI Thread (WebView2 main)                                  │
│  - React render                                            │
│  - Konva Stage 描画                                         │
│  - 入力イベント処理                                          │
│  - ブラシ即時描画 (Canvas2D)                                 │
│  - Zustand store 更新                                       │
│  ※ ここでは絶対にブロッキング処理を行わない                     │
└────────┬──────────────────────┬───────────────────────────┘
         │ comlink (postMessage) │ Tauri invoke
         ▼                       ▼
┌──────────────────────┐  ┌──────────────────────────────┐
│ Worker Thread        │  │ Tauri Core (Tokio Runtime)    │
│  - WASM 実行          │  │  - async commands             │
│  - Flood/Wand         │  │  - rayon::spawn でブロッキング │
│  - 選択演算            │  │    タスクをスレッドプール委譲   │
│  - SVG パス抽出        │  │                              │
└──────────────────────┘  └──────┬───────────────────────┘
                                  │
                                  ▼ rayon (CPU 並列)
                         ┌────────────────────────┐
                         │ Native Thread Pool     │
                         │  - LZ4 圧縮/展開        │
                         │  - 画像デコード          │
                         │  - タイル並列処理         │
                         └────────────────────────┘
```

### 9.1 スレッド役割

| スレッド | 役割 | ブロッキング許容 |
|---------|------|-----------------|
| UI Main | React / Konva / 入力 / ブラシ | 不可（16ms 予算） |
| Worker | WASM 実行 / 重画像処理 | 可（数百 ms まで） |
| Tauri Core async | コマンドディスパッチ | 短時間のみ |
| rayon worker | 並列 CPU 処理 | 可 |

### 9.2 競合回避

- WASM の `CanvasState` は単一 Worker 内に閉じ、複数 Worker 化はしない（初期実装）
- Tauri Core 側のタイルスワップは swap_id（Rust 側生成 UUIDv4）ごとに `Mutex<HashMap>` でロック
- 楽観排他: Undo 履歴は単一 store 管理で順序整合性確保

---

## 10. ビルド・配信フロー

ADR-0005 v1.1 に基づき、ソースコードは private リポ、配信物は public ミラーに分離する。

```
git tag v1.x.x      (private ソースリポ: <org>/choco)
    │
    ▼
GitHub Actions (.github/workflows/release.yml)
    │
    ├─ cargo build --release (Rust)
    ├─ wasm-pack build --release (WASM)
    ├─ vite build (TS/React)
    ├─ tauri build (.msi 生成)
    │
    ├─ Ed25519 署名 (GitHub Actions Secrets の秘密鍵)
    │  - <app>.msi.sig 生成
    │
    └─ public 配信ミラー (<org>/choco-releases) に
        - choco_x.y.z_x64-setup.msi
        - choco_x.y.z_x64-setup.msi.sig
        - latest.json   (バージョン + URL + signature)
        をアップロード
```

クライアント側は `tauri-plugin-updater` 設定で public ミラーの `latest.json` を参照、Ed25519 公開鍵で署名検証してインストール。認証は不要（public エンドポイント）。

### 10.1 ダウングレード攻撃防御

`tauri-plugin-updater` は通常「新バージョンのみインストール」を行うが、アプリ側で追加検証層を実装する（C2 / ADR-0005）。

実装ルール:

- Updater のバージョン比較イベントハンドラで、取得バージョンと現在インストール済みバージョンを semver 比較
- 取得バージョン `<` インストール済みバージョン の場合は更新を中止し、`AppError::Validation` 相当のログを `WARN` レベルで記録
- ユーザーへのトースト通知は出さない（運用上ノイズになるため）
- semver 比較の挙動（プレリリース・ビルドメタデータ）は M5 実装着手時に `tauri-plugin-updater` 仕様を確認の上で実装

擬似コード:

```rust
// src-tauri/src/updater/mod.rs

fn on_update_available(remote_version: &str, current_version: &str) -> UpdateDecision {
    let remote = semver::Version::parse(remote_version)?;
    let current = semver::Version::parse(current_version)?;
    if remote <= current {
        log::warn!(
            "downgrade ignored: remote={} <= current={}",
            remote_version, current_version
        );
        return UpdateDecision::Skip;
    }
    UpdateDecision::Proceed
}
```

---

## 11. 性能達成のための主要施策まとめ

| 性能予算 | 主要対策 |
|---------|---------|
| 起動 3 秒 | Vite コード分割 / WASM 遅延ロード / Konva 初期化非同期化 |
| ブラシ 60fps | UI thread Canvas2D 即時描画 / IPC 経由しない / タイル単位再描画 |
| Flood Fill 200ms (FHD) | WASM スキャンライン実装 / rayon でタイル並列 |
| メモリピーク 1GB | タイル LRU + LZ4 スワップ / XOR 差分 Undo / WASM ヒープ 256MB |
| 起動アイドル CPU 5% | requestIdleCallback で背景タスク / Worker は処理時のみ稼働 |

---

## 12. 未確定事項・要検証項目

| # | 項目 | 検証タイミング |
|---|------|---------------|
| V1 | XOR ⇄ full 動的サイズ比較の効果検証（Perf-M4 で動的判定に変更済み） | M3 完了時実機計測 |
| V2 | WASM 境界閾値（暫定 1MP） | M4 で各処理ベンチ |
| V3 | SharedArrayBuffer 利用可否と性能改善幅 | M2 完了時に PoC |
| V4 | LRU 上限タイル数（暫定 256 タイル） | M3 メモリプロファイル |
| V5 | WebView2 の OffscreenCanvas 動作 (Win10/11) | M1 初期 |
| V6 | ログローテーション仕様（5MB×3 世代） | M5 |
| V7 | 自動更新のテレメトリ取得方法 | M5 |

---

## 13. マイルストーン提案（Coder 引き渡し向け）

### M1: プロジェクトセットアップ + 基盤実装（最初に着手）

- Tauri v2 + React + TS + Vite ボイラープレート作成
- `src-tauri/` の commands/error 骨格
- `crates/choco-wasm/` 雛形 + wasm-pack ビルド設定
- Web Worker + comlink セットアップ
- Zustand store の最小構成 (documentStore / toolStore)
- Konva Stage の最小描画
- CI: GitHub Actions の build ワークフロー（release は M5）
- 受入: 空キャンバスが表示され、WASM が初期化され、`hello()` が Worker 経由で叩ける

### M2: 画像読込 + タイル管理 + ズーム/パン

- Tauri Core: `open_image` 実装 (image クレート / 上限検証)
- TileManager 実装（resident + dirty tracking、スワップは M3）
- Konva 連携: 可視タイルのみ表示
- ズーム・パン (マウスホイール / Space+ドラッグ / Ctrl+0)
- 透明背景の市松表示
- 受入: FHD/4K 画像が読込時間予算内で表示でき、ズーム・パンがスムーズ

### M3: ブラシ + Undo/Redo + タイルスワップ

- BrushEngine 実装 (Canvas2D / 円形ブラシ)
- PatchRecorder / PatchApplier (XOR/full 動的サイズ比較切替、§6.3)
- 30 ステップ履歴管理
- Tauri Core 側 tile_swap_in/out + lz4_flex（Rust 側 UUIDv4 生成）
- 受入:
  - ブラシ操作 60fps を実機計測でクリア
  - 30 ステップ Undo/Redo
  - メモリ予算内で動作
  - **Undo メモリ実機計測（Perf-M2）**: Flood Fill 最悪ケース（全画面塗りつぶし）× 30 ステップを実行し、実メモリ使用量を計測する。要件 §6.2 のピーク 1GB を超えないことを確認

---

### M4: Flood Fill + マジックワンド + マスクペイント + 透過化

- WASM `flood_fill` / `magic_wand` / `paint_selection` / `delete_selected` 実装
- 選択範囲 SelectionMask の WASM 側管理
- マスクペイントの Shift/Alt モード組合せ（§3.4 シーケンス参照）
- 受入:
  - Flood Fill (FHD) ≤ 200ms / (4K) ≤ 600ms を実機計測でクリア
  - マジックワンド (FHD) ≤ 300ms
  - **Flood Fill 性能分解ベンチ（C4）**: 以下を別々に計測し、ボトルネック特定可能にする
    - WASM 内部の実行時間（flood_fill 関数本体、criterion で計測）
    - JS-WASM 境界コスト（引数コピー + 戻り値シリアライズ）
    - Konva 再描画コスト（dirty タイル再合成）
  - 計測結果は `tests/benchmarks/` の README に記録、性能予算未達時は ADR-0003 §「境界変更の判断基準」に従う

### M5: 出力 + 自動アップデート + リリース

- ラスター出力（PNG/JPEG/WebP）
- Layered SVG 出力（ADR-0004 ストリーミング集約方式）
- tauri-plugin-updater 統合（ADR-0005 public ミラー構成）
- ダウングレード防御層（§10.1）
- `.github/workflows/release.yml`（public ミラー push）
- `cargo audit` CI 統合（ADR-0006）
- 受入:
  - Layered SVG 出力 (FHD) ≤ 2.0 秒
  - インストーラサイズ ≤ 15MB
  - 自動アップデート E2E（テスト配信→検知→DL→再起動）成功
  - ダウングレード攻撃シナリオ（古いバージョンの `latest.json` を擬似配信）で更新がブロックされる
  - **SVG 出力単体 criterion ベンチ（Perf-M3）**: M5 着手前に以下を criterion ベンチとして実装し、ベースライン値を取得
    - `path_extract`（連結成分解析 + 輪郭抽出）の WASM 単体実行時間
    - タイル単位ストリーミング集約の中間メモリピーク
    - これにより SVG 出力 2.0 秒予算未達時の改善対象を即座に特定可能とする

---

## 14. テスト戦略（Arch-M4）

レイヤー別にテスト方針を確定する。本セクションが正典、個別マイルストーンの受入基準とは独立に維持する。

### 14.1 レイヤー別方針

| レイヤー | 種別 | ツール | 配置 | 主な対象 |
|---------|------|--------|------|---------|
| TS フロントエンド | unit | vitest | `tests/unit/` | Zustand store のロジック、純粋関数（座標変換 / タイル ID 計算）、PatchRecorder / PatchApplier の双方向適用 |
| TS フロントエンド | integration | Playwright (WebView2) | `tests/integration/` | 画像読込→ブラシ→Undo→保存の E2E、ショートカット、マジックワンド + マスクペイント + Delete のシーケンス |
| WASM (Rust) | unit | `cargo test` (`crates/choco-wasm`) | クレート内 `#[cfg(test)]` | flood_fill / magic_wand / path_extract の入出力検証、境界条件、ヘッダなしバイト配列での panic 非発生 |
| Tauri Core (Rust) | unit | `cargo test` (`src-tauri`) | クレート内 `#[cfg(test)]` | swap_in/out の UUID バリデーション、画像デコーダ硬化（不正バイト列の拒否）、AppError シリアライズ |
| Bench | criterion | `cargo bench` | `tests/benchmarks/` | Flood Fill 分解計測（C4）、SVG path_extract（Perf-M3）、Undo パッチ生成 / 適用 |
| CI 静的検査 | lint / audit | clippy / cargo audit / eslint | `.github/workflows/build.yml` | コード品質と既知脆弱性（ADR-0006） |

### 14.2 カバレッジ・ゲート

- WASM コア関数（flood_fill / magic_wand / path_extract / paint_selection）は **行カバレッジ 80% 以上** を目標
- TS の純粋ユーティリティ（座標変換 / パッチ生成）も 80% 目標
- 統合テストは「主要ユースケースを通る」ことが目的でカバレッジ閾値は設定しない
- benchmark は「失敗判定」を持たないが、ベースライン値からの大幅退行（±20%）を PR コメントで警告

### 14.3 テスト固有の決定事項

- WASM テストは `wasm-bindgen-test` を併用し、ブラウザ環境固有の挙動も含めて検証する（ただし MVP は `cargo test` ベースで開始、必要時に追加）
- Playwright は WebView2 ターゲットで実行。CI では Windows runner 必須
- 画像入力テストは `tests/fixtures/` 配下に最小限のサンプル画像を配置（PNG/JPEG/WebP/BMP 各 1）
- フィクスチャ画像はリポジトリにコミット可（小サイズ）。大型画像はテスト時に生成

### 14.4 マイルストーンとの対応

| マイルストーン | テスト追加 |
|---------------|-----------|
| M1 | プロジェクトセットアップ時に vitest / cargo test / Playwright の足場を作る |
| M2 | 画像読込のバリデーション cargo test、ズーム・パンの vitest |
| M3 | BrushEngine / PatchRecorder の vitest、Undo メモリ実機計測（Perf-M2） |
| M4 | flood_fill / magic_wand の cargo test + criterion ベンチ（C4） |
| M5 | path_extract criterion ベンチ（Perf-M3）、updater E2E Playwright、ダウングレード防御テスト |

---

## 15. Tauri セキュリティ設定（Sec-M3）

Tauri v2 のセキュリティモデルを使い切るための恒久設定を本セクションに集約する。ADR-0006 が判断根拠を、本セクションが実装値を保持する。

### 15.1 Content Security Policy

`src-tauri/tauri.conf.json` の `app.security.csp` に以下を設定する。

```jsonc
{
  "app": {
    "security": {
      "csp": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://github.com https://*.githubusercontent.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    }
  }
}
```

各ディレクティブの意図:

| ディレクティブ | 値 | 理由 |
|---------------|----|------|
| `default-src` | `'self'` | 既定で同一オリジン以外のリソース読込を拒否 |
| `script-src` | `'self' 'wasm-unsafe-eval'` | WASM 実行に `wasm-unsafe-eval` が必須（CSP 仕様）。`unsafe-eval`（JS eval）は許可しない |
| `style-src` | `'self' 'unsafe-inline'` | React / Konva がインラインスタイルを生成するため `unsafe-inline` 許容。将来 styled-components 等を導入する場合は nonce 化を検討 |
| `img-src` | `'self' data: blob:` | base64 埋め込み（Layered SVG プレビュー）と ImageBitmap 由来 blob URL |
| `connect-src` | `'self' https://github.com https://*.githubusercontent.com` | Updater public ミラーへの fetch（ADR-0005）。それ以外の外部接続は遮断 |
| `object-src` | `'none'` | `<object>` / `<embed>` 経由のプラグイン読込禁止 |
| `base-uri` | `'self'` | `<base>` タグの書き換え攻撃を防止 |
| `frame-ancestors` | `'none'` | 自身が iframe に埋め込まれることを禁止 |

### 15.2 Capabilities 設計

`src-tauri/capabilities/` 配下に以下のファイルを配置する。

```
src-tauri/capabilities/
├── default.json                # アプリ全体のデフォルト権限
└── (必要に応じてウィンドウ別 capability を追加)
```

#### default.json の方針

| 領域 | 設定 |
|------|------|
| Choco 専用 `#[tauri::command]` | `open_image`, `save_image`, `swap_out_tile`, `swap_in_tile` のみ allowlist に追加 |
| `core:event` | アプリ内通信に必要な最小限のみ許可 |
| `core:window` | デフォルトウィンドウ操作（最小化・最大化・閉じる）のみ |
| `fs` プラグイン | **無効化**（Choco は専用コマンド経由で IO を行う） |
| `shell` プラグイン | **無効化** |
| `process` プラグイン | **無効化**（Updater プラグインは別途必要分のみ有効） |
| `updater` プラグイン | `check` / `download_and_install` のみ allowlist |

#### open_image のパス受理ルール

任意パス文字列を JS から直接 invoke 引数として受け取らない。受理経路は以下のみ:

1. **ファイルダイアログ経由**: Tauri 標準のファイルダイアログ API（`@tauri-apps/plugin-dialog`）の戻り値として得たパスを `open_image` に渡す
2. **DnD 経由**: WebView2 のドロップイベントでファイルパスを取得し、`open_image` に渡す

JS 側に任意パス入力 UI を設けない。ファイル名直打ち欄や URL バー的な経路は設計しない。

Rust 側でもパスのバリデーションを行う:

- 拡張子チェック（PNG / JPEG / WebP / BMP のみ）
- ファイルサイズ上限チェック（要件 §6.3、50MB）
- `image::io::Reader::with_guessed_format()` でマジックバイト検証（ADR-0006）
- canonicalize 後の絶対パスでログ記録

#### 例（default.json 概形）

```jsonc
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Choco デフォルト権限",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:allow-open",
    "updater:default",
    {
      "identifier": "core:webview:allow-create-webview",
      "allow": []
    }
  ]
}
```

具体的なキー名は Tauri v2 の capabilities スキーマ仕様に依存するため、M1 のプロジェクトセットアップ時にスキーマ生成出力で確定させる（※実装着手時要確認）。

### 15.3 その他の設定

- `tauri.conf.json` の `app.macOSPrivateApi` / `app.withGlobalTauri` は **false**（既定）を維持
- `bundle.publisher` を社内名義で明示設定
- `bundle.copyright` / `bundle.licenseFile` 明示
- ビルド時に `--strict` / `--frozen` 系オプションを CI で強制（依存バージョン固定）

---

## 改訂履歴

| Ver | 日付 | 変更内容 |
|-----|------|---------|
| 1.0 | 2026-05-27 | 初版 |
| 1.1 | 2026-05-27 | レビュー指摘 C1-C4 / Arch-M1-M4 / Sec-M1-M3 / Perf-M1-M4 を反映。§3.4 マジックワンド複合シーケンス追加、§4.5 タイル swap ID Rust 側 UUID 化、§4.6 BrushEngine 所有権・ライフサイクル追加、§5.2 スワップ禁止ルールと Source of Truth 追加、§6.3 Undo 動的サイズ比較切替、§10 public ミラー配信と §10.1 ダウングレード防御、§13 M3/M4/M5 受入基準にメモリ実測・性能分解ベンチ・SVG ベンチを追加、§14 テスト戦略・§15 Tauri セキュリティ設定を新設 |
