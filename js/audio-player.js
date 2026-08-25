import { EQ_BANDS } from './equalizer-presets.js';

/**
 * Lyricsflow — Audio Engine
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
    this.analyser.smoothingTimeConstant = 0.35;
    this._freqData = new Uint8Array(this.analyser.frequencyBinCount);

    // Beat detection (drives the background): Roblox-style — current
    // loudness vs the rolling average of the last N frames.
    this._pulse = 0;
    this._lastTime = 0;

    this._loudnessData = new Uint8Array(this.analyser.fftSize);
    this._loudHist = [];
    this._loudHistMax = 25;

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
  }

  setEQGain(index, value) {
    if (this.eqNodes[index]) {
      this.eqNodes[index].gain.setTargetAtTime(value, this.audioContext.currentTime, 0.1);
    }
  }

  /**
   * Sets new source URL on the active channel and fully tears down inactive
   * channel state to release decoder buffers and prevent split-second playbacks.
   */
  setSource(url) {
    this._silenceChannel(this._inactiveAudio, this._inactiveGain);
    this._crossfadeTriggered = false;
    this._pulse = 0;
    this._lastTime = 0;
    this._loudHist.length = 0;

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
    const nextGain  = this._inactiveGain;
    const prevGain  = this.activeGain;
    const prevAudio = this.audio;

    nextAudio.pause();
    nextAudio.removeAttribute('src');
    nextAudio.load();

    nextGain.gain.cancelScheduledValues(now);
    nextGain.gain.setValueAtTime(0, now);
    nextGain.gain.linearRampToValueAtTime(1, now + dur);

    nextAudio.src = url;
    nextAudio.load();

    this.currentChannel = this.currentChannel === 'A' ? 'B' : 'A';
    this._crossfadeTriggered = false;
    this._loudHist.length = 0;

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

  // Overall loudness (0..1), the equivalent of Roblox's PlaybackLoudness:
  // plain RMS over the waveform from the pre-volume tap.
  _loudness() {
    this.analyser.getByteTimeDomainData(this._loudnessData);
    let sum = 0;
    for (let i = 0; i < this._loudnessData.length; i++) {
      const v = (this._loudnessData[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / this._loudnessData.length);
  }

  /**
   * Beat level (0..1) driving the background.
   *
   * Same as the classic Roblox pattern: compare current loudness against the
   * rolling average of the last ~30 frames — above average = beat. The punch
   * scales with how far above the average we are, so hits pop harder than
   * sustained loud sections, and quiet passages stay calm.
   */
  getLowFreqLevel() {
    const t = this.audioContext.currentTime;
    const dt = this._lastTime ? Math.min(0.5, t - this._lastTime) : 0.016;
    this._lastTime = t;

    // Freeze the release when playback stops so the effect dies out gently.
    if (!this.isPlaying) {
      this._pulse = (this._pulse || 0) * Math.exp(-Math.max(dt, 0.016) / 0.09);
      return Math.max(0, this._pulse || 0);
    }

    const level = this._loudness();

    // Rolling average of recent loudness (the "is this frame louder than
    // usual?" baseline).
    const hist = this._loudHist;
    hist.push(level);
    if (hist.length > this._loudHistMax) hist.shift();
    let avg = 0;
    for (let i = 0; i < hist.length; i++) avg += hist[i];
    avg /= hist.length || 1;

    if (level > avg && level > 0.04) {
      const excess = (level - avg) / (avg + 0.02);
      this._pulse = Math.max(this._pulse, Math.min(1, 0.45 + excess * 0.9));
    }

    // Fast release so it visibly pops then breathes back between beats.
    this._pulse *= Math.exp(-dt / 0.09);
    return Math.max(0, Math.min(1, this._pulse));
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
