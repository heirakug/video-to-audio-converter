'use client';

import { useState, useRef, useEffect } from 'react';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

export default function VideoToAudioConverter() {
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isFFmpegLoading, setIsFFmpegLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [isCached, setIsCached] = useState<boolean>(false);
  const [mounted, setMounted] = useState<boolean>(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ffmpegRef = useRef<any>(null);
  const messageRef = useRef<HTMLDivElement>(null);

  // ローカルストレージキー
  const FFMPEG_CACHE_KEY = 'ffmpeg_cache_status';
  const FFMPEG_VERSION_KEY = 'ffmpeg_version';
  const CURRENT_VERSION = '0.12.6';

  // ストレージ可用性チェック
  const isStorageAvailable = (type: 'localStorage' | 'indexedDB' | 'cacheAPI'): boolean => {
    try {
      switch (type) {
        case 'localStorage':
          const test = '__storage_test__';
          localStorage.setItem(test, test);
          localStorage.removeItem(test);
          return true;
        case 'indexedDB':
          return 'indexedDB' in window && indexedDB !== null;
        case 'cacheAPI':
          return 'caches' in window;
        default:
          return false;
      }
    } catch {
      return false;
    }
  };

  // IndexedDBでFFmpegファイルをキャッシュ
  const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
      if (!isStorageAvailable('indexedDB')) {
        reject(new Error('IndexedDB not available'));
        return;
      }
      
      const request = indexedDB.open('FFmpegCache', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'name' });
        }
      };
    });
  };

  // Cache APIを使用したキャッシュ取得（フォールバック）
  const getCachedFileFromCacheAPI = async (fileName: string): Promise<Uint8Array | null> => {
    try {
      if (!isStorageAvailable('cacheAPI')) {
        return null;
      }
      
      const cache = await caches.open('ffmpeg-cache-v1');
      const response = await cache.match(`/ffmpeg/${fileName}`);
      
      if (response) {
        const buffer = await response.arrayBuffer();
        return new Uint8Array(buffer);
      }
      return null;
    } catch (error) {
      console.warn('Failed to get cached file from Cache API:', error);
      return null;
    }
  };

  // キャッシュからファイルを取得（複数の方法を試行）
  const getCachedFile = async (fileName: string): Promise<Uint8Array | null> => {
    // 1. IndexedDBから取得を試行
    try {
      if (isStorageAvailable('indexedDB')) {
        const db = await openDB();
        const transaction = db.transaction(['files'], 'readonly');
        const store = transaction.objectStore('files');
        const request = store.get(fileName);
        
        const result = await new Promise<{name: string; data: number[]; version: string; timestamp: number} | undefined>((resolve, reject) => {
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
        
        if (result && result.version === CURRENT_VERSION) {
          console.log(`✅ Found ${fileName} in IndexedDB`);
          return new Uint8Array(result.data);
        }
      }
    } catch (error) {
      console.warn('IndexedDB failed, trying Cache API:', error);
    }
    
    // 2. Cache APIから取得を試行
    const cacheResult = await getCachedFileFromCacheAPI(fileName);
    if (cacheResult) {
      console.log(`✅ Found ${fileName} in Cache API`);
      return cacheResult;
    }
    
    console.log(`❌ No cache found for ${fileName}`);
    return null;
  };

  // Cache APIにファイルを保存（フォールバック）
  const setCachedFileInCacheAPI = async (fileName: string, data: Uint8Array): Promise<void> => {
    try {
      if (!isStorageAvailable('cacheAPI')) {
        return;
      }
      
      const cache = await caches.open('ffmpeg-cache-v1');
      const response = new Response(data, {
        headers: {
          'Content-Type': fileName.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
          'Cache-Version': CURRENT_VERSION,
          'Cache-Timestamp': Date.now().toString()
        }
      });
      
      await cache.put(`/ffmpeg/${fileName}`, response);
      console.log(`✅ Cached ${fileName} in Cache API`);
    } catch (error) {
      console.warn('Failed to cache file in Cache API:', error);
    }
  };

  // ファイルをキャッシュに保存（複数の方法で保存）
  const setCachedFile = async (fileName: string, data: Uint8Array): Promise<void> => {
    const promises: Promise<void>[] = [];
    
    // 1. IndexedDBに保存を試行
    if (isStorageAvailable('indexedDB')) {
      promises.push(
        (async () => {
          try {
            const db = await openDB();
            const transaction = db.transaction(['files'], 'readwrite');
            const store = transaction.objectStore('files');
            await store.put({
              name: fileName,
              data: Array.from(data),
              version: CURRENT_VERSION,
              timestamp: Date.now()
            });
            console.log(`✅ Cached ${fileName} in IndexedDB`);
          } catch (error) {
            console.warn('Failed to cache file in IndexedDB:', error);
          }
        })()
      );
    }
    
    // 2. Cache APIに保存を試行
    promises.push(setCachedFileInCacheAPI(fileName, data));
    
    // 並行実行して、どちらかが成功すればOK
    await Promise.allSettled(promises);
  };

  // キャッシュ状態をチェック
  const checkCache = async (): Promise<boolean> => {
    try {
      console.log('🔍 Checking cache availability...');
      const coreFile = await getCachedFile('ffmpeg-core.js');
      const wasmFile = await getCachedFile('ffmpeg-core.wasm');
      const hasCache = coreFile !== null && wasmFile !== null;
      console.log(`Cache status: ${hasCache ? '✅ Available' : '❌ Not found'}`);
      return hasCache;
    } catch (error) {
      console.warn('Cache check failed:', error);
      return false;
    }
  };

  // キャッシュ状態を保存
  const saveCache = () => {
    try {
      if (isStorageAvailable('localStorage')) {
        localStorage.setItem(FFMPEG_VERSION_KEY, CURRENT_VERSION);
        localStorage.setItem(FFMPEG_CACHE_KEY, 'loaded');
        console.log('✅ Cache status saved to localStorage');
      } else {
        console.warn('⚠️ localStorage not available, cache status not saved');
      }
    } catch (error) {
      console.warn('Failed to save cache status:', error);
    }
  };

  // キャッシュをクリア
  const clearCache = async () => {
    try {
      // localStorage クリア
      if (isStorageAvailable('localStorage')) {
        localStorage.removeItem(FFMPEG_VERSION_KEY);
        localStorage.removeItem(FFMPEG_CACHE_KEY);
        console.log('✅ localStorage cache cleared');
      }
      
      // IndexedDBのキャッシュもクリア
      if (isStorageAvailable('indexedDB')) {
        try {
          const db = await openDB();
          const transaction = db.transaction(['files'], 'readwrite');
          const store = transaction.objectStore('files');
          await store.clear();
          console.log('✅ IndexedDB cache cleared');
        } catch (error) {
          console.warn('Failed to clear IndexedDB cache:', error);
        }
      }
      
      // Cache APIのキャッシュもクリア
      if (isStorageAvailable('cacheAPI')) {
        try {
          await caches.delete('ffmpeg-cache-v1');
          console.log('✅ Cache API cache cleared');
        } catch (error) {
          console.warn('Failed to clear Cache API cache:', error);
        }
      }
      
      setIsCached(false);
      console.log('✅ All caches cleared successfully');
    } catch (error) {
      console.warn('Failed to clear cache:', error);
    }
  };

  // 初期化時にキャッシュ状態をチェック
  useEffect(() => {
    setMounted(true);
    const initCache = async () => {
      console.log('🚀 Initializing cache check...');
      console.log('📱 Device info:', {
        userAgent: navigator.userAgent,
        localStorage: isStorageAvailable('localStorage'),
        indexedDB: isStorageAvailable('indexedDB'),
        cacheAPI: isStorageAvailable('cacheAPI'),
        private: window.navigator.storage ? 'Persistent' : 'Possibly Private'
      });
      
      const cached = await checkCache();
      setIsCached(cached);
      if (cached) {
        setStatusMessage('キャッシュからFFmpegを自動読み込み中...');
        // キャッシュがある場合は自動でFFmpegを読み込み
        try {
          await load();
        } catch (error) {
          console.error('Auto-load failed:', error);
          setStatusMessage('自動読み込みに失敗しました。手動で読み込んでください。');
        }
      } else {
        console.log('ℹ️ No cache found, manual load required');
      }
    };
    initCache();
  }, []);

  const load = async () => {
    try {
      setIsFFmpegLoading(true);
      setStatusMessage('FFmpegを読み込んでいます...');
      console.log('🚀 Starting FFmpeg load process...');
      
      // FFmpegが既に読み込み済みかチェック
      if (ffmpegRef.current && ffmpegRef.current.loaded) {
        console.log('✅ FFmpeg already loaded, skipping...');
        setIsReady(true);
        setStatusMessage('FFmpegは既に読み込み済みです');
        setIsFFmpegLoading(false);
        return;
      }
      
      console.log('📦 Importing @ffmpeg/ffmpeg...');
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      console.log('✅ FFmpeg imported successfully');
      
      console.log('🔧 Creating FFmpeg instance...');
      const ffmpeg = new FFmpeg();
      ffmpegRef.current = ffmpeg;
      console.log('✅ FFmpeg instance created');
      
      // より安定したバージョンを使用
      const BASE_URL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
      console.log('🌐 Using BASE_URL:', BASE_URL);
      
      console.log('📋 Setting up event listeners...');
      ffmpeg.on('log', ({ message }: { message: string }) => {
        console.log('📝 FFmpeg log:', message);
        if (messageRef.current) {
          messageRef.current.innerHTML = message;
        }
      });

      ffmpeg.on('progress', ({ progress }: { progress: number }) => {
        console.log('📊 FFmpeg progress:', progress);
        setProgress(Math.round(progress * 100));
      });

      // キャッシュから読み込みを試行
      console.log('⚡ Checking cache...');
      const cachedCore = await getCachedFile('ffmpeg-core.js');
      const cachedWasm = await getCachedFile('ffmpeg-core.wasm');

      let coreURL: string;
      let wasmURL: string;

      if (cachedCore && cachedWasm) {
        console.log('🎯 Using cached files!');
        setStatusMessage('キャッシュからFFmpegを読み込んでいます（高速）...');
        
        // キャッシュされたファイルからBlobURLを作成
        coreURL = URL.createObjectURL(new Blob([cachedCore], { type: 'text/javascript' }));
        wasmURL = URL.createObjectURL(new Blob([cachedWasm], { type: 'application/wasm' }));
        
        console.log('✅ Cache URLs created');
      } else {
        console.log('🔽 Downloading FFmpeg core files...');
        setStatusMessage('FFmpegコアファイルをダウンロードしています（初回のみ）...');

        try {
          console.log('  - Loading core.js...');
          coreURL = await toBlobURL(`${BASE_URL}/ffmpeg-core.js`, 'text/javascript');
          console.log('  - Core.js loaded');
        } catch (error) {
          console.error('❌ Failed to load ffmpeg-core.js:', error);
          throw new Error('Cannot load ffmpeg-core.js from CDN');
        }
        
        try {
          console.log('  - Loading core.wasm...');
          wasmURL = await toBlobURL(`${BASE_URL}/ffmpeg-core.wasm`, 'application/wasm');
          console.log('  - Core.wasm loaded');
        } catch (error) {
          console.error('❌ Failed to load ffmpeg-core.wasm:', error);
          throw new Error('Cannot load ffmpeg-core.wasm from CDN');
        }

        // ダウンロードしたファイルをキャッシュに保存
        try {
          console.log('💾 Saving to cache...');
          const coreResponse = await fetch(coreURL);
          const wasmResponse = await fetch(wasmURL);
          
          if (coreResponse.ok && wasmResponse.ok) {
            const coreData = new Uint8Array(await coreResponse.arrayBuffer());
            const wasmData = new Uint8Array(await wasmResponse.arrayBuffer());
            
            await setCachedFile('ffmpeg-core.js', coreData);
            await setCachedFile('ffmpeg-core.wasm', wasmData);
            
            console.log('✅ Files cached successfully');
          }
        } catch (error) {
          console.warn('Failed to cache files:', error);
        }
      }

      console.log('🎯 Calling ffmpeg.load()...');
      setStatusMessage('FFmpegを初期化しています...');
      await ffmpeg.load({
        coreURL,
        wasmURL,
      });
      console.log('✅ FFmpeg loaded successfully!');
      
      setIsReady(true);
      setStatusMessage('FFmpegの読み込みが完了しました！');
      console.log('🎉 FFmpeg is ready to use!');
      
      // キャッシュ状態を保存
      saveCache();
      setIsCached(true);
      
    } catch (error) {
      console.error('❌ Error during FFmpeg load:', error);
      setStatusMessage('FFmpegの読み込みに失敗しました。再試行してください。');
      console.error('Error details:', {
        name: (error as Error)?.name,
        message: (error as Error)?.message,
        stack: (error as Error)?.stack,
      });
      throw error;
    } finally {
      setIsFFmpegLoading(false);
    }
  };

  const validateVideoFile = (file: File): string | null => {
    // ファイルサイズチェック (250MB = 250 * 1024 * 1024 bytes)
    const maxSize = 250 * 1024 * 1024;
    if (file.size > maxSize) {
      return `ファイルサイズが大きすぎます。${Math.round(file.size / 1024 / 1024)}MBのファイルですが、250MB以下にしてください。大きなファイルは処理に時間がかかり、ブラウザがクラッシュする可能性があります。`;
    }

    // 対応フォーマットチェック
    const supportedFormats = [
      'video/mp4', 'video/avi', 'video/mov', 'video/quicktime', 
      'video/mkv', 'video/x-msvideo', 'video/webm', 'video/x-flv'
    ];
    
    if (!supportedFormats.includes(file.type) && !file.name.match(/\.(mp4|avi|mov|mkv|webm|flv)$/i)) {
      return `対応していないファイル形式です。対応形式: MP4, AVI, MOV, MKV, WebM, FLV`;
    }

    return null; // エラーなし
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    
    if (!file) {
      setSelectedFile(null);
      setStatusMessage('');
      return;
    }

    // ファイル検証
    const validationError = validateVideoFile(file);
    if (validationError) {
      setStatusMessage(validationError);
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
    setStatusMessage(`ファイル「${file.name}」が選択されました（${Math.round(file.size / 1024 / 1024 * 100) / 100}MB）`);
    setAudioUrl(null); // 前回の結果をクリア
  };

  const handleVideoConversion = async () => {
    if (!selectedFile) return;

    if (!isReady) {
      setStatusMessage('FFmpegがまだ準備できていません。先にFFmpegを読み込んでください。');
      return;
    }

    setIsLoading(true);
    setProgress(0);
    setAudioUrl(null);
    setStatusMessage('動画ファイルを処理しています...');
    
    const videoName = selectedFile.name;
    const audioName = `${videoName.split('.')[0]}.mp3`;
    setFileName(audioName);

    try {
      const ffmpeg = ffmpegRef.current;
      if (!ffmpeg) return;
      
      setStatusMessage('ファイルをアップロードしています...');
      await ffmpeg.writeFile(videoName, await fetchFile(selectedFile));
      
      setStatusMessage('動画の情報を確認しています...');
      // 最初にファイル情報を取得して音声トラックの有無を確認
      await ffmpeg.exec(['-i', videoName, '-f', 'null', '-']);
      
      // ログから音声トラックの確認
      const logElement = messageRef.current;
      const logContent = logElement?.innerHTML || '';
      
      if (!logContent.includes("Audio:") && !logContent.includes("Stream #0:1")) {
        // 音声トラックが見つからない場合の警告
        setStatusMessage('⚠️ 音声トラックが検出されませんでした。変換を試行します...');
      }
      
      setStatusMessage('音声を抽出しています...');
      await ffmpeg.exec(['-i', videoName, '-q:a', '0', '-map', 'a', audioName]);
      
      setStatusMessage('音声ファイルを生成しています...');
      const data = await ffmpeg.readFile(audioName);
      const audioBlob = new Blob([data], { type: 'audio/mp3' });
      const url = URL.createObjectURL(audioBlob);
      
      setAudioUrl(url);
      setStatusMessage('変換が完了しました！音声ファイルをダウンロードできます。');
      
      await ffmpeg.deleteFile(videoName);
      await ffmpeg.deleteFile(audioName);
    } catch (error) {
      console.error('Error during conversion:', error);
      
      // エラーの種類に応じてメッセージを変更
      let errorMessage = '変換中にエラーが発生しました。';
      
      if (error instanceof Error) {
        if (error.message.includes('FS error') || error.message.includes('Aborted')) {
          // FFmpegログから音声トラックの有無を確認
          const logElement = messageRef.current;
          const logContent = logElement?.innerHTML || '';
          
          if (logContent.includes("Stream map 'a' matches no streams") || 
              logContent.includes("No audio stream") || 
              !logContent.includes("Audio:")) {
            errorMessage = `この動画ファイルには音声トラックが含まれていません。\n\n画面収録で音声を録音していない場合によく発生します。\n\n解決方法:\n• 音声付きで録画し直してください\n• 画面収録時にマイクをオンにしてください\n• 音声トラックを含む動画ファイルを選択してください`;
          } else {
            errorMessage = `このファイル形式は対応していないか、ファイルが破損している可能性があります。\n\n対応形式: MP4, AVI, MOV, MKV, WebM, FLV\n\n別のファイルで再試行してください。`;
          }
        } else if (error.message.includes('timeout')) {
          errorMessage = 'ファイル処理がタイムアウトしました。ファイルサイズが大きすぎる可能性があります。';
        } else if (error.message.includes('memory')) {
          errorMessage = 'メモリ不足です。より小さなファイルで再試行してください。';
        } else {
          errorMessage = `変換エラー: ${error.message}\n\n別のファイルで再試行してください。`;
        }
      }
      
      setStatusMessage(errorMessage);
      alert(errorMessage);
    } finally {
      setIsLoading(false);
      setProgress(0);
    }
  };

  const downloadAudio = () => {
    if (audioUrl) {
      setStatusMessage('ダウンロードを開始しています...');
      const a = document.createElement('a');
      a.href = audioUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      // ダウンロード完了のフィードバック
      setTimeout(() => {
        setStatusMessage('ダウンロードが完了しました！');
      }, 1000);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h1 className="text-3xl font-bold text-center mb-6 text-gray-800">
          動画から音声抽出
        </h1>
        
        {!isReady && (
          <div className="text-center mb-6">
            {/* キャッシュがない場合のみボタンを表示 */}
            {!isCached && (
              <>
                <button
                  onClick={load}
                  disabled={isFFmpegLoading}
                  className="bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg transition-colors cursor-pointer"
                >
                  {isFFmpegLoading ? '読み込み中...' : 'FFmpegを読み込む'}
                </button>
                <p className="text-sm text-gray-600 mt-2">
                  初回のFFmpegダウンロードが必要です（約10MB、次回以降はキャッシュで瞬時起動）
                </p>
              </>
            )}
            
            {/* キャッシュがある場合は自動読み込み状態を表示 */}
            {isCached && isFFmpegLoading && (
              <div className="animate-pulse">
                <div className="w-16 h-16 mx-auto mb-4 bg-blue-100 rounded-full flex items-center justify-center">
                  <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
                <p className="text-blue-600 font-medium">キャッシュからFFmpegを自動読み込み中...</p>
              </div>
            )}
            
            {statusMessage && (
              <div className="mt-3 p-2 bg-blue-50 border border-blue-200 rounded text-blue-700 text-sm">
                {statusMessage}
              </div>
            )}
            
            {/* ストレージ情報とトラブルシューティング */}
            {mounted && (
              <div className="mt-3 text-xs space-y-2">
                {!isStorageAvailable('localStorage') && (
                  <div className="p-2 bg-yellow-50 border border-yellow-200 rounded text-yellow-700">
                    ⚠️ プライベートモードまたはストレージが無効です
                  </div>
                )}
                
                {/* キャッシュクリアボタンは常に表示（トラブルシューティング用） */}
                {isCached && !isFFmpegLoading && (
                  <div className="p-2 bg-green-50 border border-green-200 rounded text-green-700 flex items-center justify-between">
                    <span>⚡ FFmpegキャッシュ済み（自動読み込み中...）</span>
                    <button
                      onClick={clearCache}
                      className="text-xs bg-green-100 hover:bg-green-200 px-2 py-1 rounded transition-colors"
                    >
                      キャッシュクリア
                    </button>
                  </div>
                )}
                
                {!isCached && !isFFmpegLoading && (
                  <div className="p-2 bg-gray-50 border border-gray-200 rounded text-gray-600">
                    💡 デバッグ情報: {isStorageAvailable('indexedDB') ? 'IndexedDB✅' : 'IndexedDB❌'} | 
                    {isStorageAvailable('cacheAPI') ? 'Cache API✅' : 'Cache API❌'} | 
                    {isStorageAvailable('localStorage') ? 'localStorage✅' : 'localStorage❌'}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {isReady && (
          <>
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                動画ファイルを選択（最大250MB）
              </label>
              <input
                type="file"
                accept="video/*,.mp4,.avi,.mov,.mkv,.webm,.flv"
                onChange={handleFileSelect}
                disabled={isLoading}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 file:cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <p className="text-xs text-gray-500 mt-1">
                対応形式: MP4, AVI, MOV, MKV, WebM, FLV
              </p>
            </div>

            {/* エラーメッセージ表示 */}
            {statusMessage && !selectedFile && !isLoading && !isReady && statusMessage.includes('失敗') && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                <h3 className="text-lg font-semibold text-red-800 mb-2">
                  ⚠️ ファイルエラー
                </h3>
                <p className="text-red-700 mb-3">
                  {statusMessage}
                </p>
                <div className="text-sm text-red-600 bg-red-100 p-3 rounded">
                  <p className="font-semibold mb-2">💡 解決方法:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>ファイルサイズが大きい場合: 動画編集ソフトで圧縮してください</li>
                    <li>対応していない形式の場合: MP4, AVI, MOV, MKV, WebM, FLVに変換してください</li>
                    <li>音声トラックがない場合: 音声付きで録画し直してください</li>
                    <li>画面収録時: マイクをオンにして音声も録音してください</li>
                    <li>推奨: ファイルサイズ100MB以下、形式はMP4が最も安定しています</li>
                    <li>MacのQuickTimeで画面収録した場合: 「ファイル」→「書き出す」で圧縮できます</li>
                  </ul>
                </div>
              </div>
            )}

            {/* ファイル選択後の情報と変換ボタン */}
            {selectedFile && !isLoading && (
              <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h3 className="text-lg font-semibold text-blue-800 mb-2">
                  ✅ 選択されたファイル
                </h3>
                <div className="space-y-2 text-sm text-blue-700">
                  <p><strong>ファイル名:</strong> {selectedFile.name}</p>
                  <p><strong>サイズ:</strong> {Math.round(selectedFile.size / 1024 / 1024 * 100) / 100} MB</p>
                  <p><strong>形式:</strong> {selectedFile.type || '不明'}</p>
                </div>
                <button
                  onClick={handleVideoConversion}
                  disabled={isLoading}
                  className="mt-4 bg-green-500 hover:bg-green-600 disabled:bg-green-300 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg transition-colors cursor-pointer"
                >
                  🎵 音声に変換する
                </button>
              </div>
            )}

            {isLoading && (
              <div className="mb-6">
                <div className="bg-gray-200 rounded-full h-4">
                  <div
                    className="bg-blue-500 h-4 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
                <p className="text-center text-sm text-gray-600 mt-2">
                  変換中... {progress}%
                </p>
                {statusMessage && (
                  <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-yellow-700 text-sm text-center">
                    {statusMessage}
                  </div>
                )}
              </div>
            )}

            {audioUrl && (
              <div className="mb-6 p-4 bg-green-50 rounded-lg">
                <h3 className="text-lg font-semibold text-green-800 mb-3">
                  変換完了！
                </h3>
                <audio controls className="w-full mb-4">
                  <source src={audioUrl} type="audio/mp3" />
                  Your browser does not support the audio element.
                </audio>
                <button
                  onClick={downloadAudio}
                  className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded transition-colors cursor-pointer"
                >
                  MP3をダウンロード
                </button>
                {statusMessage && statusMessage.includes('ダウンロード') && (
                  <div className="mt-2 p-2 bg-green-100 border border-green-200 rounded text-green-700 text-sm">
                    {statusMessage}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <div className="text-xs text-gray-500 mt-4">
          <p className="mb-1">• 対応形式: MP4, AVI, MOV, MKV, WebM, FLV</p>
          <p className="mb-1">• ファイルはブラウザ内で処理されます（サーバーに送信されません）</p>
          <p className="mb-1">• 大きなファイルは処理に時間がかかる場合があります</p>
          <p>• ファイルが破損している場合やサポートされていない形式の場合はエラーになります</p>
        </div>

        <div ref={messageRef} className="text-xs text-gray-400 mt-2 font-mono min-h-[1rem]"></div>
      </div>
    </div>
  );
}