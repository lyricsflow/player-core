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
    const res = await fetch(`https://api.spicyamll.online/search?term=${encoded}&types=albums&limit=5`);
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
export async function getAnimatedArtwork(artist, album, title, directAlbumId = null) {
  if (!artist && !directAlbumId) return null;

  const isMobile = getIsMobile();
  const quality = isMobile ? 'low' : 'high';
  const aspect = getAspect();
  const cacheKey = `${directAlbumId || ''}|${artist || ''}|${album || ''}|${title || ''}|${aspect}`;

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
    const url = `https://api.spicyamll.online/animatedart?album=${directAlbumId}&quality=${quality}&aspect=${aspect}`;
    _artworkCache.set(cacheKey, url);
    try { sessionStorage.setItem(`lf_anim_art_${cacheKey}`, url); } catch (_) { }
    return url;
  }

  // Strategy 1: Search with "artist album"
  if (album) {
    console.log(`[AnimatedArt] Searching: "${artist} ${album}"`);
    const albumId = await searchiTunes(`${artist} ${album}`);
    if (albumId) {
      const url = `https://api.spicyamll.online/animatedart?album=${albumId}&quality=${quality}&aspect=${aspect}`;
      _artworkCache.set(cacheKey, url);
      try { sessionStorage.setItem(`lf_anim_art_${cacheKey}`, url); } catch (_) { }
      return url;
    }
  }

  // Strategy 2: Fallback to "artist title" if album search failed or no album
  if (title && title !== album) {
    console.log(`[AnimatedArt] Album search failed, trying: "${artist} ${title}"`);
    const albumId = await searchiTunes(`${artist} ${title}`);
    if (albumId) {
      const url = `https://api.spicyamll.online/animatedart?album=${albumId}&quality=${quality}&aspect=${aspect}`;
      _artworkCache.set(cacheKey, url);
      try { sessionStorage.setItem(`lf_anim_art_${cacheKey}`, url); } catch (_) { }
      return url;
    }
  }

  // Strategy 3: Try just artist name as last resort
  if (artist) {
    console.log(`[AnimatedArt] Trying artist-only search: "${artist}"`);
    const albumId = await searchiTunes(artist);
    if (albumId) {
      const url = `https://api.spicyamll.online/animatedart?album=${albumId}&quality=${quality}&aspect=${aspect}`;
      _artworkCache.set(cacheKey, url);
      try { sessionStorage.setItem(`lf_anim_art_${cacheKey}`, url); } catch (_) { }
      return url;
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

  // Remove any existing video
  const existingVideo = mediaBoxEl.querySelector('.animated-art-video');
  if (existingVideo) {
    if (existingVideo.src && existingVideo.src.startsWith('blob:')) {
      try { URL.revokeObjectURL(existingVideo.src); } catch (e) { }
    }
    existingVideo.remove();
  }

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

  // Stream video directly via <source> with range requests (starts in ~150-200ms)
  const source = document.createElement('source');
  source.src = videoUrl;
  source.type = 'video/mp4';

  source.addEventListener('error', async () => {
    console.warn('[AnimatedArt] Direct stream failed, falling back to blob buffer');
    if (!video.parentNode) return;
    try {
      video.removeChild(source);
    } catch (_) { }
    try {
      const resp = await fetch(videoUrl);
      if (!resp.ok) {
        video.remove();
        return;
      }
      const blob = new Blob([await resp.arrayBuffer()], { type: 'video/mp4' });
      const localVideoUrl = URL.createObjectURL(blob);
      video.src = localVideoUrl;
      video.load();
      video.play().catch(() => { });
    } catch (e) {
      console.warn('[AnimatedArt] Fallback blob failed:', e);
      video.remove();
    }
  });

  video.appendChild(source);
  mediaBoxEl.appendChild(video);
  video.load();
  video.play().catch(() => { });

  // Retain the static background image and fade in video when first frame is decoded
  video.addEventListener('loadeddata', () => {
    video.classList.add('loaded');
  });

  video.addEventListener('error', () => {
    console.warn('[AnimatedArt] Video failed to load. MediaError:', video.error ? {
      code: video.error.code,
      message: video.error.message
    } : 'Unknown Error');

    if (localVideoUrl) {
      try { URL.revokeObjectURL(localVideoUrl); } catch (e) { }
    }
    video.remove();
  });
}
