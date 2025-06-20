# Video to Audio Converter - 開発ドキュメント

## プロジェクト概要
Next.js + FFmpeg.wasmを使用したクライアントサイドでの動画から音声抽出アプリケーション

## 要件定義

### 機能要件
1. **動画ファイルアップロード機能**
   - 対応形式: MP4, AVI, MOV, MKV等
   - ファイルサイズ推奨: 最大100MB

2. **音声抽出機能**
   - 動画から音声トラックを抽出
   - MP3形式で出力
   - 進捗バー表示

3. **音声再生・ダウンロード機能**
   - 抽出した音声のプレビュー再生
   - MP3ファイルのダウンロード

4. **プライバシー保護**
   - ブラウザ内完結処理（サーバー送信なし）

### 非機能要件
1. **パフォーマンス**
   - FFmpeg初回読み込み時間の最適化
   - メモリ使用量の管理

2. **ユーザビリティ**
   - 直感的なUI/UX
   - 日本語対応

## 技術スタック

### フロントエンド
- **Next.js 15.3.3** (React 19)
- **TypeScript**
- **Tailwind CSS 4**

### 動画処理
- **@ffmpeg/ffmpeg 0.12.15**
- **@ffmpeg/util 0.12.2**

### 開発環境
- **ESLint** (コード品質)
- **Turbopack** (高速開発サーバー)

## アーキテクチャ

### ディレクトリ構造
```
src/
├── app/
│   ├── page.tsx          # メインページ
│   ├── layout.tsx        # レイアウト
│   └── globals.css       # グローバルスタイル
└── components/
    └── VideoToAudioConverter.tsx  # メインコンポーネント
```

### コンポーネント設計
- **VideoToAudioConverter**: メイン機能を統括する単一コンポーネント
- 状態管理: React Hooks (useState, useRef)

## 開発ログ

### 2025-06-20: キャッシュ機能実装

#### 新機能
1. **IndexedDBキャッシュシステム**
   - FFmpegコアファイル（.js/.wasm）のブラウザ内保存
   - バージョン管理機能（現在: 0.12.6）
   - タイムスタンプ付きキャッシュ管理

2. **自動読み込み機能**
   - キャッシュ済みの場合、ページ読み込み時に自動でFFmpeg初期化
   - ユーザーの手動操作が不要（初回のみボタンクリック）

3. **高速化**
   - 初回: CDNダウンロード（約10MB）+ キャッシュ保存
   - 2回目以降: キャッシュから瞬時読み込み
   - 読み込み時間: 数秒 → 1秒未満

4. **キャッシュ管理UI**
   - キャッシュ状態の可視化
   - トラブルシューティング用キャッシュクリア機能

#### 技術詳細
```typescript
// IndexedDBによるファイルキャッシュ
const setCachedFile = async (fileName: string, data: Uint8Array) => {
  const db = await openDB();
  const transaction = db.transaction(['files'], 'readwrite');
  const store = transaction.objectStore('files');
  await store.put({
    name: fileName,
    data: Array.from(data),
    version: CURRENT_VERSION,
    timestamp: Date.now()
  });
};

// キャッシュ優先読み込み
const cachedCore = await getCachedFile('ffmpeg-core.js');
const cachedWasm = await getCachedFile('ffmpeg-core.wasm');
if (cachedCore && cachedWasm) {
  // キャッシュから高速読み込み
  coreURL = URL.createObjectURL(new Blob([cachedCore]));
  wasmURL = URL.createObjectURL(new Blob([cachedWasm]));
}
```

### 2025-06-17: 初期開発・バグ修正

#### 実装完了機能
1. ✅ FFmpeg.wasmの統合
2. ✅ 動画アップロード機能
3. ✅ 音声抽出処理
4. ✅ 進捗表示
5. ✅ 音声再生・ダウンロード
6. ✅ 日本語UI

#### 修正したバグ
1. **FFmpeg動的インポートエラー**
   - **問題**: `Module not found: Can't resolve <dynamic>` エラー
   - **原因**: Next.jsがFFmpegの`import.meta.url`を解決できない
   - **解決策**: next.config.tsでwebpackエイリアス設定
   ```typescript
   config.resolve.alias = {
     ...config.resolve.alias,
     '@ffmpeg/ffmpeg': '@ffmpeg/ffmpeg/dist/esm/index.js',
   };
   ```

#### Next.js設定
- **Webpack設定**:
  - WebAssembly対応 (`asyncWebAssembly: true`)
  - CORS設定 (`Cross-Origin-Embedder-Policy`, `Cross-Origin-Opener-Policy`)
  - FFmpegエイリアス設定

### Webpackカスタマイズ詳細
```typescript
// next.config.ts
webpack: (config, { isServer }) => {
  // WebAssembly設定
  config.experiments = {
    ...config.experiments,
    asyncWebAssembly: true,
  };
  
  // ブラウザ専用設定
  if (!isServer) {
    config.output.crossOriginLoading = 'anonymous';
    config.resolve.alias = {
      '@ffmpeg/ffmpeg': '@ffmpeg/ffmpeg/dist/esm/index.js',
    };
  }
}
```

## 開発コマンド

### 基本コマンド
```bash
# 開発サーバー起動（Turbopack使用）
npm run dev

# プロダクションビルド
npm run build

# ESLint実行
npm run lint
```

### 推奨開発フロー
1. `npm run dev` で開発サーバー起動
2. ブラウザで http://localhost:3000 にアクセス
3. 「FFmpegを読み込む」ボタンクリック（初回のみ）
4. 動画ファイル選択・アップロード
5. 音声抽出完了後、再生・ダウンロード

## 既知の制限事項

1. **ファイルサイズ**: 大容量ファイル（>100MB）は処理時間が長い
2. **ブラウザメモリ**: 大きなファイルはメモリ不足の可能性
3. **初回読み込み**: FFmpeg.wasm（約10MB）のダウンロードが必要

## キャッシュシステム仕様

### ストレージ構成
1. **IndexedDB**: FFmpegコアファイル保存
   - データベース名: `FFmpegCache`
   - オブジェクトストア: `files`
   - キー: ファイル名（`ffmpeg-core.js`, `ffmpeg-core.wasm`）

2. **LocalStorage**: 状態管理
   - `ffmpeg_cache_status`: キャッシュ読み込み状態
   - `ffmpeg_version`: FFmpegバージョン情報

### キャッシュライフサイクル
```
初回アクセス:
CDN → ダウンロード → IndexedDB保存 → FFmpeg初期化

2回目以降:
IndexedDB → 即座に読み込み → FFmpeg初期化
```

### バージョン管理
- 現在バージョン: `0.12.6`
- バージョン不一致時: 自動再ダウンロード
- 手動キャッシュクリア: UI経由で実行可能

## 今後の改善案

1. **プログレス改善**: より詳細な進捗情報表示
2. **フォーマット対応**: WAV, AAC等の出力形式追加
3. **エラーハンドリング**: より詳細なエラーメッセージ
4. **UI改善**: ドラッグ&ドロップ対応
5. **パフォーマンス**: ワーカースレッド活用検討
6. **キャッシュ最適化**: 圧縮キャッシュ、有効期限管理

## トラブルシューティング

### FFmpeg読み込みエラー
- CDNアクセス可能か確認
- ブラウザのCORS設定確認
- **キャッシュ破損**: UIの「キャッシュクリア」ボタンで解決

### 変換エラー
- 対応動画形式か確認
- ファイルサイズが適切か確認
- ブラウザメモリ使用量確認

### キャッシュ関連トラブル
- **自動読み込み失敗**: 手動で「FFmpegを読み込む」を実行
- **古いキャッシュ**: キャッシュクリア後に再読み込み
- **IndexedDB無効**: ブラウザの設定でIndexedDBが無効化されている可能性
- **容量不足**: ブラウザストレージの容量確認

### ビルドエラー
- `next.config.ts`のwebpack設定確認
- パッケージバージョン互換性確認