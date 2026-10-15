/**
 * LyricsFlow — Animated Artwork
 * Fetches animated (video) album art from Apple Music via iTunes search + Dodson proxy.
 * Based on the animated-art-test implementation.
 */
import { robustFetch } from './network-utils.js';

const _artworkCache = new Map();

function getIsMobile() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function getAspect() {
  return window.innerWidth <= 768 ? 'tall' : 'square';
}

async function searchiTunes(query) {
  try {
    const encoded = encodeURIComponent(query);
    // Use LyricsFlow Server as a proxy for iTunes search to avoid CORS issues on Netlify
    const res = await fetch(`https://api.trylyricsflow.com/search?term=${encoded}&types=albums&limit=5`);
    if (!res.ok) return null;

    const data = await res.json();
    const albums = data.results?.albums?.data;
    if (!albums || albums.length === 0) return null;

    // Return the album ID instead of catalog URL
    return albums[0].id || null;
  } catch (err) {
    console.warn('[AnimatedArt] iTunes search failed:', err);
    return null;
  }
}

/**
 * Try to fetch animated cover art for a song.
 * Searches with artist + album, falling back to artist + title if album search fails.
 * @param {string} artist - Artist name
 * @param {string} album - Album name
 * @param {string} [title] - Song title (used as fallback search)
 * @returns {Promise<string|null>} Video URL for animated artwork, or null
 */
async function resolveAnimatedVideo(candidateUrl) {
  try {
    const res = await fetch(candidateUrl);
    if (!res.ok) return null;
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('json')) {
      const data = await res.json();
      if (data && data.hasMotion === false) return null;
      if (data && data.video) return data.video;
      return null;
    }
    // Apple CDN master playlist (.m3u8) or redirected video stream
    return res.url || candidateUrl;
  } catch (err) {
    console.warn('[AnimatedArt] Error checking motion video:', err);
    return null;
  }
}

export async function getAnimatedArtwork(artist, album, title, directAlbumId = null, amTrackId = null) {
  if (!artist && !directAlbumId && !amTrackId) return null;

  const isMobile = getIsMobile();
  const quality = isMobile ? 'low' : 'high';
  const aspect = getAspect();
  const cacheKey = `${directAlbumId || ''}|${amTrackId || ''}|${artist || ''}|${album || ''}|${title || ''}|${aspect}`;

  const cached = _artworkCache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const sessionCached = sessionStorage.getItem(`lf_anim_art_${cacheKey}`);
    if (sessionCached) {
      _artworkCache.set(cacheKey, sessionCached);
      return sessionCached;
    }
  } catch (_) { }

  // Strategy 0: Direct album ID from Apple Music song metadata
  if (directAlbumId) {
    const candidate = `https://api.trylyricsflow.com/animatedart?album=${directAlbumId}&quality=${quality}&aspect=${aspect}`;
    const resolved = await resolveAnimatedVideo(candidate);
    if (resolved) {
      _artworkCache.set(cacheKey, resolved);
      try { sessionStorage.setItem(`lf_anim_art_${cacheKey}`, resolved); } catch (_) { }
      return resolved;
    }
  }

  // Strategy 0b: Direct Song ID fallback (server resolves song relationship to album)
  if (amTrackId) {
    const candidate = `https://api.trylyricsflow.com/animatedart?song=${amTrackId}&quality=${quality}&aspect=${aspect}`;
    const resolved = await resolveAnimatedVideo(candidate);
    if (resolved) {
      _artworkCache.set(cacheKey, resolved);
      try { sessionStorage.setItem(`lf_anim_art_${cacheKey}`, resolved); } catch (_) { }
      return resolved;
    }
  }

  // Strategy 1: Search with "artist album"
  if (album) {
    console.log(`[AnimatedArt] Searching: "${artist} ${album}"`);
    const albumId = await searchiTunes(`${artist} ${album}`);
    if (albumId) {
      const candidate = `https://api.trylyricsflow.com/animatedart?album=${albumId}&quality=${quality}&aspect=${aspect}`;
      const resolved = await resolveAnimatedVideo(candidate);
      if (resolved) {
        _artworkCache.set(cacheKey, resolved);
        try { sessionStorage.setItem(`lf_anim_art_${cacheKey}`, resolved); } catch (_) { }
        return resolved;
      }
    }
  }

  // Strategy 2: Fallback to "artist title" if album search failed or no album
  if (title && title !== album) {
    console.log(`[AnimatedArt] Album search failed, trying: "${artist} ${title}"`);
    const albumId = await searchiTunes(`${artist} ${title}`);
    if (albumId) {
      const candidate = `https://api.trylyricsflow.com/animatedart?album=${albumId}&quality=${quality}&aspect=${aspect}`;
      const resolved = await resolveAnimatedVideo(candidate);
      if (resolved) {
        _artworkCache.set(cacheKey, resolved);
        try { sessionStorage.setItem(`lf_anim_art_${cacheKey}`, resolved); } catch (_) { }
        return resolved;
      }
    }
  }

  // Strategy 3: Try just artist name as last resort
  if (artist) {
    console.log(`[AnimatedArt] Trying artist-only search: "${artist}"`);
    const albumId = await searchiTunes(artist);
    if (albumId) {
      const candidate = `https://api.trylyricsflow.com/animatedart?album=${albumId}&quality=${quality}&aspect=${aspect}`;
      const resolved = await resolveAnimatedVideo(candidate);
      if (resolved) {
        _artworkCache.set(cacheKey, resolved);
        try { sessionStorage.setItem(`lf_anim_art_${cacheKey}`, resolved); } catch (_) { }
        return resolved;
      }
    }
  }

  console.log('[AnimatedArt] No animated artwork found after all strategies');
  _artworkCache.set(cacheKey, null);
  return null;
}

/**
 * Apply animated artwork to the album art container.
 * @param {HTMLElement} mediaBoxEl - The .MediaImageContainer element
 * @param {string} videoUrl - The animated artwork video URL
 */
// Track the active fetch controller so we can abort stale requests on track change
let _activeAnimatedArtController = null;

export function applyAnimatedArt(mediaBoxEl, videoUrl) {
  if (!mediaBoxEl || !videoUrl) return;

  // Abort any in-flight fetch from a previous track to prevent memory pile-up
  if (_activeAnimatedArtController) {
    _activeAnimatedArtController.abort();
    _activeAnimatedArtController = null;
  }

  // Remove any existing video or reflection mirror
  const existingVideo = mediaBoxEl.querySelector('.animated-art-video');
  if (existingVideo) {
    if (existingVideo.src && existingVideo.src.startsWith('blob:')) {
      try { URL.revokeObjectURL(existingVideo.src); } catch (e) { }
    }
    existingVideo.remove();
  }
  const existingMirror = mediaBoxEl.querySelector('.mobile-animated-mirror-wrap');
  if (existingMirror) existingMirror.remove();

  const video = document.createElement('video');
  video.classList.add('animated-art-video');

  // Set safety attributes to bypass mobile/desktop autoplay blocks
  video.autoplay = true;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('disablepictureinpicture', '');
  video.setAttribute('preload', 'auto');

  const isM3U8 = videoUrl.includes('.m3u8') || videoUrl.includes('/animatedart');
  let hlsInstance = null;

  if (typeof Hls !== 'undefined' && Hls.isSupported() && (isM3U8 || !video.canPlayType('application/vnd.apple.mpegurl'))) {
    hlsInstance = new Hls({ enableWorker: true, lowLatencyMode: true });
    hlsInstance.loadSource(videoUrl);
    hlsInstance.attachMedia(video);
    hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => { });
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    // Native Safari HLS
    video.src = videoUrl;
    video.load();
    video.play().catch(() => { });
  } else {
    // Stream MP4 video directly via <source>
    const source = document.createElement('source');
    source.src = videoUrl;
    source.type = 'video/mp4';
    video.appendChild(source);
    video.load();
    video.play().catch(() => { });
  }

  // LyricsBlossom Style Mobile Mirrored Reflection
  // The lower portion starts an inverted reflection right where the cover height ends,
  // transitioning with a blur-fade into the dark backdrop
  const mirrorWrap = document.createElement('div');
  mirrorWrap.classList.add('mobile-animated-mirror-wrap');
  mirrorWrap.innerHTML = `
    <div class="mobile-animated-mirror-content"></div>
    <div class="mobile-animated-mirror-gradient"></div>
  `;
  mediaBoxEl.appendChild(mirrorWrap);

  mediaBoxEl.appendChild(video);

  // Toggle dybg: only disable dybg when animated cover art is actively playing in cover view
  function updateDybgState() {
    const isCoverMode = !document.body.classList.contains('lyrics-mode-active') && !document.body.classList.contains('queue-mode-active');
    const isPlaying = !video.paused && video.readyState >= 2;
    if (isCoverMode && isPlaying) {
      document.body.classList.add('mobile-animated-cover-active');
    } else {
      document.body.classList.remove('mobile-animated-cover-active');
    }
  }

  video.addEventListener('playing', () => {
    video.classList.add('loaded');
    updateDybgState();
  });

  video.addEventListener('pause', updateDybgState);
  window.addEventListener('resize', updateDybgState);

  // Retain the static background image and fade in video when first frame is decoded
  video.addEventListener('loadeddata', () => {
    video.classList.add('loaded');
    updateDybgState();
  });

  video.addEventListener('error', () => {
    console.warn('[AnimatedArt] Video failed to load.');
    if (hlsInstance) {
      try { hlsInstance.destroy(); } catch (_) { }
    }
    video.remove();
    mirrorWrap.remove();
    document.body.classList.remove('mobile-animated-cover-active');
  });
}
