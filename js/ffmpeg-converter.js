/**
 * LyricsFlow — Client-side FFmpeg WASM Engine (Single-Threaded, No SharedArrayBuffer required)
 * Handles lossless ALAC -> FLAC decoding and bitstream-preserving Dolby Atmos remuxing.
 */

import { FFmpeg } from 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js';
import { toBlobURL } from 'https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js';

class FFmpegAudioConverter {
  constructor() {
    this.ffmpeg = null;
    this.isLoaded = false;
    this.loadingPromise = null;
    this.cache = new Map();
  }

  async load() {
    if (this.isLoaded && this.ffmpeg) return this.ffmpeg;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = (async () => {
      console.log('[FFmpegConverter] Loading single-threaded FFmpeg WASM core...');
      const instance = new FFmpeg();

      // Using single-threaded core UMD build: does NOT require SharedArrayBuffer or COOP/COEP isolation headers
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
      const coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript');
      const wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm');

      await instance.load({
        coreURL,
        wasmURL
      });

      this.ffmpeg = instance;
      this.isLoaded = true;
      console.log('[FFmpegConverter] Single-threaded FFmpeg WASM core loaded successfully.');
      return this.ffmpeg;
    })().catch(err => {
      this.loadingPromise = null;
      console.error('[FFmpegConverter] WASM core failed to load:', err);
      throw err;
    });

    return this.loadingPromise;
  }

  /**
   * Converts an ALAC .m4a buffer to bit-perfect lossless FLAC for universal browser playback.
   */
  async convertAlacToFlac(inputBuffer, cacheKey = null) {
    if (cacheKey && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const ffmpeg = await this.load();
    const inputName = `input_${Date.now()}.m4a`;
    const outputName = `output_${Date.now()}.flac`;

    try {
      const u8Data = inputBuffer instanceof Uint8Array ? inputBuffer : new Uint8Array(inputBuffer);
      await ffmpeg.writeFile(inputName, u8Data);

      console.log(`[FFmpegConverter] Converting ALAC to FLAC (${(u8Data.length / 1024 / 1024).toFixed(2)} MB)...`);
      // -c:a flac decodes ALAC frames and encodes them to lossless FLAC frames with identical PCM audio
      await ffmpeg.exec(['-i', inputName, '-c:a', 'flac', outputName]);

      const outData = await ffmpeg.readFile(outputName);
      if (!outData || outData.length === 0) {
        throw new Error('FLAC output buffer is empty');
      }

      const blob = new Blob([outData.buffer], { type: 'audio/flac' });
      const blobUrl = URL.createObjectURL(blob);

      if (cacheKey) {
        this.cache.set(cacheKey, blobUrl);
      }

      return blobUrl;
    } finally {
      try { await ffmpeg.deleteFile(inputName); } catch {}
      try { await ffmpeg.deleteFile(outputName); } catch {}
    }
  }

  /**
   * Remuxes Dolby Atmos (.m4a containing E-AC-3 JOC) into .mp4 container
   * using stream copy (-c copy -movflags +faststart) with 100% quality preserved.
   */
  async remuxAtmosToMp4(inputBuffer, cacheKey = null) {
    if (cacheKey && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const ffmpeg = await this.load();
    const inputName = `atmos_${Date.now()}.m4a`;
    const outputName = `atmos_${Date.now()}.mp4`;

    try {
      const u8Data = inputBuffer instanceof Uint8Array ? inputBuffer : new Uint8Array(inputBuffer);
      await ffmpeg.writeFile(inputName, u8Data);

      console.log(`[FFmpegConverter] Lossless remuxing Dolby Atmos to MP4 (${(u8Data.length / 1024 / 1024).toFixed(2)} MB)...`);
      await ffmpeg.exec(['-i', inputName, '-c', 'copy', '-movflags', '+faststart', outputName]);

      const outData = await ffmpeg.readFile(outputName);
      if (!outData || outData.length === 0) {
        throw new Error('Atmos MP4 output buffer is empty');
      }

      const blob = new Blob([outData.buffer], { type: 'audio/mp4' });
      const blobUrl = URL.createObjectURL(blob);

      if (cacheKey) {
        this.cache.set(cacheKey, blobUrl);
      }

      return blobUrl;
    } finally {
      try { await ffmpeg.deleteFile(inputName); } catch {}
      try { await ffmpeg.deleteFile(outputName); } catch {}
    }
  }

  prewarm() {
    this.load().catch(() => {});
  }
}

export const ffmpegAudioConverter = new FFmpegAudioConverter();
