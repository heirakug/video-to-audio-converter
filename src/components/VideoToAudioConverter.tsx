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
  const ffmpegRef = useRef<any>(null);
  const messageRef = useRef<HTMLDivElement>(null);

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
      ffmpeg.on('log', ({ message }: any) => {
        console.log('📝 FFmpeg log:', message);
        if (messageRef.current) {
          messageRef.current.innerHTML = message;
        }
      });

      ffmpeg.on('progress', ({ progress }: any) => {
        console.log('📊 FFmpeg progress:', progress);
        setProgress(Math.round(progress * 100));
      });

      console.log('🔽 Loading FFmpeg core files...');
      
      // ファイルを個別に取得してエラーハンドリング
      let coreURL, wasmURL;
      
      try {
        console.log('  - Loading core.js...');
        setStatusMessage('FFmpegコアファイルを読み込んでいます...');
        coreURL = await toBlobURL(`${BASE_URL}/ffmpeg-core.js`, 'text/javascript');
        console.log('  - Core.js loaded:', coreURL);
      } catch (error) {
        console.error('❌ Failed to load ffmpeg-core.js:', error);
        throw new Error('Cannot load ffmpeg-core.js from CDN');
      }
      
      try {
        console.log('  - Loading core.wasm...');
        setStatusMessage('FFmpeg WebAssemblyを読み込んでいます...');
        wasmURL = await toBlobURL(`${BASE_URL}/ffmpeg-core.wasm`, 'application/wasm');
        console.log('  - Core.wasm loaded:', wasmURL);
      } catch (error) {
        console.error('❌ Failed to load ffmpeg-core.wasm:', error);
        throw new Error('Cannot load ffmpeg-core.wasm from CDN');
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
      
    } catch (error) {
      console.error('❌ Error during FFmpeg load:', error);
      setStatusMessage('FFmpegの読み込みに失敗しました。再試行してください。');
      console.error('Error details:', {
        name: error?.name,
        message: error?.message,
        stack: error?.stack,
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
            <button
              onClick={load}
              disabled={isFFmpegLoading}
              className="bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg transition-colors cursor-pointer"
            >
              {isFFmpegLoading ? '読み込み中...' : 'FFmpegを読み込む'}
            </button>
            <p className="text-sm text-gray-600 mt-2">
              初回またはページリロード時にFFmpegの読み込みが必要です（約10MB、2回目以降はキャッシュで高速化）
            </p>
            {statusMessage && (
              <div className="mt-3 p-2 bg-blue-50 border border-blue-200 rounded text-blue-700 text-sm">
                {statusMessage}
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
            {statusMessage && !selectedFile && !isLoading && (
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