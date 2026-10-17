import dybg from 'https://nurislamaibekuly.github.io/dybg/dybg.js';

const PULSE_GAIN_DEFAULT = 0.35;
let pulseGain = PULSE_GAIN_DEFAULT;
try {
  const override = parseFloat(localStorage.getItem('lyricsflowPulseGain'));
  if (override >= 0 && Number.isFinite(override)) pulseGain = override;
} catch (e) {}

const VOLUME_TAU = 0.05;
const VOLUME_MAX_DT = 0.1;
let backdropVolume = 0;
let volumeClock = -1;

let _dybg = null;
let _standbyDybg = null;
let _standbyImg = null;
let _videoUpdateTimer = null;

// Hidden canvas for frame capture fallback
const _sourceCanvas = document.createElement('canvas');
const _sourceCtx = _sourceCanvas.getContext('2d', { alpha: false });
_sourceCanvas.width = 128;
_sourceCanvas.height = 128;

export async function extractColors(imageUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const size = 64;
      canvas.width = size;
      canvas.height = size;
      ctx.drawImage(img, 0, 0, size, size);

      const imageData = ctx.getImageData(0, 0, size, size).data;
      const colors = [];

      for (let i = 0; i < imageData.length; i += 16) {
        colors.push([imageData[i], imageData[i + 1], imageData[i + 2]]);
      }

      colors.sort((a, b) => {
        const satA = getColorSaturation(a);
        const satB = getColorSaturation(b);
        return satB - satA;
      });

      resolve({
        vibrant: colors[0] || [80, 80, 80],
        dark: darkenColor(colors[Math.floor(colors.length * 0.6)] || [30, 30, 30], 0.4),
        muted: colors[Math.floor(colors.length * 0.3)] || [60, 60, 60],
      });
    };
    img.onerror = () => {
      resolve({
        vibrant: [80, 80, 80],
        dark: [20, 20, 20],
        muted: [50, 50, 50],
      });
    };
    img.src = imageUrl;
  });
}

function getColorSaturation(rgb) {
  const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return 0;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

function darkenColor(rgb, amount) {
  return rgb.map(c => Math.floor(c * amount));
}

export async function applyLegacyBackground(bgContainer, img) {
  stopKawarp();

  bgContainer.innerHTML = "";
  bgContainer.className = "lyricsflow-dynamic-bg active";
  bgContainer.style.visibility = "visible";
  bgContainer.style.opacity = "1";

  // Create canvas matching index.html (#bgCanvas)
  const canvas = document.createElement('canvas');
  canvas.className = "lyricsflow-dybg-canvas";
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;';
  bgContainer.appendChild(canvas);

  try {
    _dybg = new dybg(canvas);
  } catch (e) {
    console.error("Failed to initialize dybg:", e);
    return;
  }

  // Configure parameters for active fluid animation (optimized for screen share & high refresh rates)
  if (typeof _dybg.setFlowSpeed === 'function') {
    _dybg.setFlowSpeed(0.2);
  }
  if (typeof _dybg.setRenderScale === 'function') {
    _dybg.setRenderScale(0.25);
  }
  if (typeof _dybg.resume === 'function') {
    _dybg.resume();
  } else if (typeof _dybg.play === 'function') {
    _dybg.play();
  }

  const loadSource = async () => {
    if (!_dybg) return;
    try {
      if (typeof _dybg.setAlbum === 'function') {
        await _dybg.setAlbum(img, img instanceof HTMLVideoElement);
      } else if (typeof _dybg.setAlbumImage === 'function') {
        await _dybg.setAlbumImage(img);
      } else if (typeof _dybg.load === 'function') {
        await _dybg.load(img);
      }
    } catch (err) {
      console.warn("dybg setAlbum failed:", img, err);
    }
  };

  await loadSource();

  requestAnimationFrame(() => {
    bgContainer.classList.add('loaded', 'active');
  });

  if (img instanceof HTMLVideoElement) {
    const updateFrame = () => {
      if (!_dybg) return;
      if (img.readyState >= 2 && img.videoWidth > 0 && img.videoHeight > 0) {
        if (typeof _dybg.setAlbum === 'function') {
          _dybg.setAlbum(img, true);
        } else if (typeof _dybg.setAlbumImage === 'function') {
          _dybg.setAlbumImage(img);
        }
      }
      _videoUpdateTimer = setTimeout(updateFrame, 200);
    };

    _videoUpdateTimer = setTimeout(updateFrame, 200);
  }
}

/**
 * Pre-warms a dormant duplicate dybg background with the next song's cover art.
 * Immediately pauses animation and keeps it hidden so it consumes ZERO CPU/GPU resources.
 */
export async function prepareStandbyBackground(standbyContainer, img) {
  if (!standbyContainer || !img) return;

  if (_standbyDybg && _standbyImg === img) {
    return;
  }

  if (_standbyDybg) {
    try {
      if (typeof _standbyDybg.dispose === 'function') _standbyDybg.dispose();
      else if (typeof _standbyDybg.destroy === 'function') _standbyDybg.destroy();
    } catch (_) {}
    _standbyDybg = null;
    _standbyImg = null;
  }

  standbyContainer.innerHTML = '';
  standbyContainer.className = 'lyricsflow-dynamic-bg standby';
  standbyContainer.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0;visibility:hidden;pointer-events:none;z-index:0;';

  const canvas = document.createElement('canvas');
  canvas.className = 'lyricsflow-dybg-canvas';
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;';
  standbyContainer.appendChild(canvas);

  try {
    const inst = new dybg(canvas);
    if (typeof inst.setFlowSpeed === 'function') inst.setFlowSpeed(0.2);
    if (typeof inst.setRenderScale === 'function') inst.setRenderScale(0.25);

    if (typeof inst.setAlbum === 'function') {
      await inst.setAlbum(img, img instanceof HTMLVideoElement);
    } else if (typeof inst.setAlbumImage === 'function') {
      await inst.setAlbumImage(img);
    } else if (typeof inst.load === 'function') {
      await inst.load(img);
    }

    // Halt render loop so zero CPU/GPU resources are consumed while dormant
    if (typeof inst.pause === 'function') {
      inst.pause();
    }

    _standbyDybg = inst;
    _standbyImg = img;
  } catch (err) {
    console.warn('[dybg] Failed to prepare standby background:', err);
  }
}

/**
 * Seamlessly swaps the dormant standby backdrop to active with a smooth crossfade,
 * and cleans up / deletes the old backdrop instance.
 */
export async function swapToStandbyBackground(activeContainer, standbyContainer, durationMs = 600) {
  if (!_standbyDybg || !standbyContainer) {
    return false;
  }

  const oldDybg = _dybg;
  const newDybg = _standbyDybg;
  _dybg = newDybg;
  _standbyDybg = null;
  _standbyImg = null;

  // Wake up new backdrop rendering loop
  if (typeof newDybg.resume === 'function') {
    newDybg.resume();
  } else if (typeof newDybg.play === 'function') {
    newDybg.play();
  }

  standbyContainer.style.visibility = 'visible';
  standbyContainer.style.pointerEvents = 'none';
  standbyContainer.style.transition = `opacity ${durationMs}ms cubic-bezier(0.25, 1, 0.5, 1)`;
  standbyContainer.style.opacity = '1';

  if (activeContainer) {
    activeContainer.style.transition = `opacity ${durationMs}ms cubic-bezier(0.25, 1, 0.5, 1)`;
    activeContainer.style.opacity = '0';
  }

  setTimeout(() => {
    if (oldDybg) {
      try {
        if (typeof oldDybg.dispose === 'function') oldDybg.dispose();
        else if (typeof oldDybg.destroy === 'function') oldDybg.destroy();
      } catch (_) {}
    }
    if (activeContainer) {
      activeContainer.innerHTML = '';
      activeContainer.style.visibility = 'hidden';
      activeContainer.style.opacity = '0';
      activeContainer.style.transition = '';
    }
  }, durationMs + 50);

  return true;
}

export function getStandbyImage() {
  return _standbyImg;
}

export function stopKawarp() {
  const bgContainers = document.querySelectorAll('.lyricsflow-dynamic-bg');
  bgContainers.forEach(c => c.classList.remove('loaded', 'active'));
  if (_videoUpdateTimer) {
    clearTimeout(_videoUpdateTimer);
    _videoUpdateTimer = null;
  }
  if (_dybg) {
    try {
      if (typeof _dybg.dispose === 'function') {
        _dybg.dispose();
      } else if (typeof _dybg.destroy === 'function') {
        _dybg.destroy();
      }
    } catch (e) {
      console.warn("[dybg] Error disposing active:", e);
    }
    _dybg = null;
  }
  if (_standbyDybg) {
    try {
      if (typeof _standbyDybg.dispose === 'function') {
        _standbyDybg.dispose();
      } else if (typeof _standbyDybg.destroy === 'function') {
        _standbyDybg.destroy();
      }
    } catch (e) {
      console.warn("[dybg] Error disposing standby:", e);
    }
    _standbyDybg = null;
    _standbyImg = null;
  }
  backdropVolume = 0;
  volumeClock = -1;
}

export function setKawarpPlaybackState(isPlaying) {
  if (_dybg) {
    if (isPlaying && !document.hidden) {
      if (typeof _dybg.resume === 'function') {
        _dybg.resume();
      } else if (typeof _dybg.play === 'function') {
        _dybg.play();
      }
    } else {
      if (typeof _dybg.pause === 'function') {
        _dybg.pause();
      }
    }
  }
}

// Automatically suspend dybg WebGL animation when the document is hidden to conserve GPU/CPU
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!_dybg) return;
    if (document.hidden) {
      if (typeof _dybg.pause === 'function') _dybg.pause();
    } else {
      if (typeof _dybg.resume === 'function') _dybg.resume();
      else if (typeof _dybg.play === 'function') _dybg.play();
    }
  });
}

export function setKawarpVolume(level01) {
  const dbg = (window.__lyricsflowLoudness = window.__lyricsflowLoudness || {});
  if (!_dybg || typeof _dybg.setLowFreqVolume !== 'function') {
    backdropVolume = 0;
    volumeClock = -1;
    dbg.volume = 0;
    return;
  }

  const now = performance.now() / 1000;
  const target = !(level01 > 0) ? 0 : Math.min(level01 * pulseGain, 0.5);

  if (volumeClock < 0) {
    volumeClock = now;
    backdropVolume = target;
  } else {
    const dt = Math.min(VOLUME_MAX_DT, Math.max(0, now - volumeClock));
    volumeClock = now;
    if (dt > 0) {
      const k = 1 - Math.exp(-dt / VOLUME_TAU);
      backdropVolume += (target - backdropVolume) * k;
    }
  }

  dbg.volume = backdropVolume;
  _dybg.setLowFreqVolume(backdropVolume * 10);
}

/**
 * Apply a simple color gradient background.
 * @param {HTMLElement} bgContainer
 * @param {{vibrant: number[], dark: number[]}} colors
 */
export function applyColorBackground(bgContainer, colors) {
  stopKawarp();
  bgContainer.className = "lyricsflow-dynamic-bg ColorBackground";
  bgContainer.style.setProperty('--MinContrastColor', colors.dark.join(', '));
  bgContainer.style.setProperty('--HighContrastColor', colors.vibrant.map(c => Math.floor(c * 0.3)).join(', '));
}

/**
 * Create a default dark background when no image is available.
 * @param {HTMLElement} bgContainer
 */
export function applyDefaultBackground(bgContainer) {
  stopKawarp();
  bgContainer.className = "lyricsflow-dynamic-bg ColorBackground";
  bgContainer.style.setProperty('--MinContrastColor', '18, 18, 18');
  bgContainer.style.setProperty('--HighContrastColor', '8, 8, 8');
}
