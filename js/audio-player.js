import { EQ_BANDS } from './equalizer-presets.js';

const kProducerBufferFrames = 1024;
const kConsumerHz = 112.5;
const kBlendWeight = [0.1, 0.2, 0.3, 0.4];
const kLeakDecay = 0.99607;
const kOnePoleAlpha = 0.5;
const kAgcAttack = 0.3;
const kAgcRelease = 0.01;
const kAgcPeakFloor = 0.0005;
const kAgcGainLo = 0.1;
const kAgcGainHi = 30;
const kLogFloor = 1e-6;
const kLogScale = 1 / 6;
const kLogOffset = -0.25;
const kLogAnchorHz = 40;
const kLogS9 = 5.321928;
const kLogS8Shift = 0.886988;
const kLogTopHz = 16000;
const kBandPowerScale = 262144;

function quinticSmoothstep(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * x * (10 + x * (-15 + 6 * x));
}

/**
 * LyricsFlow — Audio Engine
 * Dual-channel Web Audio graph supporting equalizers and seamless transitions.
 */
export default class AudioPlayer {
  constructor() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.audioContext.createGain();
    this.masterGain.connect(this.audioContext.destination);

    // Analysis tap: wired post-EQ but PRE-masterGain in setupEQ(), so beat
    // detection is independent of the user's output volume.
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0;
    this.analyser.minDecibels = -140;
    this.analyser.maxDecibels = 0;
    this._freqData = new Float32Array(this.analyser.frequencyBinCount);
    this._loudnessData = new Float32Array(this.analyser.fftSize);

    this._agcPeak = 0;
    this._bandPipe = [0, 0, 0, 0];
    this._bandLeak = 0;
    this._bandOut = 0;
    this._producerAcc = 0;
    this._lastTime = 0;

    const sampleRate = this.audioContext.sampleRate;
    const s8 = Math.log2(Math.min(sampleRate / 2, kLogTopHz)) / 6 - kLogS8Shift;
    const edge1 = Math.pow(2, s8 + kLogS9);
    const n = this.analyser.fftSize;
    const maxBin = n / 2 - 1;
    this._bandBinLo = Math.min(Math.max(Math.trunc((kLogAnchorHz * n) / sampleRate), 1), maxBin);
    this._bandBinHi = Math.min(Math.max(Math.trunc((edge1 * n) / sampleRate), 1), maxBin);
    if (this._bandBinHi <= this._bandBinLo) this._bandBinHi = this._bandBinLo + 1;
    this._producerInterval = kProducerBufferFrames / sampleRate;

    // Channel A
    this.audioA = new Audio();
    this.audioA.crossOrigin = 'anonymous';
    this.gainA = this.audioContext.createGain();
    this.sourceA = this.audioContext.createMediaElementSource(this.audioA);
    this.sourceA.connect(this.gainA);

    // Channel B
    this.audioB = new Audio();
    this.audioB.crossOrigin = 'anonymous';
    this.gainB = this.audioContext.createGain();
    this.sourceB = this.audioContext.createMediaElementSource(this.audioB);
    this.sourceB.connect(this.gainB);

    this.currentChannel = 'A';

    // Filter network
    this.eqNodes = [];
    this.setupEQ();

    this.isPlaying = false;
    this.duration = 0;

    // Transition parameters
    this.crossfadeDuration = 0;
    this._crossfadeTriggered = false;

    // Events
    this.onLoadedMetadata = null;
    this.onEnded = null;
    this.onPlay = null;
    this.onPause = null;
    this.onWaiting = null;
    this.onCanPlay = null;
    this.onError = null;
    this.onPositionUpdate = null;
    this.onCrossfadeTrigger = null;

    this._bindChannelEvents(this.audioA, 'A');
    this._bindChannelEvents(this.audioB, 'B');

    this.repeatMode = 0;
    this.shuffleActive = false;

    // Tracking loop
    setInterval(() => {
      if (this.isPlaying) {
        const pos = this.getPosition();
        if (this.onPositionUpdate) this.onPositionUpdate(pos);

        // Evaluate crossfade trigger threshold
        if (
          this.crossfadeDuration > 0 &&
          !this._crossfadeTriggered &&
          this.duration > 0
        ) {
          const remaining = (this.duration - pos) / 1000;
          if (remaining <= this.crossfadeDuration && remaining > 0) {
            this._crossfadeTriggered = true;
            if (this.onCrossfadeTrigger) this.onCrossfadeTrigger();
          }
        }
      }
    }, 100);
  }

  get audio() {
    return this.currentChannel === 'A' ? this.audioA : this.audioB;
  }

  get _inactiveAudio() {
    return this.currentChannel === 'A' ? this.audioB : this.audioA;
  }

  get activeGain() {
    return this.currentChannel === 'A' ? this.gainA : this.gainB;
  }

  get _inactiveGain() {
    return this.currentChannel === 'A' ? this.gainB : this.gainA;
  }

  setupEQ() {
    this.eqNodes = EQ_BANDS.map(freq => {
      const filter = this.audioContext.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = freq;
      filter.Q.value = 1;
      filter.gain.value = 0;
      return filter;
    });

    this.gainA.connect(this.eqNodes[0]);
    this.gainB.connect(this.eqNodes[0]);
    for (let i = 0; i < this.eqNodes.length - 1; i++) {
      this.eqNodes[i].connect(this.eqNodes[i + 1]);
    }
    this.eqNodes[this.eqNodes.length - 1].connect(this.masterGain);
    // Beat-detection tap: post-EQ, pre-volume, so detection never depends
    // on how loud the user listens.
    this.eqNodes[this.eqNodes.length - 1].connect(this.analyser);
  }

  _bindChannelEvents(audioEl, channel) {
    audioEl.addEventListener('loadedmetadata', () => {
      if (this.currentChannel !== channel) return;
      this.duration = audioEl.duration * 1000;
      if (this.onLoadedMetadata) this.onLoadedMetadata(this.duration);
    });

    audioEl.addEventListener('error', () => {
      if (this.currentChannel !== channel) return;
      const err = audioEl.error;
      console.error(`[AudioPlayer] Media error on channel ${channel}:`, err ? { code: err.code, message: err.message } : 'Unknown');
      if (this.onError) this.onError(err);
    });

    audioEl.addEventListener('ended', () => {
      if (this.currentChannel !== channel) return;
      this.handleEnded();
    });

    audioEl.addEventListener('play', () => {
      if (this.currentChannel !== channel) return;
      this.isPlaying = true;
      if (this.onPlay) this.onPlay();
    });

    audioEl.addEventListener('pause', () => {
      if (this.currentChannel !== channel) return;
      this.isPlaying = false;
      if (this.onPause) this.onPause();
    });

    audioEl.addEventListener('waiting', () => {
      if (this.currentChannel !== channel) return;
      if (this.onWaiting) this.onWaiting();
    });

    audioEl.addEventListener('canplay', () => {
      if (this.currentChannel !== channel) return;
      if (this.onCanPlay) this.onCanPlay();
    });
  }

  setEQGain(index, value) {
    if (this.eqNodes[index]) {
      this.eqNodes[index].gain.setTargetAtTime(value, this.audioContext.currentTime, 0.1);
    }
  }

  /**
   * Preload the next track's audio on the inactive channel so that
   * crossfading starts instantaneously without network latency.
   */
  preloadNext(url) {
    if (!url) return;
    const nextAudio = this._inactiveAudio;
    const nextGain = this._inactiveGain;

    nextGain.gain.cancelScheduledValues(this.audioContext.currentTime);
    nextGain.gain.setValueAtTime(0, this.audioContext.currentTime);

    if (nextAudio.src !== url) {
      nextAudio.src = url;
      nextAudio.preload = 'auto';
      nextAudio.load();
    }
  }

  /**
   * Sets new source URL on the active channel and fully tears down inactive
   * channel state to release decoder buffers and prevent split-second playbacks.
   */
  setSource(url) {
    this._silenceChannel(this._inactiveAudio, this._inactiveGain);
    this._crossfadeTriggered = false;
    this._lastTime = 0;
    this._resetLoudness();

    this.activeGain.gain.cancelScheduledValues(this.audioContext.currentTime);
    this.activeGain.gain.setValueAtTime(1, this.audioContext.currentTime);

    const wasPlaying = this.isPlaying;
    this.audio.src = url;
    this.audio.load();
    if (wasPlaying) this.play();
  }

  /**
   * Crossfades active channel down while ramping inactive channel up.
   */
  transitionTo(url, crossfadeSeconds) {
    const ctx = this.audioContext;
    const now = ctx.currentTime;
    const dur = crossfadeSeconds;

    const nextAudio = this._inactiveAudio;
    const nextGain = this._inactiveGain;
    const prevGain = this.activeGain;
    const prevAudio = this.audio;

    const alreadyLoaded = (nextAudio.src === url || nextAudio.currentSrc === url) && nextAudio.readyState >= 2;

    if (!alreadyLoaded) {
      nextAudio.pause();
      nextAudio.src = url;
      nextAudio.load();
    }

    nextGain.gain.cancelScheduledValues(now);
    nextGain.gain.setValueAtTime(0, now);
    nextGain.gain.linearRampToValueAtTime(1, now + dur);

    this.currentChannel = this.currentChannel === 'A' ? 'B' : 'A';
    this._crossfadeTriggered = false;

    nextAudio.play().catch(e => console.warn('Crossfade play failed:', e));

    prevGain.gain.cancelScheduledValues(now);
    prevGain.gain.setValueAtTime(prevGain.gain.value, now);
    prevGain.gain.linearRampToValueAtTime(0, now + dur);

    setTimeout(() => {
      this._silenceChannel(prevAudio, prevGain);
    }, (dur + 0.1) * 1000);
  }

  /**
   * Hard-resets a media element's source state and volume to release OS audio resources.
   */
  _silenceChannel(audioEl, gainNode) {
    gainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
    gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
    audioEl.pause();
    audioEl.removeAttribute('src');
    audioEl.load();
  }

  getPosition() {
    return this.audio.currentTime * 1000;
  }

  getLatencyCompensatedPosition() {
    const latencyMs = ((this.audioContext.outputLatency ?? 0) + (this.audioContext.baseLatency ?? 0)) * 1000;
    return Math.max(0, this.audio.currentTime * 1000 - latencyMs);
  }

  seek(ms) {
    if (this.audioContext.state === 'suspended') this.audioContext.resume();
    this.audio.currentTime = ms / 1000;
  }

  play() {
    if (this.audioContext.state === 'suspended') this.audioContext.resume();
    return this.audio.play().catch(e => console.warn('Playback failed:', e));
  }

  pause() {
    this.audio.pause();
  }

  togglePlay() {
    if (this.audio.paused) {
      this.play();
    } else {
      this.pause();
    }
    return !this.audio.paused;
  }

  handleEnded() {
    if (this.repeatMode === 2) {
      this.seek(0);
      this.play();
    } else {
      if (this.onEnded) this.onEnded();
    }
  }

  setVolume(v) {
    this.masterGain.gain.setTargetAtTime(v, this.audioContext.currentTime, 0.1);
  }

  getVolume() {
    return this.masterGain.gain.value;
  }

  _resetLoudness() {
    this._agcPeak = 0;
    this._bandPipe[0] = 0;
    this._bandPipe[1] = 0;
    this._bandPipe[2] = 0;
    this._bandPipe[3] = 0;
    this._bandLeak = 0;
    this._bandOut = 0;
    this._producerAcc = 0;
  }

  _measureBand() {
    this.analyser.getFloatTimeDomainData(this._loudnessData);
    let peak = this._agcPeak;
    for (let i = 0; i < this._loudnessData.length; i++) {
      const x = Math.abs(this._loudnessData[i]);
      peak += (x > peak ? kAgcAttack : kAgcRelease) * (x - peak);
    }
    if (peak < kAgcPeakFloor) peak = kAgcPeakFloor;
    this._agcPeak = peak;
    const gain = Math.min(Math.max(0.5 / peak, kAgcGainLo), kAgcGainHi);

    this.analyser.getFloatFrequencyData(this._freqData);
    const gainDb = 20 * Math.log10(gain);
    let sum = 0;
    for (let i = this._bandBinLo; i < this._bandBinHi; i++) {
      const db = this._freqData[i] + gainDb;
      if (Number.isFinite(db)) sum += Math.pow(10, db / 10);
    }
    const v =
      Math.log10(kLogFloor + sum * kBandPowerScale) * kLogScale + kLogOffset;
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  getLowFreqLevel() {
    const now = performance.now() / 1000;
    const dt = this._lastTime ? Math.min(0.5, now - this._lastTime) : 0.016;
    this._lastTime = now;

    const raw = this.isPlaying ? this._measureBand() : 0;

    this._producerAcc += dt;
    if (this._producerAcc >= this._producerInterval) {
      this._producerAcc = 0;
      const pipe = this._bandPipe;
      pipe[3] = pipe[2];
      pipe[2] = pipe[1];
      pipe[1] = pipe[0];
      pipe[0] = raw;
    }

    const steps = dt * kConsumerHz;
    const pipe = this._bandPipe;
    const blend =
      kBlendWeight[0] * pipe[0] +
      kBlendWeight[1] * pipe[1] +
      kBlendWeight[2] * pipe[2] +
      kBlendWeight[3] * pipe[3];
    this._bandLeak = Math.max(blend, this._bandLeak * Math.pow(kLeakDecay, steps));
    const alpha = 1 - Math.pow(1 - kOnePoleAlpha, steps);
    const out = this._bandOut + alpha * (this._bandLeak - this._bandOut);
    this._bandOut = out < 0 ? 0 : out > 1 ? 1 : out;
    const published = quinticSmoothstep(this._bandOut);

    window.__lyricsflowLoudness = {
      raw,
      leak: this._bandLeak,
      out: this._bandOut,
      published,
    };
    return published;
  }

  static formatTime(ms, negative = false) {
    if (isNaN(ms)) return '0:00';
    const totalSeconds = Math.floor(Math.abs(ms) / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const formatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    return negative ? `-${formatted}` : formatted;
  }
}
