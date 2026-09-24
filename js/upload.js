import { showToast } from './toast.js';
import { addTrackToQueue, clearQueue, setCurrentIndex, getPlaylists, createPlaylist, addTrackToPlaylist, getPlaylistTracks, deletePlaylist, updatePlaylistTrack, findTrackInPlaylist } from './router.js';
import { parseAudioMetadata } from './metadata-parser.js';
import { robustFetch } from './network-utils.js';
import { parseAmpResponse, resolveArtworkUrl } from './amp-parser.js';
import { TTMLDownloader } from './ttml-downloader.js';
import isRtl from './is-rtl.js';
import { escapeHTML } from './security-utils.js';
import { t, getCurrentLang, setLanguage, applyDOMTranslations, formatLocalizedDate, formatLocalizedYear } from './i18n.js';
import { checkFirstTimeSetup, getUserProfile, openProfileSettingsModal, updateProfileUI } from './user-profile.js';
import { hasListenedSongs, generateTopPicks, getRecentlyPlayed10, generate90Recommendations } from './algorithm.js';
import {
  addSongToLibrary,
  removeSongFromLibrary,
  isSongInLibrary,
  addAlbumToLibrary,
  removeAlbumFromLibrary,
  isAlbumInLibrary,
  addArtistToLibrary,
  removeArtistFromLibrary,
  isArtistInLibrary,
  getLibrarySongs,
  getLibraryAlbums,
  getLibraryArtists,
  getRecentlyAdded
} from './library-manager.js';

function generateArtistInitial(name) {
  const letter = (name || '?').trim().charAt(0).toUpperCase();
  const canvas = document.createElement('canvas');
  canvas.width = 300;
  canvas.height = 300;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 300, 300);
  grad.addColorStop(0, '#3a3a3c');
  grad.addColorStop(1, '#1c1c1e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 300, 300);
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 140px "SF Pro Rounded", "SF Pro Display", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 150, 158);
  return canvas.toDataURL();
}

function getCardName(img) {
  if (img.dataset.artistName) return img.dataset.artistName;
  const card = img.closest('.am-media-card, .am-standard-media-card, .am-artist-card, .am-artist-song-card, .am-top-card, .am-song-row, .am-chip, .playlist-card, .am-album-art-container, .am-artist-view');
  if (!card) return '';
  const titleEl = card.querySelector('.am-media-card-title, .am-media-card-sub, .am-artist-name, .am-song-row-artist, .am-category-title, h2, h3, h4, p');
  return titleEl ? titleEl.textContent.trim() : '';
}

document.addEventListener('error', function (e) {
  const img = e.target;
  if (img.tagName !== 'IMG') return;
  if (img.dataset.initialFallback) return;
  img.dataset.initialFallback = '1';
  const name = getCardName(img);
  if (name) img.src = generateArtistInitial(name);
}, true);
import { previewPlayer } from './preview-player.js';

const API_BASE = "https://api.spicyamll.online";

function cleanArtworkUrl(url, w = 300, h = 300, format = null) {
  if (!url || typeof url !== 'string') return '';
  const isPng = format === 'png' || /\.png(?:\/|$)/i.test(url) || /Logo/i.test(url);
  const targetExt = format || (isPng ? 'png' : 'jpg');
  let cleaned = url
    .replace('{w}', String(w))
    .replace('{h}', String(h))
    .replace('{c}', '')
    .replace('{f}', targetExt);
  if (w > 100 && /\/\d+x\d+bb\./.test(cleaned)) {
    cleaned = cleaned.replace(/\/\d+x\d+bb\./, `/${w}x${h}bb.`);
  }
  if (!/^https?:\/\//i.test(cleaned)) return '';
  return cleaned.replace(/["'<>\s]/g, c => encodeURIComponent(c));
}

function cleanLogoUrl(url, w = 400, h = 133) {
  if (!url || typeof url !== 'string') return '';
  let cleaned = url
    .replace('{w}', String(w))
    .replace('{h}', String(h))
    .replace('{c}', 'bb')
    .replace('{f}', 'webp');
  if (/\/\d+x\d+(?:bb)?\./.test(cleaned)) {
    cleaned = cleaned.replace(/\/\d+x\d+(?:bb)?\./, `/${w}x${h}bb.`);
  }
  if (!/^https?:\/\//i.test(cleaned)) return '';
  return cleaned.replace(/["'<>\s]/g, c => encodeURIComponent(c));
}

function cleanMediaUrl(url) {
  if (!url || typeof url !== 'string') return '';
  if (!/^(https?:|blob:)/i.test(url)) return '';
  return url.replace(/["'<>\s]/g, c => encodeURIComponent(c));
}

let _hlsScriptLoadingPromise = null;
function loadHlsLibrary() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (_hlsScriptLoadingPromise) return _hlsScriptLoadingPromise;
  _hlsScriptLoadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/hls.js@latest';
    script.async = true;
    script.onload = () => resolve(window.Hls);
    script.onerror = (e) => {
      console.warn('[HLS] Failed to load hls.js from CDN:', e);
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return _hlsScriptLoadingPromise;
}

/**
 * Loads and plays an HLS or MP4 stream on a video element.
 * Tries hls.js first for any m3u8 stream, then falls back to native playback.
 */
async function playHlsStream(videoEl, streamUrl, { autoplay = true, isMuted = false, loop = false } = {}) {
  if (!videoEl || !streamUrl) return;

  // Clean up any existing Hls instance attached to this element
  if (videoEl._hlsInstance) {
    try {
      videoEl._hlsInstance.destroy();
    } catch (_) {}
    videoEl._hlsInstance = null;
  }

  videoEl.muted = isMuted;
  if (isMuted) videoEl.setAttribute('muted', '');
  videoEl.playsInline = true;
  videoEl.setAttribute('playsinline', '');
  if (loop) videoEl.loop = true;

  const isHlsStream = streamUrl.includes('.m3u8') || streamUrl.includes('/hls/') || streamUrl.includes('mvod.itunes.apple.com');

  if (isHlsStream) {
    try {
      const HlsLib = await loadHlsLibrary();
      if (HlsLib && HlsLib.isSupported()) {
        const hls = new HlsLib({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 60
        });
        videoEl._hlsInstance = hls;
        hls.loadSource(streamUrl);
        hls.attachMedia(videoEl);
        hls.on(HlsLib.Events.MANIFEST_PARSED, () => {
          if (autoplay) {
            videoEl.play().catch(e => console.warn('[HLS] Autoplay prevented:', e));
          }
        });
        hls.on(HlsLib.Events.ERROR, (event, data) => {
          if (data.fatal) {
            console.warn('[HLS] Fatal error, falling back to native player:', data.type);
            hls.destroy();
            videoEl._hlsInstance = null;
            videoEl.src = streamUrl;
            if (autoplay) videoEl.play().catch(() => {});
          }
        });
        return;
      }
    } catch (err) {
      console.warn('[HLS] hls.js setup error, falling back to native:', err);
    }
  }

  // Fallback to browser built-in player
  videoEl.src = streamUrl;
  if (autoplay) {
    videoEl.play().catch(e => console.warn('[Video] Playback failed:', e));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // First-time setup assistant check & Profile init
  checkFirstTimeSetup();
  updateProfileUI();

  // Profile button click events (desktop and mobile)
  const userProfileBtn = document.getElementById('user-profile-btn');
  const mobileUserProfileBtn = document.getElementById('mobile-user-profile-btn');
  if (userProfileBtn) userProfileBtn.addEventListener('click', openProfileSettingsModal);
  if (mobileUserProfileBtn) mobileUserProfileBtn.addEventListener('click', openProfileSettingsModal);

  window.addEventListener('lyricsflow-profile-updated', () => {
    updateProfileUI();
    const profile = getUserProfile();
    const homeGreetingHeading = document.getElementById('home-greeting-heading');
    if (homeGreetingHeading) {
      homeGreetingHeading.textContent = `${t('home_welcome', { name: profile.name })} 👋`;
    }
    const homeGreetingTitle = document.getElementById('home-recommended-title');
    if (homeGreetingTitle) {
      homeGreetingTitle.textContent = t('home_recommended_for', { name: profile.name });
    }
  });

  window.addEventListener('lyricsflow-lang-changed', () => {
    applyDOMTranslations();
    updateSidebarPlaylists();
    updateProfileUI();
  });

  const ttmlZone = document.getElementById('ttml-zone');
  const audioZone = document.getElementById('audio-zone');
  const ttmlInput = document.getElementById('ttml-input');
  const audioInput = document.getElementById('audio-input');
  const startBtn = document.getElementById('start-button');
  const errorEl = document.getElementById('upload-error');

  const queuePreview = document.getElementById('queue-preview');
  const queueList = document.getElementById('queue-list');
  const queueCount = document.getElementById('queue-count');
  const clearQueueBtn = document.getElementById('clear-queue-btn');

  const prepOverlay = document.getElementById('prep-overlay');
  const prepStatus = document.getElementById('prep-status');

  // Search Elements
  const catalogSearch = document.getElementById('catalog-search');
  const searchBarWrapper = document.querySelector('.am-apple-search-bar');
  const searchClearBtn = document.getElementById('search-clear-btn');
  const listenInitialContent = document.getElementById('listen-initial-content');
  const searchResultsContainer = document.getElementById('search-results-container');
  const recentlySearchedSection = document.getElementById('recently-searched-section');
  const recentlySearchedGrid = document.getElementById('recently-searched-grid');
  const clearRecentSearchesBtn = document.getElementById('clear-recent-searches-btn');
  const categoriesGrid = document.getElementById('categories-grid');

  // Categorized Search Grid Elements
  const sectionTopResults = document.getElementById('section-top-results');
  const topResultsGrid = document.getElementById('top-results-grid');

  const sectionArtists = document.getElementById('section-artists');
  const artistsGrid = document.getElementById('artists-grid');

  const sectionSongs = document.getElementById('section-songs');
  const songsGrid = document.getElementById('songs-grid');

  const sectionAlbums = document.getElementById('section-albums');
  const albumsGrid = document.getElementById('albums-grid');

  const sectionPlaylists = document.getElementById('section-playlists');
  const playlistsSearchGrid = document.getElementById('playlists-search-grid');

  const sectionVideos = document.getElementById('section-videos');
  const videosGrid = document.getElementById('videos-grid');

  const sectionStations = document.getElementById('section-stations');
  const stationsGrid = document.getElementById('stations-grid');

  const sectionLabels = document.getElementById('section-labels');
  const labelsGrid = document.getElementById('labels-grid');

  const sectionCurators = document.getElementById('section-curators');
  const curatorsGrid = document.getElementById('curators-grid');

  // Album View
  const albumViewContainer = document.getElementById('album-view-container');
  const albumHeader = document.getElementById('album-header');
  const albumTracksGrid = document.getElementById('album-tracks-grid');

  // Artist View
  const artistViewContainer = document.getElementById('artist-view-container');
  const artistViewContent = document.getElementById('artist-view-content');

  // Song View
  const songViewContainer = document.getElementById('song-view-container');
  const songViewContent = document.getElementById('song-view-content');

  // Context Menu & Playlists
  const songContextMenu = document.getElementById('song-context-menu');
  const ctxPlay = document.getElementById('ctx-play');
  const ctxAddLib = document.getElementById('ctx-add-library');
  const ctxAddPlaylist = document.getElementById('ctx-add-playlist');
  const ctxViewAlbum = document.getElementById('ctx-view-album');
  const ctxViewArtist = document.getElementById('ctx-view-artist');
  const ctxFavorite = document.getElementById('ctx-favorite');
  const ctxCopyId = document.getElementById('ctx-copy-id');

  // Mobile Context Modal
  const mobileContextModal = document.getElementById('mobile-context-modal');
  const mobModalArt = document.getElementById('mob-modal-art');
  const mobModalTitle = document.getElementById('mob-modal-title');
  const mobModalSub = document.getElementById('mob-modal-sub');
  const mobModalCloseBtn = document.getElementById('mob-modal-close-btn');
  const mobCtxPlay = document.getElementById('mob-ctx-play');
  const mobCtxAddLib = document.getElementById('mob-ctx-add-lib');
  const mobCtxLibLabel = document.getElementById('mob-ctx-lib-label');
  const mobCtxAddPlaylist = document.getElementById('mob-ctx-add-playlist');
  const mobCtxViewAlbum = document.getElementById('mob-ctx-view-album');
  const mobCtxViewArtist = document.getElementById('mob-ctx-view-artist');
  const mobCtxFavorite = document.getElementById('mob-ctx-favorite');
  const mobCtxFavLabel = document.getElementById('mob-ctx-fav-label');
  const mobCtxCopyId = document.getElementById('mob-ctx-copy-id');

  const playlistModal = document.getElementById('playlist-select-modal');
  const playlistOptionsList = document.getElementById('playlist-options-list');
  const modalCreatePlaylistBtn = document.getElementById('modal-create-playlist-btn');
  const closePlaylistModal = document.getElementById('close-playlist-modal');

  const playlistsGrid = document.getElementById('playlists-grid');
  const playlistDetail = document.getElementById('playlist-detail');
  const playlistDetailTitle = document.getElementById('playlist-detail-title');
  const playlistTracksGrid = document.getElementById('playlist-tracks-grid');
  const playlistBackBtn = document.getElementById('playlist-back-btn');
  const createPlaylistBtn = document.getElementById('create-playlist-btn');

  // Remote playlist detail view (Apple Music playlists from search results)
  const playlistViewContainer = document.getElementById('playlist-view-container');
  const playlistViewContent = document.getElementById('playlist-view-content');

  // TTML Downloader Elements
  const fetchTtmlBtn = document.getElementById('fetch-ttml-btn');
  const ttmlSongIdInput = document.getElementById('ttml-song-id');
  const ttmlResultContainer = document.getElementById('ttml-result-preview');
  const ttmlPreviewName = document.getElementById('ttml-preview-name');
  const ttmlPreviewArtist = document.getElementById('ttml-preview-artist');
  const ttmlPreviewArt = document.getElementById('ttml-preview-art');
  const ttmlCodeBlock = document.getElementById('ttml-code-block');
  const ttmlStatus = document.getElementById('ttml-status');
  const downloadTtmlBtn = document.getElementById('download-ttml-file-btn');

  let currentFetchedTTML = null;
  let currentFetchedSong = null;
  let contextMenuTrack = null;

  let stagedAudio = [];
  let stagedTTML = [];

  // ── Zone Click ──
  if (ttmlZone) {
    ttmlZone.addEventListener('click', (e) => {
      if (e.target === ttmlInput) return;
      ttmlInput.click();
    });
  }

  if (audioZone) {
    audioZone.addEventListener('click', (e) => {
      if (e.target === audioInput) return;
      audioInput.click();
    });
  }

  // ── File Input Change ──
  if (ttmlInput) ttmlInput.addEventListener('change', (e) => handleTTMLFiles(Array.from(e.target.files)));
  if (audioInput) audioInput.addEventListener('change', (e) => handleAudioFiles(Array.from(e.target.files)));

  // ── Drag & Drop ──
  [ttmlZone, audioZone].forEach(zone => {
    if (!zone) return;
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      if (zone === ttmlZone) handleTTMLFiles(files);
      else handleAudioFiles(files);
    });
  });

  function handleTTMLFiles(files) {
    const validFiles = files.filter(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      return ext === 'ttml' || ext === 'xml';
    });
    if (validFiles.length < files.length) showError('Skipped non-TTML files.');
    stagedTTML = [...stagedTTML, ...validFiles];
    matchAndRender();
  }

  function handleAudioFiles(files) {
    const audioExts = ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac', 'mp4', 'm4b', 'opus', 'webm'];
    const validAudio = [];
    files.forEach(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      if (audioExts.includes(ext)) {
        validAudio.push({ file: f, ttmlFile: null });
      }
    });
    if (validAudio.length === 0 && files.length > 0) showError('No valid audio files found.');
    stagedAudio = [...stagedAudio, ...validAudio];
    matchAndRender();
  }

  function matchAndRender() {
    clearError();
    stagedAudio.forEach(item => {
      const baseName = item.file.name.replace(/\.[^/.]+$/, "");
      if (!item.ttmlFile) {
        const match = stagedTTML.find(tf => tf.name.replace(/\.[^/.]+$/, "") === baseName);
        if (match) item.ttmlFile = match;
      }
    });
    renderQueue();
    checkReady();
  }

  function renderQueue() {
    if (!queueList) return;
    queueList.innerHTML = '';

    stagedAudio.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'queue-item';

      const info = document.createElement('div');
      info.className = 'queue-info';
      info.innerHTML = `
        <span class="queue-title">${escapeHTML(item.file.name)}</span>
        <span class="queue-status ${item.ttmlFile ? 'has-ttml' : 'no-ttml'}">
          ${item.ttmlFile ? '✓ TTML Attached' : '⚡ Auto-fetch lyrics on play'}
        </span>
      `;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'queue-remove-btn';
      removeBtn.innerHTML = '✕';
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        stagedAudio.splice(index, 1);
        matchAndRender();
      };

      row.appendChild(info);
      row.appendChild(removeBtn);
      queueList.appendChild(row);
    });

    if (queueCount) queueCount.textContent = `${stagedAudio.length} tracks`;
    if (queuePreview) {
      if (stagedAudio.length > 0) queuePreview.classList.add('visible');
      else queuePreview.classList.remove('visible');
    }
  }

  function checkReady() {
    if (startBtn) startBtn.disabled = (stagedAudio.length === 0);
  }

  if (clearQueueBtn) {
    clearQueueBtn.onclick = () => {
      stagedAudio = [];
      stagedTTML = [];
      matchAndRender();
    };
  }

  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      if (stagedAudio.length === 0) return;

      startBtn.disabled = true;
      if (prepOverlay) {
        prepOverlay.classList.add('active');
        prepStatus.textContent = "Processing Queue...";
      }

      try {
        await clearQueue();

        for (let i = 0; i < stagedAudio.length; i++) {
          const item = stagedAudio[i];
          if (prepStatus) prepStatus.textContent = `Reading ${i + 1}/${stagedAudio.length}: ${item.file.name}...`;

          const audioBuffer = await readFileAsArrayBuffer(item.file);
          let ttmlContent = null;
          if (item.ttmlFile) {
            ttmlContent = await readFileAsText(item.ttmlFile);
          } else {
            ttmlContent = '__AUTO_FETCH__';
          }

          let metadata = { name: item.file.name, artist: 'Unknown Artist', album: null, type: item.file.type || 'audio/mpeg' };
          try {
            const parsed = await parseAudioMetadata(audioBuffer, item.file.type);
            metadata = { ...metadata, ...parsed };
          } catch (e) {
            console.warn("Local parse failed, fallback:", e);
          }

          metadata.ttml = ttmlContent;
          await addTrackToQueue(audioBuffer, metadata);
        }

        setCurrentIndex(0);
        const drawer = document.getElementById('player-drawer');
        const drawerIframe = document.getElementById('player-drawer-iframe');
        if (drawer && drawerIframe) {
          drawerIframe.src = 'player.html';
          drawer.classList.add('open');
          startBtn.disabled = false;
          if (prepOverlay) prepOverlay.classList.remove('active');
        } else {
          window.location.href = 'player.html';
        }

      } catch (err) {
        showError('Failed to prepare queue: ' + err.message);
        startBtn.disabled = false;
        if (prepOverlay) prepOverlay.classList.remove('active');
      }
    });
  }

  // ── Slug & URL Routing Helper ──
  function toSlug(text) {
    if (!text) return '';
    return String(text)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/[^\w-]+/g, '')
      .replace(/--+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item';
  }

  // Universal Share Helper using slug URLs & Web Share API
  async function shareEntity({ title, text, url }) {
    let clean = url || '';
    if (clean.startsWith('http://') || clean.startsWith('https://')) {
      try {
        const u = new URL(clean);
        clean = u.pathname + u.search;
      } catch (_) { }
    }
    clean = clean.replace(/^#\/?/, '');
    if (!clean.startsWith('/')) clean = '/' + clean;
    const fullUrl = `${window.location.origin}${clean}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: title || 'Lyricsflow',
          text: text || title || 'Check this out on Lyricsflow',
          url: fullUrl
        });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    // Fallback: Copy to clipboard
    try {
      await navigator.clipboard.writeText(fullUrl);
      showToast({ message: 'Link copied to clipboard!' });
    } catch (_) {
      showToast({ message: fullUrl });
    }
  }
  window.lyricsflowShare = shareEntity;

  let isHandlingPopState = false;

  function syncUrl(pathname, search = '', replace = false) {
    if (isHandlingPopState) return;
    try {
      let cleanPath = pathname.replace(/^#\/?/, '');
      if (!cleanPath.startsWith('/')) cleanPath = '/' + cleanPath;
      const targetSearch = search ? (search.startsWith('?') ? search : `?${search}`) : '';
      const targetFull = cleanPath + targetSearch;
      const currentFull = window.location.pathname + window.location.search;
      if (currentFull !== targetFull) {
        if (replace) {
          window.history.replaceState({ path: cleanPath, search: targetSearch }, '', targetFull);
        } else {
          window.history.pushState({ path: cleanPath, search: targetSearch }, '', targetFull);
        }
      }
    } catch (_) { }
  }

  // ── Navigation & Page Management ──
  const navItems = document.querySelectorAll('.am-sidebar-nav .am-nav-item');
  const mobNavBtns = document.querySelectorAll('.am-mob-nav-btn');
  const pages = document.querySelectorAll('.am-page');

  // ── Dynamic Detail Page Theme Color Scheme ──
  let _currentThemeImg = null;
  function clearPageThemeColor() {
    if (_currentThemeImg) {
      _currentThemeImg.onload = null;
      _currentThemeImg.onerror = null;
      _currentThemeImg = null;
    }
    const mainEl = document.querySelector('.am-main') || document.body;
    mainEl.style.removeProperty('--am-page-theme-bg');
    mainEl.style.removeProperty('--am-page-theme-accent');
  }

  function applyPageThemeColor(artUrl, rawBgColorHex = null) {
    const mainEl = document.querySelector('.am-main') || document.body;
    if (rawBgColorHex) {
      const cleanHex = rawBgColorHex.replace(/^#/, '');
      const r = parseInt(cleanHex.substring(0, 2), 16);
      const g = parseInt(cleanHex.substring(2, 4), 16);
      const b = parseInt(cleanHex.substring(4, 6), 16);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        mainEl.style.setProperty('--am-page-theme-bg', `radial-gradient(ellipse 110% 70% at 50% -10%, rgba(${r}, ${g}, ${b}, 0.5) 0%, rgba(${Math.round(r * 0.4)}, ${Math.round(g * 0.4)}, ${Math.round(b * 0.4)}, 0.25) 55%, #0a0a0a 100%)`);
        mainEl.style.setProperty('--am-page-theme-accent', `rgb(${r}, ${g}, ${b})`);
        return;
      }
    }

    if (!artUrl) return;

    if (_currentThemeImg) {
      _currentThemeImg.onload = null;
      _currentThemeImg.onerror = null;
    }

    const img = new Image();
    _currentThemeImg = img;
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 40;
        canvas.height = 40;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 40, 40);
        const data = ctx.getImageData(0, 0, 40, 40).data;
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 16) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }
        if (count > 0) {
          r = Math.round(r / count);
          g = Math.round(g / count);
          b = Math.round(b / count);
          // Darken if overly bright for ideal background aesthetics
          const brightness = (r * 299 + g * 587 + b * 114) / 1000;
          const factor = brightness > 180 ? 0.7 : 1;
          const dr = Math.round(r * factor);
          const dg = Math.round(g * factor);
          const db = Math.round(b * factor);
          mainEl.style.setProperty('--am-page-theme-bg', `radial-gradient(ellipse 110% 70% at 50% -10%, rgba(${dr}, ${dg}, db, 0.45) 0%, rgba(${Math.round(dr * 0.4)}, ${Math.round(dg * 0.4)}, ${Math.round(db * 0.4)}, 0.2) 60%, #0a0a0a 100%)`);
          mainEl.style.setProperty('--am-page-theme-accent', `rgb(${dr}, ${dg}, ${db})`);
        }
      } catch (_) {}
    };
    img.src = artUrl;
  }

  function switchPage(pageId, options = {}) {
    if (!pageId) return;

    // Reset page theme color when navigating between top-level pages
    clearPageThemeColor();

    // If navigating to home without any listening history, redirect to /new
    if (pageId === 'home' && !hasListenedSongs()) {
      pageId = 'new';
    }

    // Update sidebar nav items
    navItems.forEach(i => {
      if (i.dataset.page === pageId) i.classList.add('am-nav-active');
      else i.classList.remove('am-nav-active');
    });

    // Update mobile bottom nav
    mobNavBtns.forEach(btn => {
      if (btn.dataset.page === pageId) btn.classList.add('am-mob-active');
      else btn.classList.remove('am-mob-active');
    });

    // Hide all pages, show target page
    pages.forEach(p => p.classList.remove('active'));
    const targetPage = document.getElementById(`page-${pageId}`);
    if (targetPage) targetPage.classList.add('active');

    // Sync URL slug for top-level pages
    if (!options.skipUrlSync) {
      if (pageId === 'home') {
        syncUrl('/home', '', options.replaceUrl);
      } else if (pageId === 'listen') {
        const q = catalogSearch?.value?.trim() || '';
        syncUrl('/search', q ? `q=${encodeURIComponent(q)}` : '', options.replaceUrl);
      } else if (pageId === 'new') {
        syncUrl('/new', '', options.replaceUrl);
      } else if (pageId === 'upload') {
        syncUrl('/upload', '', options.replaceUrl);
      } else if (pageId === 'download-song') {
        syncUrl('/download', '', options.replaceUrl);
      } else if (pageId === 'download-ttml') {
        syncUrl('/download/ttml', '', options.replaceUrl);
      } else if (pageId === 'playlists') {
        syncUrl('/playlists', '', options.replaceUrl);
      } else if (pageId === 'recently-added') {
        syncUrl('/recently-added', '', options.replaceUrl);
      } else if (pageId === 'library-hub') {
        syncUrl('/library', '', options.replaceUrl);
      } else if (pageId === 'library-artists') {
        syncUrl('/library/artists', '', options.replaceUrl);
      } else if (pageId === 'library-albums') {
        syncUrl('/library/albums', '', options.replaceUrl);
      } else if (pageId === 'songs') {
        syncUrl('/library/songs', '', options.replaceUrl);
      } else if (pageId === 'recent') {
        syncUrl('/recently-listened', '', options.replaceUrl);
      }
    }

    // Page-specific loaders
    if (pageId === 'home') renderHomePage();
    if (pageId === 'new') renderNewPage();
    if (pageId === 'listen') {
      clearSearchUI();
      loadLandingView();
    }
    if (pageId === 'recently-added') renderRecentlyAddedPage();
    if (pageId === 'library-hub') renderLibraryHubPage();
    if (pageId === 'library-artists') renderLibraryArtistsPage();
    if (pageId === 'library-albums') renderLibraryAlbumsPage();
    if (pageId === 'playlists') renderPlaylistsPage();
    if (pageId === 'songs') renderFavoritesPage();
    if (pageId === 'recent') renderRecentPage();
  }

  // Attach nav item clicks
  navItems.forEach(item => {
    item.addEventListener('click', () => switchPage(item.dataset.page));
  });

  mobNavBtns.forEach(btn => {
    btn.addEventListener('click', () => switchPage(btn.dataset.page));
  });

  // Library Hub Pill clicks
  document.querySelectorAll('.am-hub-pill-btn').forEach(pill => {
    pill.addEventListener('click', () => {
      const target = pill.dataset.target;
      if (target) switchPage(target);
    });
  });

  // ── Show Detail Views Helpers (Clean View Transitions) ──
  function showAlbumView(albumId, albumName = '', trackId = null, options = {}) {
    if (!albumId) return;
    pages.forEach(p => p.classList.remove('active'));
    const listenPage = document.getElementById('page-listen');
    if (listenPage) listenPage.classList.add('active');

    navItems.forEach(i => {
      if (i.dataset.page === 'listen') i.classList.add('am-nav-active');
      else i.classList.remove('am-nav-active');
    });
    mobNavBtns.forEach(btn => {
      if (btn.dataset.page === 'listen') btn.classList.add('am-mob-active');
      else btn.classList.remove('am-mob-active');
    });

    if (!options.skipUrlSync) {
      const slug = toSlug(albumName || 'album');
      const search = trackId ? `i=${trackId}` : '';
      syncUrl(`/album/${slug}/${albumId}`, search, options.replaceUrl);
    }

    fetchAlbumDetails(albumId, albumName, trackId);
  }

  function showArtistView(artistId, artistName, options = {}) {
    if (!artistId) return;
    pages.forEach(p => p.classList.remove('active'));
    const listenPage = document.getElementById('page-listen');
    if (listenPage) listenPage.classList.add('active');

    navItems.forEach(i => {
      if (i.dataset.page === 'listen') i.classList.add('am-nav-active');
      else i.classList.remove('am-nav-active');
    });
    mobNavBtns.forEach(btn => {
      if (btn.dataset.page === 'listen') btn.classList.add('am-mob-active');
      else btn.classList.remove('am-mob-active');
    });

    if (!options.skipUrlSync) {
      const slug = toSlug(artistName || 'artist');
      syncUrl(`/artist/${slug}/${artistId}`, '', options.replaceUrl);
    }

    openArtistView(artistId, artistName);
  }

  function showRemotePlaylistView(playlistId, playlistName, options = {}) {
    if (!playlistId) return;
    pages.forEach(p => p.classList.remove('active'));
    const listenPage = document.getElementById('page-listen');
    if (listenPage) listenPage.classList.add('active');

    navItems.forEach(i => {
      if (i.dataset.page === 'listen') i.classList.add('am-nav-active');
      else i.classList.remove('am-nav-active');
    });
    mobNavBtns.forEach(btn => {
      if (btn.dataset.page === 'listen') btn.classList.add('am-mob-active');
      else btn.classList.remove('am-mob-active');
    });

    if (!options.skipUrlSync) {
      const slug = toSlug(playlistName || 'playlist');
      syncUrl(`/playlist/${slug}/${playlistId}`, '', options.replaceUrl);
    }

    openRemotePlaylistView(playlistId, playlistName);
  }

  function showSongView(songId, songName = '', options = {}) {
    if (!songId) return;
    pages.forEach(p => p.classList.remove('active'));
    const listenPage = document.getElementById('page-listen');
    if (listenPage) listenPage.classList.add('active');

    navItems.forEach(i => {
      if (i.dataset.page === 'listen') i.classList.add('am-nav-active');
      else i.classList.remove('am-nav-active');
    });
    mobNavBtns.forEach(btn => {
      if (btn.dataset.page === 'listen') btn.classList.add('am-mob-active');
      else btn.classList.remove('am-mob-active');
    });

    if (!options.skipUrlSync) {
      const slug = toSlug(songName || 'song');
      syncUrl(`/song/${slug}/${songId}`, '', options.replaceUrl);
    }

    openSongView(songId, songName);
  }
  window.showSongView = showSongView;

  async function openSongView(songId, preferredSongName = '') {
    if (searchBarWrapper) searchBarWrapper.classList.add('hidden');
    if (listenInitialContent) listenInitialContent.classList.add('hidden');
    if (searchResultsContainer) searchResultsContainer.classList.add('hidden');
    if (albumViewContainer) albumViewContainer.classList.add('hidden');
    if (artistViewContainer) artistViewContainer.classList.add('hidden');
    if (playlistViewContainer) playlistViewContainer.classList.add('hidden');
    if (songViewContainer) songViewContainer.classList.remove('hidden');

    songViewContent.innerHTML = `<div class="am-loading-msg">${t('loading')}</div>`;

    try {
      const lang = getCurrentLang() || 'en-GB';
      const catalogUrl = `${API_BASE}/v1/catalog/kz/songs/${songId}?art[url]=f&extend=lyricsExcerpt,offers&fields[albums]=artistName,artistUrl,artwork,name,url&fields[artists]=name,url&format[resources]=map&include=albums,artists,credits,lyrics,music-videos&l=${lang}&platform=web`;
      const res = await fetch(catalogUrl);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      const resources = data.resources || {};
      const songData = resources.songs?.[String(songId)] || data.data?.[0];
      if (!songData) throw new Error('Song not found');

      const attr = songData.attributes || {};
      const rels = songData.relationships || {};

      const songTitle = attr.name || preferredSongName || 'Song';
      const songSlug = toSlug(songTitle);
      syncUrl(`/song/${songSlug}/${songId}`, '', true);

      const coverArt = cleanArtworkUrl(attr.artwork?.url, 600, 600);

      // Apply page-wide color scheming for Song view
      applyPageThemeColor(coverArt, attr.artwork?.bgColor);

      const artistName = attr.artistName || '';
      const artistId = rels.artists?.data?.[0]?.id || null;

      const albumRel = rels.albums?.data?.[0];
      const authenticAlbumId = albumRel?.id || attr.url?.match(/\/album\/[^/]+\/(\d+)/)?.[1] || null;
      const authenticAlbumObj = authenticAlbumId ? resources.albums?.[authenticAlbumId] : null;
      const albumName = authenticAlbumObj?.attributes?.name || attr.albumName || 'Album';

      const releaseDate = attr.releaseDate || authenticAlbumObj?.attributes?.releaseDate || '';
      const releaseYear = releaseDate ? new Date(releaseDate).getFullYear() : '';

      const lyricsExcerpt = attr.lyricsExcerpt || '';
      const lyricsObj = resources.lyrics?.[String(songId)] || rels.lyrics?.data?.[0];
      const ttml = lyricsObj?.attributes?.ttml || lyricsObj?.ttml || null;

      let lyricsPreviewText = lyricsExcerpt;
      if (!lyricsPreviewText && ttml) {
        try {
          const doc = new DOMParser().parseFromString(ttml, 'application/xml');
          const pEls = Array.from(doc.querySelectorAll('p')).slice(0, 4);
          lyricsPreviewText = pEls.map(p => p.textContent.trim()).filter(Boolean).join('\n');
        } catch (_) {}
      }

      const creditArtists = resources['credit-artists'] || {};
      const roleCategories = resources['role-categories'] || {};

      const groupedCredits = {
        performing: [],
        composition: [],
        production: []
      };

      for (const catId of Object.keys(roleCategories)) {
        const cat = roleCategories[catId];
        const kind = cat.attributes?.kind || '';
        const credArtistList = cat.relationships?.['credit-artists']?.data || [];
        const artistItems = credArtistList.map(ca => creditArtists[ca.id]).filter(Boolean);

        if (kind.includes('performer')) {
          groupedCredits.performing.push(...artistItems);
        } else if (kind.includes('composer') || kind.includes('lyrics')) {
          groupedCredits.composition.push(...artistItems);
        } else if (kind.includes('production') || kind.includes('engineering')) {
          groupedCredits.production.push(...artistItems);
        }
      }

      const getInitials = (name) => {
        if (!name) return 'AM';
        const parts = name.trim().split(/\s+/);
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      };

      const renderCreditItems = (items) => {
        if (!items || items.length === 0) return '';
        return items.map(it => {
          const cAttr = it.attributes || {};
          const cName = cAttr.name || 'Artist';
          const cRoles = (cAttr.roleNames || []).join(', ') || 'Contributor';
          const cArt = cAttr.artwork?.url ? cleanArtworkUrl(cAttr.artwork.url, 120, 120) : null;
          const avatarMarkup = cArt
            ? `<img src="${cArt}" class="am-credit-avatar" alt="${escapeHTML(cName)}" onerror="this.outerHTML='<div class=\\'am-credit-avatar\\'>${getInitials(cName)}</div>'">`
            : `<div class="am-credit-avatar">${getInitials(cName)}</div>`;

          return `
            <div class="am-credit-item">
              ${avatarMarkup}
              <div class="am-credit-info">
                <span class="am-credit-name">${escapeHTML(cName)}</span>
                <span class="am-credit-role">${escapeHTML(cRoles)}</span>
              </div>
            </div>
          `;
        }).join('');
      };

      songViewContent.innerHTML = `
        <div class="am-song-header">
          <img src="${coverArt}" class="am-song-cover" onerror="this.src='favicon.svg'" alt="${escapeHTML(songTitle)}">
          <div class="am-song-details">
            <h1 class="am-song-title">${escapeHTML(songTitle)}</h1>
            <div class="am-song-meta-line">
              <a class="am-song-meta-link" id="song-view-artist-btn">${escapeHTML(artistName)}</a>
              <span class="am-song-meta-dot">•</span>
              <a class="am-song-meta-link" id="song-view-album-btn">${escapeHTML(albumName)}</a>
              ${releaseYear ? `<span class="am-song-meta-dot">•</span><span>${releaseYear}</span>` : ''}
            </div>
            <div style="display: flex; gap: 12px; align-items: center;">
              <button class="premium-btn primary" id="song-view-play-btn" style="border-radius:100px; padding:0 32px; height:44px; display:inline-flex; align-items:center; gap:8px;">
                <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z"/></svg>
                <span>Play</span>
              </button>
            </div>
          </div>
        </div>

        ${lyricsPreviewText ? `
          <div class="am-song-section">
            <h3 class="am-song-section-heading">Lyrics</h3>
            <div class="am-song-lyrics-preview">${escapeHTML(lyricsPreviewText)}</div>
            <button class="am-song-view-full-lyrics-btn" id="song-view-full-lyrics-btn">
              <span>View Full Lyrics</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>
        ` : ''}

        ${groupedCredits.performing.length > 0 ? `
          <div class="am-song-section">
            <h3 class="am-song-section-heading">Performing Artists</h3>
            <div class="am-credits-grid">
              ${renderCreditItems(groupedCredits.performing)}
            </div>
          </div>
        ` : ''}

        ${groupedCredits.composition.length > 0 ? `
          <div class="am-song-section">
            <h3 class="am-song-section-heading">Composition & Lyrics</h3>
            <div class="am-credits-grid">
              ${renderCreditItems(groupedCredits.composition)}
            </div>
          </div>
        ` : ''}

        ${groupedCredits.production.length > 0 ? `
          <div class="am-song-section">
            <h3 class="am-song-section-heading">Production & Engineering</h3>
            <div class="am-credits-grid">
              ${renderCreditItems(groupedCredits.production)}
            </div>
          </div>
        ` : ''}

        <div class="am-song-section" id="song-more-by-section" style="border-bottom: none;">
          <h3 class="am-song-section-heading" id="song-more-by-heading" style="cursor: pointer;">
            More By ${escapeHTML(artistName)} <span style="font-size: 1rem; opacity: 0.6;">›</span>
          </h3>
          <div class="am-cards-horizontal-scroll" id="song-more-by-grid">
            <div class="am-loading-msg">${t('loading')}</div>
          </div>
        </div>
      `;

      const artistBtn = songViewContent.querySelector('#song-view-artist-btn');
      if (artistBtn) {
        artistBtn.onclick = () => showArtistView(artistId || artistName, artistName);
      }

      const albumBtn = songViewContent.querySelector('#song-view-album-btn');
      if (albumBtn) {
        albumBtn.onclick = () => {
          if (authenticAlbumId) {
            showAlbumView(authenticAlbumId, albumName, songId);
          } else {
            lyricsflowShowAlbumByName(albumName, songId);
          }
        };
      }

      const moreByHeading = songViewContent.querySelector('#song-more-by-heading');
      if (moreByHeading) {
        moreByHeading.onclick = () => showArtistView(artistId || artistName, artistName);
      }

      const fullLyricsBtn = songViewContent.querySelector('#song-view-full-lyrics-btn');
      if (fullLyricsBtn) {
        fullLyricsBtn.onclick = () => {
          openAppleMusicLyricsModal({
            title: songTitle,
            artist: artistName,
            album: albumName,
            releaseDate: releaseDate,
            ttml: ttml,
            lyricsExcerpt: lyricsExcerpt
          });
        };
      }

      const playBtn = songViewContent.querySelector('#song-view-play-btn');
      if (playBtn) {
        playBtn.onclick = () => {
          queueContextualWithSimilar({
            trackId: songId,
            trackName: songTitle,
            artistName: artistName,
            collectionName: albumName,
            albumId: authenticAlbumId,
            artistId: artistId,
            artworkUrl100: coverArt,
            ttml: ttml,
            lyricsExcerpt: lyricsExcerpt,
            durationMs: attr.durationInMillis
          }, [{
            id: songId,
            title: songTitle,
            artist: artistName,
            album: albumName,
            artUrl: coverArt,
            durationMs: attr.durationInMillis || 180000
          }], 0);
        };
      }

      fetchArtistOtherAlbumsForSong(artistId, artistName, authenticAlbumId);

    } catch (err) {
      console.error('[SongView] Failed to load song view:', err);
      songViewContent.innerHTML = `<div class="am-error-msg">${t('error')}: ${err.message}</div>`;
    }
  }

  function openAppleMusicLyricsModal({ title, artist, album, releaseDate, ttml, lyricsExcerpt }) {
    const existing = document.querySelector('.am-full-lyrics-modal-backdrop');
    if (existing) existing.remove();

    // Format release date (e.g. 1 January 2000)
    let formattedDate = '';
    if (releaseDate) {
      try {
        const d = new Date(releaseDate);
        if (!isNaN(d.getTime())) {
          formattedDate = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        }
      } catch (_) {}
    }

    // Build metadata subtitle: Album • Artist • Date
    const metaParts = [];
    if (album) metaParts.push(album);
    if (artist) metaParts.push(artist);
    if (formattedDate) metaParts.push(formattedDate);
    const subtitle = metaParts.join(' • ');

    // Parse stanzas and lines
    let stanzas = [];
    let isRTL = false;

    if (ttml) {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(ttml, 'application/xml');
        const rootLang = doc.documentElement?.getAttribute('xml:lang') || '';
        if (rootLang.toLowerCase().startsWith('ar') || rootLang.toLowerCase().startsWith('he') || rootLang.toLowerCase().startsWith('fa')) {
          isRTL = true;
        }

        const divEls = Array.from(doc.querySelectorAll('body div'));
        if (divEls.length > 0) {
          divEls.forEach(div => {
            const pEls = Array.from(div.querySelectorAll('p'));
            const lines = pEls.map(p => p.textContent.trim()).filter(Boolean);
            if (lines.length > 0) {
              stanzas.push(lines);
            }
          });
        } else {
          const pEls = Array.from(doc.querySelectorAll('p'));
          const lines = pEls.map(p => p.textContent.trim()).filter(Boolean);
          if (lines.length > 0) {
            stanzas.push(lines);
          }
        }
      } catch (e) {
        console.warn('[LyricsModal] Failed to parse TTML:', e);
      }
    }

    if (stanzas.length === 0 && lyricsExcerpt) {
      const lines = lyricsExcerpt.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length > 0) {
        stanzas.push(lines);
      }
    }

    // RTL detection heuristic across lyrics text if not already determined
    if (!isRTL && stanzas.length > 0) {
      const sampleText = stanzas.slice(0, 3).flat().join(' ');
      if (/[\u0600-\u06FF\u0750-\u077F\u0590-\u05FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(sampleText)) {
        isRTL = true;
      }
    }

    const backdrop = document.createElement('div');
    backdrop.className = 'am-full-lyrics-modal-backdrop';

    const card = document.createElement('div');
    card.className = 'am-full-lyrics-modal-card';

    const header = document.createElement('div');
    header.className = 'am-full-lyrics-modal-header';
    header.innerHTML = `
      <button class="am-full-lyrics-modal-close-btn" aria-label="Close">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      <h2 class="am-full-lyrics-modal-title">${escapeHTML(title || 'Lyrics')}</h2>
      ${subtitle ? `<div class="am-full-lyrics-modal-meta">${escapeHTML(subtitle)}</div>` : ''}
    `;

    const body = document.createElement('div');
    body.className = 'am-full-lyrics-modal-body';
    body.setAttribute('dir', isRTL ? 'rtl' : 'ltr');

    if (stanzas.length > 0) {
      stanzas.forEach(stanzaLines => {
        const stanzaEl = document.createElement('div');
        stanzaEl.className = 'am-full-lyrics-stanza';
        stanzaLines.forEach(line => {
          const lineEl = document.createElement('p');
          lineEl.className = 'am-full-lyrics-line';
          lineEl.textContent = line;
          stanzaEl.appendChild(lineEl);
        });
        body.appendChild(stanzaEl);
      });
    } else {
      const emptyEl = document.createElement('p');
      emptyEl.className = 'am-full-lyrics-line';
      emptyEl.style.opacity = '0.5';
      emptyEl.textContent = 'No full lyrics available for this song.';
      body.appendChild(emptyEl);
    }

    card.appendChild(header);
    card.appendChild(body);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    const closeModal = () => {
      document.removeEventListener('keydown', handleKeyDown);
      backdrop.remove();
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') closeModal();
    };

    const closeBtn = header.querySelector('.am-full-lyrics-modal-close-btn');
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      closeModal();
    };

    backdrop.onclick = (e) => {
      if (e.target === backdrop) closeModal();
    };

    document.addEventListener('keydown', handleKeyDown);
  }

  async function fetchArtistOtherAlbumsForSong(artistId, artistName, currentAlbumId) {
    const moreGrid = document.getElementById('song-more-by-grid');
    if (!moreGrid) return;

    try {
      let otherAlbums = [];
      if (artistId && /^\d+$/.test(String(artistId))) {
        try {
          const res = await fetch(`${API_BASE}/artist/albums?artist=${artistId}&limit=25&l=${getCurrentLang()}`);
          if (res.ok) {
            const data = await res.json();
            otherAlbums = data.data || [];
          }
        } catch (_) {}
      }

      if (otherAlbums.length === 0 && artistName) {
        try {
          const sRes = await fetch(`${API_BASE}/search?term=${encodeURIComponent(artistName)}&types=albums&limit=25&l=${getCurrentLang()}`);
          if (sRes.ok) {
            const sData = await sRes.json();
            otherAlbums = sData.results?.albums?.data || [];
          }
        } catch (_) {}
      }

      const filtered = otherAlbums.filter(a => String(a.id) !== String(currentAlbumId));
      const randomized = filtered.sort(() => 0.5 - Math.random()).slice(0, 15);

      if (randomized.length === 0) {
        moreGrid.innerHTML = `<p class="am-empty-msg">${t('empty_other_albums')}</p>`;
        return;
      }

      moreGrid.innerHTML = randomized.map(alb => {
        const attr = alb.attributes || alb || {};
        const art = cleanArtworkUrl(attr.artwork?.url || attr.artworkUrl100, 300, 300);
        const y = attr.releaseDate ? new Date(attr.releaseDate).getFullYear() : '';
        return `
          <div class="am-standard-media-card animate-fade" data-id="${alb.id}">
            <img src="${art}" loading="lazy" referrerpolicy="no-referrer" class="am-media-card-art" onerror="this.src='favicon.svg'">
            <div class="am-media-card-title">${escapeHTML(attr.name || attr.collectionName || '')}</div>
            <div class="am-media-card-sub">${escapeHTML(y || t('badge_album'))}</div>
          </div>
        `;
      }).join('');

      moreGrid.querySelectorAll('.am-standard-media-card').forEach(card => {
        card.onclick = () => {
          const title = card.querySelector('.am-media-card-title')?.textContent || '';
          showAlbumView(card.dataset.id, title);
        };
      });
    } catch (_) {
      moreGrid.innerHTML = `<p class="am-empty-msg">${t('empty_other_albums')}</p>`;
    }
  }

  // Global navigation helpers for player dialog
  window.lyricsflowShowArtistByName = async (artistName) => {
    if (!artistName) return;
    showArtistView(artistName, artistName);
  };

  window.lyricsflowShowAlbumByName = async (albumName, amTrackId = null) => {
    const trackLookupId = amTrackId || (window.__waveCurrentTrack?.amTrackId || window.__waveCurrentTrack?.trackId || window.__waveCurrentTrack?.id);
    if (trackLookupId && !isNaN(Number(trackLookupId))) {
      try {
        const sRes = await fetch(`${API_BASE}/v1/catalog/kz/songs/${trackLookupId}?art[url]=f&fields[albums]=name,url&format[resources]=map&include=albums&l=en-GB&platform=web`);
        if (sRes.ok) {
          const sData = await sRes.json();
          const songObj = sData.resources?.songs?.[String(trackLookupId)] || sData.data?.[0];
          const albRel = songObj?.relationships?.albums?.data?.[0];
          const albId = albRel?.id || songObj?.attributes?.url?.match(/\/album\/[^/]+\/(\d+)/)?.[1];
          const authenticAlb = albId ? sData.resources?.albums?.[albId] : null;
          const targetAlbumName = authenticAlb?.attributes?.name || songObj?.attributes?.albumName || albumName;
          if (albId) {
            showAlbumView(albId, targetAlbumName, trackLookupId);
            return;
          }
        }
      } catch (_) { }
    }

    if (!albumName) return;
    try {
      const res = await fetch(`${API_BASE}/search?term=${encodeURIComponent(albumName)}&types=albums&limit=5&l=en-US`);
      if (res.ok) {
        const d = await res.json();
        const alb = d.results?.albums?.data?.[0];
        if (alb) {
          showAlbumView(alb.id, alb.attributes?.name || albumName, amTrackId);
          return;
        }
      }
    } catch (_) { }
    switchPage('listen');
    if (catalogSearch) {
      catalogSearch.value = albumName;
      performCatalogSearch(albumName);
    }
  };

  // ── Smart Algorithm & Home Page ──
  function syncHomeNavVisibility() {
    const hasHistory = hasListenedSongs();
    const homeNavItem = document.getElementById('nav-item-home');
    const mobHomeBtn = document.getElementById('mob-nav-home');

    if (hasHistory) {
      if (homeNavItem) homeNavItem.classList.remove('hidden');
      if (mobHomeBtn) mobHomeBtn.classList.remove('hidden');
    } else {
      if (homeNavItem) homeNavItem.classList.add('hidden');
      if (mobHomeBtn) mobHomeBtn.classList.add('hidden');
    }
  }

  async function renderHomePage() {
    const topPicksContainer = document.getElementById('home-top-picks-scroll');
    const recentContainer = document.getElementById('home-recent-scroll');
    const recommendedGrid = document.getElementById('home-recommended-grid');
    const profile = getUserProfile();

    const homeGreetingHeading = document.getElementById('home-greeting-heading');
    if (homeGreetingHeading) {
      homeGreetingHeading.textContent = `${t('home_welcome', { name: profile.name })}`;
    }

    const homeGreetingTitle = document.getElementById('home-recommended-title');
    if (homeGreetingTitle) {
      homeGreetingTitle.textContent = t('home_recommended_for', { name: profile.name });
    }

    // 1. Top Picks for You (1 latest song + 10 mix)
    if (topPicksContainer) {
      topPicksContainer.innerHTML = `<div class="am-loading-msg">${t('loading')}</div>`;
      try {
        const picks = await generateTopPicks();
        if (picks.length === 0) {
          topPicksContainer.innerHTML = `<p class="am-empty-msg">${t('empty_picks')}</p>`;
        } else {
          topPicksContainer.innerHTML = picks.map((item, i) => `
            <div class="am-standard-media-card animate-fade" data-type="${item.type}" data-id="${item.id}" data-idx="${i}">
              <div style="position: relative;">
                <img src="${cleanArtworkUrl(item.artUrl, 300, 300)}" loading="lazy" referrerpolicy="no-referrer" class="am-media-card-art ${item.type === 'artist' ? 'artist-circle' : ''}">
                ${item.isLatest ? `<span class="am-media-badge-tag">${t('home_latest_played')}</span>` : ''}
              </div>
              <div class="am-media-card-title">${escapeHTML(item.title)}</div>
              <div class="am-media-card-sub">${escapeHTML(item.subtitle)}</div>
            </div>
          `).join('');

          topPicksContainer.querySelectorAll('.am-standard-media-card').forEach(card => {
            card.onclick = () => {
              const type = card.dataset.type;
              const id = card.dataset.id;
              const idx = parseInt(card.dataset.idx, 10);
              const pick = picks[idx];
              if (type === 'song') {
                showSongView(id, pick.title);
              } else if (type === 'album') {
                showAlbumView(id, pick.title);
              } else if (type === 'artist') {
                showArtistView(id, pick.title);
              }
            };
          });
        }
      } catch (e) {
        topPicksContainer.innerHTML = `<p class="am-error-msg">${t('error')}</p>`;
      }
    }

    // 2. Recently Played (up to 10 with back icon to full recent page)
    if (recentContainer) {
      const recent10 = getRecentlyPlayed10();
      if (recent10.length === 0) {
        recentContainer.innerHTML = `<p class="am-empty-msg">${t('recent_empty')}</p>`;
      } else {
        recentContainer.innerHTML = recent10.map((song, i) => `
          <div class="am-standard-media-card animate-fade" data-id="${song.id}" data-idx="${i}">
            <img src="${cleanArtworkUrl(song.artUrl, 300, 300)}" loading="lazy" referrerpolicy="no-referrer" class="am-media-card-art">
            <div class="am-media-card-title">${escapeHTML(song.title)}</div>
            <div class="am-media-card-sub">${escapeHTML(song.artist)}</div>
          </div>
        `).join('');

        recentContainer.querySelectorAll('.am-standard-media-card').forEach(card => {
          card.onclick = () => {
            const idx = parseInt(card.dataset.idx, 10);
            const song = recent10[idx];
            if (song) {
              loadRemoteTrack({
                trackId: song.id,
                trackName: song.title,
                artistName: song.artist,
                collectionName: song.album,
                albumId: song.albumId || null,
                artistId: song.artistId || null,
                artworkUrl100: song.artUrl
              });
            }
          };
        });
      }
    }

    // Link heading click to full recent list
    const homeRecentHeader = document.getElementById('home-recent-header');
    if (homeRecentHeader) {
      homeRecentHeader.onclick = () => switchPage('recent');
    }

    // 3. Recommended for {Name} (90 recommendations)
    if (recommendedGrid) {
      try {
        const rec90 = await generate90Recommendations();
        if (rec90.length === 0) {
          recommendedGrid.innerHTML = `<p class="am-empty-msg">${t('empty_recommendations')}</p>`;
        } else {
          recommendedGrid.innerHTML = rec90.map((item, i) => `
            <div class="am-standard-media-card animate-fade" data-type="${item.type}" data-id="${item.id}" data-idx="${i}">
              <div style="position: relative;">
                <img src="${cleanArtworkUrl(item.artUrl, 300, 300)}" loading="lazy" referrerpolicy="no-referrer" class="am-media-card-art ${item.type === 'artist' ? 'artist-circle' : ''}">
                <button class="am-card-3dots-btn" data-id="${item.id}" data-idx="${i}">•••</button>
              </div>
              <div class="am-media-card-title">${escapeHTML(item.title)}</div>
              <div class="am-media-card-sub">${escapeHTML(item.subtitle)}</div>
            </div>
          `).join('');

          recommendedGrid.querySelectorAll('.am-standard-media-card').forEach(card => {
            card.onclick = (e) => {
              const idx = parseInt(card.dataset.idx, 10);
              const item = rec90[idx];
              if (!item) return;

              if (e.target.classList.contains('am-card-3dots-btn')) {
                e.stopPropagation();
                showContextMenu(e, {
                  trackId: item.id,
                  trackName: item.title,
                  artistName: item.subtitle,
                  collectionName: item.album || '',
                  albumId: item.albumId || null,
                  artistId: item.artistId || null,
                  artworkUrl100: item.artUrl
                });
                return;
              }

              if (item.type === 'song') {
                showSongView(item.id, item.title);
              } else if (item.type === 'album') {
                showAlbumView(item.id, item.title);
              } else if (item.type === 'artist') {
                showArtistView(item.id, item.title);
              }
            };
          });
        }
      } catch (e) {
        recommendedGrid.innerHTML = `<p class="am-error-msg">${t('error')}</p>`;
      }
    }
  }

  // ── "New" Page (Apple Music Editorial Groupings / Releases) ──
  async function renderNewPage() {
    const pageNew = document.getElementById('page-new');
    if (!pageNew) return;

    pageNew.innerHTML = `
      <div class="am-hero">
        <div class="am-hero-icon" style="background: linear-gradient(135deg, #fa586a 0%, #d9384a 100%);">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zm-9 9h7v7H4v-7zm9 0h7v7h-7v-7z"/>
          </svg>
        </div>
        <div class="am-hero-text">
          <h1 class="am-hero-title">New</h1>
          <p class="am-hero-subtitle">Discover the latest releases and editorial selections.</p>
        </div>
      </div>
      <div id="new-page-content" style="padding-bottom: 60px;">
        <div class="am-loading-msg">${t('loading')}</div>
      </div>
    `;

    const contentEl = pageNew.querySelector('#new-page-content');

    try {
      const url = `${API_BASE}/v1/editorial/kz/groupings?art%5Burl%5D=c%2Cf&extend=artistUrl%2CeditorialArtwork%2CplainEditorialNotes&extend%5Bstation-events%5D=editorialVideo&fields%5Balbums%5D=artistName%2CartistUrl%2Cartwork%2CcontentRating%2CeditorialArtwork%2CplainEditorialNotes%2Cname%2CplayParams%2CreleaseDate%2Curl%2CtrackCount&fields%5Bartists%5D=name%2Curl%2Cartwork%2CeditorialArtwork%2CgenreNames%2CplainEditorialNotes&format%5Bresources%5D=map&include%5Balbums%5D=artists&include%5Bmusic-videos%5D=artists&include%5Bsongs%5D=artists&include%5Bstations%5D=events%2Cradio-show&l=en-GB&name=music&omit%5Bresource%3Aartists%5D=autos&platform=web&relate%5Bsongs%5D=albums&tabs=subscriber`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const resources = data.resources || {};
      const tab = resources['editorial-elements']?.['default'] || {};
      const sectionRefs = tab.relationships?.children?.data || [];

      // Extract valid section elements that have contents
      const sections = sectionRefs.map(ref => {
        const sec = resources['editorial-elements']?.[ref.id];
        if (!sec) return null;
        const attrs = sec.attributes || {};
        const title = attrs.name || attrs.title || '';
        const items = sec.relationships?.contents?.data || [];
        if (!title || items.length === 0) return null;
        return { id: ref.id, title, items };
      }).filter(Boolean);

      if (sections.length === 0) {
        contentEl.innerHTML = `<p class="am-empty-msg">No editorial highlights available right now.</p>`;
        return;
      }

      contentEl.innerHTML = sections.map((sec, sIdx) => {
        const resolved = sec.items.map(it => {
          const pool = resources[it.type] || {};
          return pool[it.id] || it;
        });

        return `
          <div class="am-search-section" style="margin-top: 32px;">
            <div class="am-section-header-row">
              <h2 class="am-search-section-title">${escapeHTML(sec.title)}</h2>
            </div>
            <div class="am-cards-horizontal-scroll" id="new-shelf-${sIdx}">
              ${resolved.map((item, i) => {
                const attr = item.attributes || item || {};
                const rawArt = attr.artwork?.url || attr.editorialArtwork?.bannerUber?.url || attr.editorialArtwork?.storeArtworkUber?.url;
                const art = cleanArtworkUrl(rawArt, 400, 400);
                const name = attr.name || attr.title || 'Release';
                const sub = attr.artistName || attr.curatorName || (attr.genreNames && attr.genreNames[0]) || '';
                return `
                  <div class="am-standard-media-card animate-fade" data-type="${item.type}" data-id="${item.id}" data-idx="${i}">
                    <img src="${art}" loading="lazy" referrerpolicy="no-referrer" class="am-media-card-art" onerror="this.src='favicon.svg'">
                    <div class="am-media-card-title">${escapeHTML(name)}</div>
                    <div class="am-media-card-sub">${escapeHTML(sub)}</div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }).join('');

      contentEl.querySelectorAll('.am-standard-media-card').forEach(card => {
        card.onclick = () => {
          const type = card.dataset.type;
          const id = card.dataset.id;
          const title = card.querySelector('.am-media-card-title')?.textContent || '';
          if (type === 'albums') {
            showAlbumView(id, title);
          } else if (type === 'playlists') {
            showRemotePlaylistView(id, title);
          } else if (type === 'songs') {
            // Queue song with similar recommendations
            if (typeof queueContextualWithSimilar === 'function') {
              queueContextualWithSimilar(id, [{ id, name: title }]);
            } else {
              showSongView(id, title);
            }
          } else if (type === 'artists') {
            showArtistView(id, title);
          } else if (type === 'music-videos') {
            if (typeof playMusicVideo === 'function') {
              playMusicVideo(id, title);
            }
          }
        };
      });

    } catch (err) {
      console.error('[New Page] Error fetching editorial groupings:', err);
      contentEl.innerHTML = `<p class="am-error-msg">Could not load New releases: ${err.message}</p>`;
    }
  }

  // ── Recently Added Page ──
  async function renderRecentlyAddedPage() {
    const mixGrid = document.getElementById('recently-added-mix-grid');
    const songsGrid = document.getElementById('recently-added-songs-grid');
    const albumsGrid = document.getElementById('recently-added-albums-grid');
    const artistsGrid = document.getElementById('recently-added-artists-grid');

    // 1. Top Section: Big Grid of all items
    if (mixGrid) {
      const items = await getRecentlyAdded(60);
      if (items.length === 0) {
        mixGrid.innerHTML = `<p class="am-empty-msg" data-i18n="rec_added_empty">${t('rec_added_empty')}</p>`;
      } else {
        mixGrid.innerHTML = items.map((item, i) => {
          const itemTypeLabel = item.itemType === 'artist' ? t('badge_artist') :
            item.itemType === 'album' ? t('badge_album') :
              item.itemType === 'playlist' ? t('badge_playlist') :
                t('badge_song');
          return `
            <div class="am-standard-media-card animate-fade" data-type="${item.itemType}" data-id="${item.id}" data-idx="${i}">
              <div style="position: relative;">
                <img src="${cleanArtworkUrl(item.artUrl, 300, 300)}" loading="lazy" referrerpolicy="no-referrer" class="am-media-card-art ${item.itemType === 'artist' ? 'artist-circle' : ''}">
                <span class="am-media-badge-tag">${itemTypeLabel}</span>
              </div>
              <div class="am-media-card-title">${escapeHTML(item.name)}</div>
              <div class="am-media-card-sub">${escapeHTML(item.artist || '')}</div>
            </div>
          `;
        }).join('');

        mixGrid.querySelectorAll('.am-standard-media-card').forEach(card => {
          card.onclick = () => {
            const idx = parseInt(card.dataset.idx, 10);
            const it = items[idx];
            if (!it) return;
            if (it.itemType === 'song') {
              loadRemoteTrack({
                trackId: it.id,
                trackName: it.name,
                artistName: it.artist,
                collectionName: it.album || '',
                albumId: it.albumId || null,
                artistId: it.artistId || null,
                artworkUrl100: it.artUrl
              });
            } else if (it.itemType === 'album') {
              showAlbumView(it.id, it.name);
            } else if (it.itemType === 'artist') {
              showArtistView(it.id, it.name);
            } else if (it.itemType === 'playlist') {
              switchPage('playlists');
              openLocalPlaylistDetail(it.id);
            }
          };
        });
      }
    }

    // 2. Songs
    if (songsGrid) {
      const songs = getLibrarySongs();
      if (songs.length === 0) {
        songsGrid.innerHTML = `<p class="am-empty-msg">${t('empty_library')}</p>`;
      } else {
        songsGrid.innerHTML = songs.map((s, i) => `
          <div class="am-song-row-item animate-fade" data-id="${s.id}" data-idx="${i}">
            <div class="am-song-row-num">${i + 1}</div>
            <img src="${cleanArtworkUrl(s.artUrl, 100, 100)}" loading="lazy" referrerpolicy="no-referrer" class="am-song-row-art">
            <div class="am-song-row-info">
              <div class="am-song-row-title">${escapeHTML(s.name)}</div>
              <div class="am-song-row-artist">${escapeHTML(s.artist)}</div>
            </div>
            <button class="am-song-more-btn" data-id="${s.id}" data-idx="${i}">•••</button>
          </div>
        `).join('');

        songsGrid.querySelectorAll('.am-song-row-item').forEach(row => {
          row.onclick = (e) => {
            const idx = parseInt(row.dataset.idx, 10);
            const song = songs[idx];
            if (e.target.classList.contains('am-song-more-btn')) {
              e.stopPropagation();
              showContextMenu(e, {
                trackId: song.id,
                trackName: song.name,
                artistName: song.artist,
                collectionName: song.album,
                albumId: song.albumId || null,
                artistId: song.artistId || null,
                artworkUrl100: song.artUrl
              });
              return;
            }
            loadRemoteTrack({
              trackId: song.id,
              trackName: song.name,
              artistName: song.artist,
              collectionName: song.album,
              albumId: song.albumId || null,
              artistId: song.artistId || null,
              artworkUrl100: song.artUrl
            });
          };
        });
      }
    }

    // 3. Albums
    if (albumsGrid) {
      const albums = getLibraryAlbums();
      if (albums.length === 0) {
        albumsGrid.innerHTML = `<p class="am-empty-msg">${t('empty_library')}</p>`;
      } else {
        albumsGrid.innerHTML = albums.map((a, i) => `
          <div class="am-standard-media-card animate-fade" data-id="${a.id}" data-idx="${i}">
            <img src="${cleanArtworkUrl(a.artUrl, 300, 300)}" loading="lazy" referrerpolicy="no-referrer" class="am-media-card-art">
            <div class="am-media-card-title">${escapeHTML(a.name)}</div>
            <div class="am-media-card-sub">${escapeHTML(a.artist)}</div>
          </div>
        `).join('');

        albumsGrid.querySelectorAll('.am-standard-media-card').forEach(card => {
          card.onclick = () => {
            const idx = parseInt(card.dataset.idx, 10);
            const alb = albums[idx];
            if (alb) {
              showAlbumView(alb.id);
            }
          };
        });
      }
    }

    // 4. Artists
    if (artistsGrid) {
      const artists = getLibraryArtists();
      if (artists.length === 0) {
        artistsGrid.innerHTML = `<p class="am-empty-msg">${t('empty_library')}</p>`;
      } else {
        artistsGrid.innerHTML = artists.map((art, i) => `
          <div class="am-standard-media-card animate-fade" data-id="${art.id}" data-idx="${i}">
            <img src="${cleanArtworkUrl(art.artUrl, 300, 300)}" loading="lazy" referrerpolicy="no-referrer" class="am-media-card-art artist-circle">
            <div class="am-media-card-title">${escapeHTML(art.name)}</div>
            <div class="am-media-card-sub">${escapeHTML(art.genre || t('badge_artist'))}</div>
          </div>
        `).join('');

        artistsGrid.querySelectorAll('.am-standard-media-card').forEach(card => {
          card.onclick = () => {
            const idx = parseInt(card.dataset.idx, 10);
            const art = artists[idx];
            if (art) {
              showArtistView(art.id, art.name);
            }
          };
        });
      }
    }
  }

  // ── Library Hub Page (Mobile) ──
  async function renderLibraryHubPage() {
    const recentAddedRow = document.getElementById('hub-recent-added-row');
    const playlistsRow = document.getElementById('hub-playlists-row');
    const recentListenedRow = document.getElementById('hub-recent-listened-row');

    if (recentAddedRow) {
      const items = await getRecentlyAdded(15);
      if (items.length === 0) {
        recentAddedRow.innerHTML = `<p class="am-empty-msg">${t('rec_added_empty')}</p>`;
      } else {
        recentAddedRow.innerHTML = items.map((item, i) => `
          <div class="am-standard-media-card animate-fade" data-type="${item.itemType}" data-id="${item.id}" data-idx="${i}">
            <img src="${cleanArtworkUrl(item.artUrl, 300, 300)}" loading="lazy" referrerpolicy="no-referrer" class="am-media-card-art ${item.itemType === 'artist' ? 'artist-circle' : ''}">
            <div class="am-media-card-title">${escapeHTML(item.name)}</div>
            <div class="am-media-card-sub">${escapeHTML(item.artist || '')}</div>
          </div>
        `).join('');

        recentAddedRow.querySelectorAll('.am-standard-media-card').forEach(card => {
          card.onclick = () => {
            const idx = parseInt(card.dataset.idx, 10);
            const it = items[idx];
            if (it.itemType === 'song') {
              loadRemoteTrack({ trackId: it.id, trackName: it.name, artistName: it.artist, collectionName: it.album || '', albumId: it.albumId || null, artistId: it.artistId || null, artworkUrl100: it.artUrl });
            } else if (it.itemType === 'album') {
              showAlbumView(it.id, it.name);
            } else if (it.itemType === 'artist') {
              showArtistView(it.id, it.name);
            }
          };
        });
      }
    }

    if (playlistsRow) {
      const playlists = await getPlaylists();
      if (playlists.length === 0) {
        playlistsRow.innerHTML = `<p class="am-empty-msg">${t('playlists_empty')}</p>`;
      } else {
        const cardsHTML = await Promise.all(playlists.map(async (p, i) => {
          const pTracks = await getPlaylistTracks(p.id);
          const firstArt = pTracks[0]?.artUrl || 'favicon.svg';
          return `
            <div class="am-standard-media-card animate-fade" data-id="${p.id}" data-idx="${i}">
              <img src="${cleanArtworkUrl(firstArt, 300, 300)}" loading="lazy" referrerpolicy="no-referrer" class="am-media-card-art">
              <div class="am-media-card-title">${escapeHTML(p.name)}</div>
              <div class="am-media-card-sub">${t('lib_tracks_count', { count: pTracks.length })}</div>
            </div>
          `;
        }));
        playlistsRow.innerHTML = cardsHTML.join('');

        playlistsRow.querySelectorAll('.am-standard-media-card').forEach(card => {
          card.onclick = () => {
            switchPage('playlists');
            openLocalPlaylistDetail(parseInt(card.dataset.id, 10));
          };
        });
      }
    }

    if (recentListenedRow) {
      const recent10 = getRecentlyPlayed10();
      if (recent10.length === 0) {
        recentListenedRow.innerHTML = `<p class="am-empty-msg">${t('recent_empty')}</p>`;
      } else {
        recentListenedRow.innerHTML = recent10.map((song, i) => `
          <div class="am-standard-media-card animate-fade" data-id="${song.id}" data-idx="${i}">
            <img src="${cleanArtworkUrl(song.artUrl, 300, 300)}" loading="lazy" referrerpolicy="no-referrer" class="am-media-card-art">
            <div class="am-media-card-title">${escapeHTML(song.title)}</div>
            <div class="am-media-card-sub">${escapeHTML(song.artist)}</div>
          </div>
        `).join('');

        recentListenedRow.querySelectorAll('.am-standard-media-card').forEach(card => {
          card.onclick = () => {
            const idx = parseInt(card.dataset.idx, 10);
            const song = recent10[idx];
            if (song) {
              loadRemoteTrack({ trackId: song.id, trackName: song.title, artistName: song.artist, collectionName: song.album, albumId: song.albumId || null, artistId: song.artistId || null, artworkUrl100: song.artUrl });
            }
          };
        });
      }
    }

    const hubCreateBtn = document.getElementById('hub-create-playlist-btn');
    if (hubCreateBtn) {
      hubCreateBtn.onclick = () => {
        const name = prompt(t('prompt_enter_playlist_name'));
        if (name && name.trim()) {
          createPlaylist(name.trim()).then(() => renderLibraryHubPage());
        }
      };
    }
  }

  // ── Library Artists & Albums Pages ──
  function renderLibraryArtistsPage() {
    const grid = document.getElementById('library-artists-grid');
    if (!grid) return;
    const artists = getLibraryArtists();
    if (artists.length === 0) {
      grid.innerHTML = `<p class="am-empty-msg">${t('empty_library')}</p>`;
    } else {
      grid.innerHTML = artists.map((art, i) => `
        <div class="am-standard-media-card animate-fade" data-id="${art.id}" data-idx="${i}">
          <img src="${cleanArtworkUrl(art.artUrl, 300, 300)}" loading="lazy" referrerpolicy="no-referrer" class="am-media-card-art artist-circle">
          <div class="am-media-card-title">${escapeHTML(art.name)}</div>
          <div class="am-media-card-sub">${escapeHTML(art.genre || t('badge_artist'))}</div>
        </div>
      `).join('');

      grid.querySelectorAll('.am-standard-media-card').forEach(card => {
        card.onclick = () => {
          const idx = parseInt(card.dataset.idx, 10);
          const art = artists[idx];
          if (art) {
            showArtistView(art.id, art.name);
          }
        };
      });
    }
  }

  function renderLibraryAlbumsPage() {
    const grid = document.getElementById('library-albums-grid');
    if (!grid) return;
    const albums = getLibraryAlbums();
    if (albums.length === 0) {
      grid.innerHTML = `<p class="am-empty-msg">${t('empty_library')}</p>`;
    } else {
      grid.innerHTML = albums.map((alb, i) => `
        <div class="am-standard-media-card animate-fade" data-id="${alb.id}" data-idx="${i}">
          <img src="${cleanArtworkUrl(alb.artUrl, 300, 300)}" loading="lazy" referrerpolicy="no-referrer" class="am-media-card-art">
          <div class="am-media-card-title">${escapeHTML(alb.name)}</div>
          <div class="am-media-card-sub">${escapeHTML(alb.artist)}</div>
        </div>
      `).join('');

      grid.querySelectorAll('.am-standard-media-card').forEach(card => {
        card.onclick = () => {
          const idx = parseInt(card.dataset.idx, 10);
          const alb = albums[idx];
          if (alb) {
            showAlbumView(alb.id, alb.name);
          }
        };
      });
    }
  }

  // ── Update Sidebar Top 4 Playlists ──
  async function updateSidebarPlaylists() {
    const container = document.getElementById('sidebar-playlists-list');
    if (!container) return;

    try {
      const playlists = await getPlaylists();
      const userPlaylists = playlists.filter(p => p.name !== 'Favorites').slice(0, 4);

      if (userPlaylists.length === 0) {
        container.innerHTML = '';
        return;
      }

      const itemsHTML = await Promise.all(userPlaylists.map(async p => {
        const tracks = await getPlaylistTracks(p.id);
        const firstArt = tracks[0]?.artUrl || 'favicon.svg';
        return `
          <div class="am-sidebar-playlist-item" data-id="${p.id}">
            <img src="${cleanArtworkUrl(firstArt, 60, 60)}" loading="lazy" referrerpolicy="no-referrer" class="am-sidebar-playlist-cover" alt="">
            <span class="am-sidebar-playlist-name">${escapeHTML(p.name)}</span>
          </div>
        `;
      }));

      container.innerHTML = itemsHTML.join('');

      container.querySelectorAll('.am-sidebar-playlist-item').forEach(item => {
        item.onclick = (e) => {
          e.stopPropagation();
          const pId = parseInt(item.dataset.id, 10);
          switchPage('playlists');
          openLocalPlaylistDetail(pId);
        };
      });
    } catch (e) {
      console.warn('[Sidebar] Error loading top 4 playlists:', e);
    }
  }

  // ── Categories & Landing View ──
  async function loadLandingView() {
    renderRecentlySearched();
    fetchCategories();
    syncHomeNavVisibility();
  }

  async function fetchCategories() {
    if (!categoriesGrid) return;
    try {
      const res = await fetch(`${API_BASE}/recommendations?name=search-landing&l=${getCurrentLang()}`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();

      const curators = data.resources?.['apple-curators'] || {};
      const categories = Object.values(curators);

      if (categories.length === 0) {
        categoriesGrid.innerHTML = `<p class="am-empty-msg">${t('empty_categories')}</p>`;
        return;
      }

      categoriesGrid.innerHTML = categories.map(cat => {
        const attr = cat.attributes || {};
        const rawUrl = attr.artwork?.url || '';
        const artUrl = rawUrl ? cleanArtworkUrl(rawUrl, 480, 270) : '';

        return `
          <div class="am-category-card animate-fade" data-curator="${cat.id}">
            ${artUrl ? `<img src="${cleanArtworkUrl(artUrl)}" class="am-category-bg" loading="lazy" referrerpolicy="no-referrer" alt="" onerror="this.style.display='none'">` : ''}
            <div class="am-category-title">${escapeHTML(attr.name || t('nav_search'))}</div>
          </div>
        `;
      }).join('');

      categoriesGrid.querySelectorAll('.am-category-card').forEach(card => {
        card.onclick = () => {
          const title = card.querySelector('.am-category-title')?.textContent || '';
          catalogSearch.value = title;
          performCatalogSearch(title);
        };
      });

    } catch (err) {
      console.error(err);
      categoriesGrid.innerHTML = `<p class="am-error-msg">${t('error')}</p>`;
    }
  }

  // ── Recent Searches (Direct Navigation to Entity) ──
  function renderRecentlySearched() {
    if (!recentlySearchedGrid || !recentlySearchedSection) return;
    const recents = JSON.parse(localStorage.getItem('lyricsflow_recent_searches') || '[]');
    if (recents.length === 0) {
      recentlySearchedSection.classList.add('hidden');
      return;
    }
    recentlySearchedSection.classList.remove('hidden');

    recentlySearchedGrid.innerHTML = recents.map(item => `
      <div class="am-recent-search-chip" data-id="${item.id || ''}" data-type="${item.type || ''}" data-query="${escapeHTML(item.query || '')}" data-title="${escapeHTML(item.title || '')}" data-artist="${escapeHTML(item.artistName || '')}" data-album="${escapeHTML(item.albumName || '')}" data-art="${escapeHTML(item.artUrl || '')}">
        <img src="${cleanArtworkUrl(item.artUrl, 80, 80)}" class="am-chip-art" loading="lazy" referrerpolicy="no-referrer" alt="">
        <div class="am-chip-info">
          <span class="am-chip-title">${escapeHTML(item.title || item.query)}</span>
          <span class="am-chip-sub">${escapeHTML(item.subtitle || item.type || t('nav_search'))}</span>
        </div>
      </div>
    `).join('');

    recentlySearchedGrid.querySelectorAll('.am-recent-search-chip').forEach(chip => {
      chip.onclick = () => {
        const id = chip.dataset.id;
        const type = (chip.dataset.type || '').toLowerCase();
        const title = chip.dataset.title;
        const query = chip.dataset.query;

        // If it was a specific entity, navigate directly to it!
        if (id && type) {
          if (type.includes('song')) {
            loadRemoteTrack({
              trackId: id,
              trackName: title,
              artistName: chip.dataset.artist || '',
              collectionName: chip.dataset.album || '',
              artworkUrl100: chip.dataset.art || ''
            });
            return;
          } else if (type.includes('album')) {
            showAlbumView(id, title);
            return;
          } else if (type.includes('artist')) {
            showArtistView(id, title);
            return;
          } else if (type.includes('playlist')) {
            showRemotePlaylistView(id, title);
            return;
          } else if (type.includes('video')) {
            playMusicVideo(id, title);
            return;
          } else if (type.includes('label')) {
            showRecordLabelView(id, title);
            return;
          } else if (type.includes('curator')) {
            showCuratorView(id, title);
            return;
          }
        }

        // Fallback to searching the query term
        const q = query || title;
        if (q) {
          catalogSearch.value = q;
          performCatalogSearch(q);
        }
      };
    });
  }

  if (clearRecentSearchesBtn) {
    clearRecentSearchesBtn.onclick = () => {
      localStorage.removeItem('lyricsflow_recent_searches');
      renderRecentlySearched();
    };
  }

  function addRecentSearch(query, title, type, artUrl, id = null, extra = {}) {
    let recents = JSON.parse(localStorage.getItem('lyricsflow_recent_searches') || '[]');
    const identifier = id || query;
    recents = recents.filter(r => (r.id ? r.id !== id : r.query !== query));

    let subtitle = type;
    if (type === 'songs' || type === 'song') subtitle = extra.artistName ? `Song • ${extra.artistName}` : 'Song';
    else if (type === 'albums' || type === 'album') subtitle = extra.artistName ? `Album • ${extra.artistName}` : 'Album';
    else if (type === 'record-labels' || type === 'record-label') subtitle = 'RECORD LABEL';
    else if (type === 'playlists' || type === 'playlist') subtitle = 'Playlist';

    recents.unshift({
      id: id || null,
      query: query || title,
      title: title || query,
      type: type || 'search',
      subtitle: subtitle,
      artUrl: artUrl || '',
      artistName: extra.artistName || '',
      albumName: extra.albumName || ''
    });
    if (recents.length > 10) recents.pop();
    localStorage.setItem('lyricsflow_recent_searches', JSON.stringify(recents));
  }

  // ── Search Handling ──
  let searchDebounce = null;
  if (catalogSearch) {
    catalogSearch.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      if (searchClearBtn) {
        if (q.length > 0) searchClearBtn.classList.remove('hidden');
        else searchClearBtn.classList.add('hidden');
      }

      clearTimeout(searchDebounce);
      if (!q) {
        clearSearchUI();
        return;
      }
      searchDebounce = setTimeout(() => performCatalogSearch(q), 350);
    });

    catalogSearch.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(searchDebounce);
        const q = catalogSearch.value.trim();
        if (q) performCatalogSearch(q);
      }
    });
  }

  if (searchClearBtn) {
    searchClearBtn.onclick = () => {
      catalogSearch.value = '';
      searchClearBtn.classList.add('hidden');
      clearSearchUI();
      catalogSearch.focus();
    };
  }

  function clearSearchUI() {
    if (searchBarWrapper) searchBarWrapper.classList.remove('hidden');
    if (searchResultsContainer) searchResultsContainer.classList.add('hidden');
    if (albumViewContainer) albumViewContainer.classList.add('hidden');
    if (artistViewContainer) artistViewContainer.classList.add('hidden');
    if (playlistViewContainer) playlistViewContainer.classList.add('hidden');
    if (songViewContainer) songViewContainer.classList.add('hidden');
    if (listenInitialContent) listenInitialContent.classList.remove('hidden');
  }

  async function performCatalogSearch(query, options = {}) {
    if (!query) return;

    if (!options.skipUrlSync) {
      syncUrl('/search', `q=${encodeURIComponent(query)}`, options.replaceUrl);
    }

    if (searchBarWrapper) searchBarWrapper.classList.remove('hidden');
    if (listenInitialContent) listenInitialContent.classList.add('hidden');
    if (albumViewContainer) albumViewContainer.classList.add('hidden');
    if (artistViewContainer) artistViewContainer.classList.add('hidden');
    if (playlistViewContainer) playlistViewContainer.classList.add('hidden');
    if (songViewContainer) songViewContainer.classList.add('hidden');
    if (searchResultsContainer) searchResultsContainer.classList.remove('hidden');

    [sectionTopResults, sectionArtists, sectionSongs, sectionAlbums, sectionPlaylists, sectionVideos, sectionStations, sectionLabels, sectionCurators].forEach(s => {
      if (s) {
        s.classList.remove('hidden');
        const grid = s.querySelector('div');
        if (grid) grid.innerHTML = `<div class="am-loading-msg">${t('loading')}</div>`;
      }
    });

    try {
      const searchUrl = `${API_BASE}/v1/catalog/kz/search?art[music-videos:url]=c&art[url]=f&extend=artistUrl&fields[albums]=artistName,artistUrl,artwork,contentRating,editorialArtwork,editorialNotes,name,playParams,releaseDate,url,trackCount&fields[artists]=url,name,artwork&format[resources]=map&include[albums]=artists&include[music-videos]=artists&include[songs]=artists&include[stations]=radio-show&l=${getCurrentLang() || 'en-GB'}&limit=21&omit[resource]=autos&platform=web&relate[albums]=artists&relate[songs]=albums&term=${encodeURIComponent(query)}&types=activities,albums,apple-curators,artists,curators,editorial-items,music-movies,music-videos,playlists,record-labels,songs,stations,tv-episodes,uploaded-videos&with=lyricHighlights,lyrics,naturalLanguage,serverBubbles,subtitles`;
      const res = await fetch(searchUrl);
      if (!res.ok) throw new Error(`Search error ${res.status}`);
      const rawData = await res.json();
      const parsed = parseAmpResponse(rawData);
      const results = parsed.results || rawData.results || {};

      // Support 'top', 'topResults', or primary category fallback
      const topData = results.top?.data || results.topResults?.data || results.songs?.data?.slice(0, 1) || results.artists?.data?.slice(0, 1) || [];
      const topResult = topData[0];
      if (topResult) {
        const attr = topResult.attributes || topResult;
        const art = resolveArtworkUrl(attr.artwork || attr.editorialArtwork, { width: 100, height: 100 });
        addRecentSearch(query, attr.name || query, topResult.type, art);
      }

      const artistData = results.artists?.data || [];
      const songData = results.songs?.data || [];
      const albumData = results.albums?.data || [];
      const playlistData = results.playlists?.data || [];
      const videoData = results.music_video?.data || results['music-videos']?.data || results['uploaded-videos']?.data || [];
      const stationData = results.stations?.data || [];
      const labelData = results['record-labels']?.data || results.record_label?.data || results['record-label']?.data || [];
      const curatorData = results.curators?.data || results['apple-curators']?.data || results.activities?.data || [];

      renderTopResults(topData);
      renderArtists(artistData);
      renderSongs(songData);
      renderAlbums(albumData);
      renderPlaylists(playlistData);
      renderMusicVideos(videoData);
      renderStations(stationData);
      renderRecordLabels(labelData);
      renderCurators(curatorData);

    } catch (err) {
      console.error(err);
      if (topResultsGrid) topResultsGrid.innerHTML = `<div class="am-error-msg">${t('error')}: ${err.message}</div>`;
    }
  }

  function renderTopResults(items) {
    if (!sectionTopResults || !topResultsGrid) return;
    if (items.length === 0) {
      sectionTopResults.classList.add('hidden');
      return;
    }
    sectionTopResults.classList.remove('hidden');

    topResultsGrid.innerHTML = items.slice(0, 4).map((item, i) => {
      const attr = item.attributes || {};
      const artUrl = cleanArtworkUrl(attr.artwork?.url, 300, 300);
      const isArtist = item.type === 'artists';
      const badgeKey = item.type === 'artists' ? 'badge_artist' :
        item.type === 'albums' ? 'badge_album' :
          item.type === 'songs' ? 'badge_song' :
            item.type === 'playlists' ? 'badge_playlist' :
              item.type === 'music_video' || item.type === 'music-videos' ? 'badge_video' : 'badge_song';

      return `
        <div class="am-top-card animate-fade" data-type="${item.type}" data-id="${item.id}" data-idx="${i}">
          <img src="${cleanArtworkUrl(artUrl)}" loading="lazy" referrerpolicy="no-referrer" class="am-top-card-art ${isArtist ? 'artist-circle' : ''}">
          <div class="am-top-card-info">
            <h3 class="am-top-card-title">${escapeHTML(attr.name || '')}</h3>
            <p class="am-top-card-subtitle">${escapeHTML(attr.artistName || (isArtist ? t('badge_artist') : ''))}</p>
            <span class="am-top-card-badge">${t(badgeKey)}</span>
          </div>
        </div>
      `;
    }).join('');

    topResultsGrid.querySelectorAll('.am-top-card').forEach(card => {
      card.onclick = () => {
        const type = card.dataset.type;
        const id = card.dataset.id;
        const title = card.querySelector('.am-top-card-title')?.textContent || '';
        if (type === 'songs') {
          showSongView(id, title);
        } else if (type === 'albums') {
          showAlbumView(id, title);
        } else if (type === 'artists') {
          showArtistView(id, title);
        } else if (type === 'playlists') {
          showRemotePlaylistView(id, title);
        } else if (type === 'music_video' || type === 'music-videos') {
          playMusicVideo(id, title);
        }
      };
    });
  }

  function renderArtists(artists) {
    if (!sectionArtists || !artistsGrid) return;
    if (artists.length === 0) {
      sectionArtists.classList.add('hidden');
      return;
    }
    sectionArtists.classList.remove('hidden');

    artistsGrid.innerHTML = artists.map(art => {
      const attr = art.attributes || {};
      const artUrl = cleanArtworkUrl(attr.artwork?.url, 240, 240);

      return `
        <div class="am-artist-card animate-fade" data-id="${art.id}">
          <img src="${cleanArtworkUrl(artUrl)}" loading="lazy" referrerpolicy="no-referrer" class="am-artist-art" alt="">
          <div class="am-artist-name">${escapeHTML(attr.name || '')}</div>
          <div class="am-artist-sub">${t('badge_artist')}</div>
        </div>
      `;
    }).join('');

    artistsGrid.querySelectorAll('.am-artist-card').forEach(card => {
      card.onclick = () => {
        const name = card.querySelector('.am-artist-name')?.textContent || '';
        showArtistView(card.dataset.id, name);
      };
    });
  }

  function renderSongs(songs) {
    if (!sectionSongs || !songsGrid) return;
    if (songs.length === 0) {
      sectionSongs.classList.add('hidden');
      return;
    }
    sectionSongs.classList.remove('hidden');

    songsGrid.innerHTML = songs.map((s, i) => {
      const attr = s.attributes || {};
      const artUrl = cleanArtworkUrl(attr.artwork?.url, 60, 60);

      return `
        <div class="am-song-row-item animate-fade" data-id="${s.id}" data-idx="${i}">
          <div class="am-song-row-num">${i + 1}</div>
          <img src="${cleanArtworkUrl(artUrl)}" loading="lazy" referrerpolicy="no-referrer" class="am-song-row-art">
          <div class="am-song-row-info">
            <div class="am-song-row-title">${escapeHTML(attr.name || '')}</div>
            <div class="am-song-row-artist">${escapeHTML(attr.artistName || '')}</div>
          </div>
          <button class="am-song-more-btn" data-id="${s.id}" data-idx="${i}">•••</button>
        </div>
      `;
    }).join('');

    songsGrid.querySelectorAll('.am-song-row-item').forEach(row => {
      row.onclick = (e) => {
        const idx = parseInt(row.dataset.idx, 10);
        const song = songs[idx];
        const attr = song?.attributes || {};
        const albumId = song?.relationships?.albums?.data?.[0]?.id || attr.url?.match(/\/album\/[^/]+\/(\d+)/)?.[1] || null;
        const artistId = song?.relationships?.artists?.data?.[0]?.id || null;

        if (e.target.classList.contains('am-song-more-btn')) {
          e.stopPropagation();
          showContextMenu(e, {
            trackId: song.id,
            trackName: attr.name,
            artistName: attr.artistName,
            collectionName: attr.albumName,
            albumId,
            artistId,
            artworkUrl100: cleanArtworkUrl(attr.artwork?.url, 100, 100)
          });
          return;
        }

        addRecentSearch(attr.name, attr.name, 'songs', cleanArtworkUrl(attr.artwork?.url, 100, 100), song.id, {
          artistName: attr.artistName,
          albumName: attr.albumName
        });

        showSongView(song.id, attr.name);

        // Fetch recommended songs by similar artists + the same artist using songs endpoint
        (async () => {
          try {
            const queryTerm = attr.artistName || attr.name || '';
            const recRes = await fetch(`${API_BASE}/search?term=${encodeURIComponent(queryTerm)}&types=songs&limit=20&l=en-US`);
            if (recRes.ok) {
              const recData = await recRes.json();
              const recSongs = recData?.results?.songs?.data || [];
              const existingIds = new Set(previewPlayer.queue.map(x => String(x.id)));
              const addQueue = [];
              for (const r of recSongs) {
                if (!existingIds.has(String(r.id))) {
                  existingIds.add(String(r.id));
                  const rAttr = r.attributes || {};
                  addQueue.push({
                    id: r.id,
                    title: rAttr.name,
                    artist: rAttr.artistName,
                    album: rAttr.albumName,
                    artUrl: cleanArtworkUrl(rAttr.artwork?.url, 300, 300),
                    previewUrl: `${API_BASE}/stream?song=${r.id}&l=en-US`,
                    durationMs: rAttr.durationInMillis || 180000
                  });
                }
              }
              if (addQueue.length > 0) {
                previewPlayer.queue.push(...addQueue);
              }
            }
          } catch (_) {}
        })();
      };
    });
  }

  function renderAlbums(albums) {
    if (!sectionAlbums || !albumsGrid) return;
    if (albums.length === 0) {
      sectionAlbums.classList.add('hidden');
      return;
    }
    sectionAlbums.classList.remove('hidden');

    albumsGrid.innerHTML = albums.map(alb => {
      const attr = alb.attributes || {};
      const artUrl = cleanArtworkUrl(attr.artwork?.url, 300, 300);

      return `
        <div class="am-standard-media-card animate-fade" data-id="${alb.id}">
          <img src="${cleanArtworkUrl(artUrl)}" loading="lazy" referrerpolicy="no-referrer" class="am-media-card-art">
          <div class="am-media-card-title">${escapeHTML(attr.name || '')}</div>
          <div class="am-media-card-sub">${escapeHTML(attr.artistName || '')}</div>
        </div>
      `;
    }).join('');

    albumsGrid.querySelectorAll('.am-standard-media-card').forEach(card => {
      card.onclick = () => {
        const title = card.querySelector('.am-media-card-title')?.textContent || 'Album';
        const artist = card.querySelector('.am-media-card-sub')?.textContent || '';
        const img = card.querySelector('img')?.src || '';
        addRecentSearch(title, title, 'albums', img, card.dataset.id, { artistName: artist });
        showAlbumView(card.dataset.id, title);
      };
    });
  }

  function renderPlaylists(playlists) {
    if (!sectionPlaylists || !playlistsSearchGrid) return;
    if (playlists.length === 0) {
      sectionPlaylists.classList.add('hidden');
      return;
    }
    sectionPlaylists.classList.remove('hidden');

    playlistsSearchGrid.innerHTML = playlists.map(pl => {
      const attr = pl.attributes || {};
      const artUrl = cleanArtworkUrl(attr.artwork?.url, 300, 300);

      return `
        <div class="am-standard-media-card animate-fade" data-id="${pl.id}">
          <img src="${cleanArtworkUrl(artUrl)}" loading="lazy" referrerpolicy="no-referrer" class="am-media-card-art">
          <div class="am-media-card-title">${escapeHTML(attr.name || '')}</div>
          <div class="am-media-card-sub">${escapeHTML(attr.curatorName || 'Apple Music')}</div>
        </div>
      `;
    }).join('');

    playlistsSearchGrid.querySelectorAll('.am-standard-media-card').forEach(card => {
      card.onclick = () => {
        const name = card.querySelector('.am-media-card-title')?.textContent || 'Playlist';
        showRemotePlaylistView(card.dataset.id, name);
      };
    });
  }

  function renderMusicVideos(videos) {
    if (!sectionVideos || !videosGrid) return;
    if (videos.length === 0) {
      sectionVideos.classList.add('hidden');
      return;
    }
    sectionVideos.classList.remove('hidden');

    videosGrid.innerHTML = videos.map(vid => {
      const attr = vid.attributes || {};
      const artUrl = cleanArtworkUrl(attr.artwork?.url, 320, 180);

      return `
        <div class="am-standard-media-card animate-fade" data-id="${vid.id}">
          <img src="${cleanArtworkUrl(artUrl)}" loading="lazy" referrerpolicy="no-referrer" class="am-media-card-art" style="aspect-ratio: 16/9;">
          <div class="am-media-card-title">${escapeHTML(attr.name || '')}</div>
          <div class="am-media-card-sub">${escapeHTML(attr.artistName || '')}</div>
        </div>
      `;
    }).join('');

    videosGrid.querySelectorAll('.am-standard-media-card').forEach(card => {
      card.onclick = () => {
        const title = card.querySelector('.am-media-card-title')?.textContent || '';
        const artist = card.querySelector('.am-media-card-sub')?.textContent || '';
        playMusicVideo(card.dataset.id, title, artist);
      };
    });
  }

  function renderStations(stations) {
    if (!sectionStations || !stationsGrid) return;
    if (stations.length === 0) {
      sectionStations.classList.add('hidden');
      return;
    }
    sectionStations.classList.remove('hidden');

    stationsGrid.innerHTML = stations.map(st => {
      const attr = st.attributes || {};
      const artUrl = cleanArtworkUrl(attr.artwork?.url, 300, 300);

      return `
        <div class="am-standard-media-card animate-fade" data-id="${st.id}">
          <img src="${cleanArtworkUrl(artUrl)}" loading="lazy" referrerpolicy="no-referrer" class="am-media-card-art">
          <div class="am-media-card-title">${escapeHTML(attr.name || 'Station')}</div>
          <div class="am-media-card-sub">${escapeHTML(attr.mediaKind || 'Radio')}</div>
        </div>
      `;
    }).join('');
  }

  function renderRecordLabels(labels) {
    if (!sectionLabels || !labelsGrid) return;
    if (labels.length === 0) {
      sectionLabels.classList.add('hidden');
      return;
    }
    sectionLabels.classList.remove('hidden');

    labelsGrid.innerHTML = labels.map(rl => {
      const attr = rl.attributes || {};
      const artUrl = cleanArtworkUrl(attr.artwork?.url, 300, 300);

      return `
        <div class="am-standard-media-card animate-fade" data-id="${rl.id}" data-name="${escapeHTML(attr.name || 'Record Label')}">
          <img src="${cleanArtworkUrl(artUrl)}" loading="lazy" referrerpolicy="no-referrer" class="am-media-card-art">
          <div class="am-media-card-title">${escapeHTML(attr.name || 'Record Label')}</div>
          <div class="am-media-card-sub">Record Label</div>
        </div>
      `;
    }).join('');

    labelsGrid.querySelectorAll('.am-standard-media-card').forEach(card => {
      card.onclick = () => {
        showRecordLabelView(card.dataset.id, card.dataset.name);
      };
    });
  }

  function renderCurators(curators) {
    if (!sectionCurators || !curatorsGrid) return;
    if (curators.length === 0) {
      sectionCurators.classList.add('hidden');
      return;
    }
    sectionCurators.classList.remove('hidden');

    curatorsGrid.innerHTML = curators.map(cr => {
      const attr = cr.attributes || {};
      const artUrl = cleanArtworkUrl(attr.artwork?.url, 300, 300);

      return `
        <div class="am-standard-media-card animate-fade" data-id="${cr.id}" data-name="${escapeHTML(attr.name || 'Curator')}">
          <img src="${cleanArtworkUrl(artUrl)}" loading="lazy" referrerpolicy="no-referrer" class="am-media-card-art">
          <div class="am-media-card-title">${escapeHTML(attr.name || 'Curator')}</div>
          <div class="am-media-card-sub">${escapeHTML(cr.type || 'Curator')}</div>
        </div>
      `;
    }).join('');

    curatorsGrid.querySelectorAll('.am-standard-media-card').forEach(card => {
      card.onclick = () => {
        showCuratorView(card.dataset.id, card.dataset.name);
      };
    });
  }

  async function playMusicVideo(vidId, videoTitle = '', videoArtist = '', options = {}) {
    if (!prepOverlay) return;
    prepOverlay.classList.add('active');
    prepStatus.textContent = t('loading');

    try {
      let data = {};
      const customUrl = options.customUrl;
      if (customUrl && typeof customUrl === 'string' && customUrl.startsWith('http')) {
        // Direct stream or resolve via /stream or /musicvideo?url=
        try {
          const res = await fetch(`${API_BASE}/musicvideo?url=${encodeURIComponent(customUrl)}&l=${getCurrentLang()}`);
          if (res.ok) data = await res.json();
        } catch (_) {}
        if (!data.video_url && !data.preview_url && !data.hls_url) {
          data.video_url = `${API_BASE}/stream?url=${encodeURIComponent(customUrl)}&quality=1080p`;
        }
      } else {
        const queryParam = (vidId && String(vidId).startsWith('http')) ? `url=${encodeURIComponent(vidId)}` : `song=${vidId}`;
        const res = await fetch(`${API_BASE}/musicvideo?${queryParam}&l=${getCurrentLang()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
      }

      prepOverlay.classList.remove('active');

      const videoUrl = data.video_url || data.preview_url || data.hls_url;
      const title = data.title || data.name || videoTitle || 'Video';
      const artist = data.artist || data.artist_name || videoArtist || '';
      const downloadParam = (vidId && String(vidId).startsWith('http')) ? `url=${encodeURIComponent(vidId)}` : `song=${vidId}`;
      const downloadUrl = `${API_BASE}/musicvideo/download?${downloadParam}&quality=1080&l=${getCurrentLang()}`;

      if (!options.skipUrlSync) {
        syncUrl(`/video/${toSlug(title)}/${vidId}`, '', options.replaceUrl);
      }

      let videoModal = document.getElementById('music-video-modal');
      if (!videoModal) {
        videoModal = document.createElement('div');
        videoModal.id = 'music-video-modal';
        videoModal.className = 'modal-backdrop animate-fade';
        videoModal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);backdrop-filter:blur(20px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;';
        videoModal.innerHTML = `
          <div class="video-modal-content" style="max-width:840px;width:100%;background:#18181b;border:1px solid rgba(255,255,255,0.12);border-radius:18px;overflow:hidden;box-shadow:0 25px 50px -12px rgba(0,0,0,0.8);position:relative;">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 20px;border-bottom:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);">
              <div>
                <h3 id="mv-modal-title" style="margin:0;font-size:1.1rem;color:#fff;font-weight:600;">${escapeHTML(title)}</h3>
                <p id="mv-modal-artist" style="margin:2px 0 0 0;font-size:0.85rem;color:#a1a1aa;">${escapeHTML(artist)}</p>
              </div>
              <div style="display:flex;align-items:center;gap:10px;">
                <a id="mv-modal-download" href="${downloadUrl}" download="${escapeHTML(title)}.mp4" style="background:rgba(255,255,255,0.12);color:#fff;text-decoration:none;padding:6px 14px;border-radius:20px;font-size:0.85rem;display:flex;align-items:center;gap:6px;cursor:pointer;transition:background 0.2s;">
                  <img src="icons/download.png" style="width:14px;height:14px;filter:invert(1);" alt="Download">
                  <span>${t('loading_download')}</span>
                </a>
                <button id="mv-modal-close" style="background:rgba(255,255,255,0.1);border:none;color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;">✕</button>
              </div>
            </div>
            <div style="position:relative;padding-top:56.25%;background:#000;">
              <video id="mv-modal-video" controls autoplay playsinline style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;"></video>
            </div>
          </div>
        `;
        document.body.appendChild(videoModal);

        videoModal.querySelector('#mv-modal-close').onclick = () => {
          const v = videoModal.querySelector('#mv-modal-video');
          if (v) {
            v.pause();
            if (v._hlsInstance) {
              try { v._hlsInstance.destroy(); } catch (_) {}
              v._hlsInstance = null;
            }
            v.src = '';
          }
          videoModal.classList.add('hidden');
        };

        videoModal.onclick = (e) => {
          if (e.target === videoModal) {
            const v = videoModal.querySelector('#mv-modal-video');
            if (v) {
              v.pause();
              if (v._hlsInstance) {
                try { v._hlsInstance.destroy(); } catch (_) {}
                v._hlsInstance = null;
              }
              v.src = '';
            }
            videoModal.classList.add('hidden');
          }
        };
      }

      videoModal.querySelector('#mv-modal-title').textContent = title;
      videoModal.querySelector('#mv-modal-artist').textContent = artist;
      const downloadLink = videoModal.querySelector('#mv-modal-download');
      if (downloadLink) {
        downloadLink.href = downloadUrl;
        downloadLink.setAttribute('download', `${title}.mp4`);
      }
      const videoEl = videoModal.querySelector('#mv-modal-video');
      if (videoUrl) {
        playHlsStream(videoEl, videoUrl, { autoplay: true, isMuted: false });
      }
      videoModal.classList.remove('hidden');

    } catch (err) {
      console.error("Music video load failed:", err);
      prepOverlay.classList.remove('active');
      showToast({ message: `Could not load music video: ${err.message}` });
    }
  }

  // ── Album Detail View with "More by Artist" row in random order ──
  async function fetchAlbumDetails(albumId, preferredAlbumName = '', targetTrackId = null) {
    if (searchBarWrapper) searchBarWrapper.classList.add('hidden');
    if (listenInitialContent) listenInitialContent.classList.add('hidden');
    if (searchResultsContainer) searchResultsContainer.classList.add('hidden');
    if (artistViewContainer) artistViewContainer.classList.add('hidden');
    if (playlistViewContainer) playlistViewContainer.classList.add('hidden');
    if (songViewContainer) songViewContainer.classList.add('hidden');
    if (albumViewContainer) albumViewContainer.classList.remove('hidden');

    albumHeader.innerHTML = `<div class="am-loading-msg">${t('loading')}</div>`;
    albumTracksGrid.innerHTML = '';

    try {
      let data = null;
      try {
        const albumApiUrl = `${API_BASE}/album?album=${albumId}&l=en-US&include=artists,tracks,record-labels,music-videos&views=appears-on,other-versions,related-albums,related-videos&extend=artistUrl,editorialArtwork,editorialNotes,editorialVideo,composerName`;
        const res = await fetch(albumApiUrl);
        if (res.ok) {
          data = await res.json();
          if (data && data.error) data = null;
        }
      } catch (e) { }

      // Fallback to iTunes lookup if /album endpoint returned an error or empty data
      if (!data || (!data.raw_data && !data.data && !data.results && !data.parsed_tracks)) {
        try {
          const lRes = await fetch(`${API_BASE}/itunes/lookup?id=${albumId}&entity=song&l=en-US`);
          if (lRes.ok) {
            const lData = await lRes.json();
            const results = lData.results || [];
            if (results.length > 0) {
              const col = results[0];
              const tracks = results.slice(1).map((tItem, idx) => ({
                id: String(tItem.trackId || idx),
                title: tItem.trackName,
                name: tItem.trackName,
                artist: tItem.artistName,
                artistName: tItem.artistName,
                track_number: tItem.trackNumber || idx + 1,
                trackNumber: tItem.trackNumber || idx + 1,
                duration_ms: tItem.trackTimeMillis,
                durationInMillis: tItem.trackTimeMillis,
                artwork_url: cleanArtworkUrl(tItem.artworkUrl100, 300, 300),
                is_explicit: tItem.trackExplicitness === 'explicit',
                preview_url: tItem.previewUrl
              }));
              const art = cleanArtworkUrl(col.artworkUrl100, 600, 600);
              const albumObj = {
                id: String(albumId),
                type: 'albums',
                attributes: {
                  name: col.collectionName,
                  artistName: col.artistName,
                  releaseDate: col.releaseDate,
                  genreNames: [col.primaryGenreName].filter(Boolean),
                  artwork: { url: art },
                  copyright: col.copyright
                },
                relationships: {
                  artists: {
                    data: col.artistId ? [{ id: String(col.artistId), type: 'artists' }] : []
                  },
                  tracks: {
                    data: tracks.map(tr => ({
                      id: tr.id,
                      type: 'songs',
                      attributes: {
                        name: tr.title,
                        artistName: tr.artist,
                        trackNumber: tr.track_number,
                        durationInMillis: tr.duration_ms,
                        contentRating: tr.is_explicit ? 'explicit' : 'clean',
                        previews: tr.preview_url ? [{ url: tr.preview_url }] : [],
                        artwork: { url: tr.artwork_url }
                      }
                    }))
                  }
                }
              };
              data = {
                album_id: albumId,
                total_parsed_tracks: tracks.length,
                parsed_tracks: tracks,
                raw_data: { data: [albumObj] },
                data: [albumObj]
              };
            }
          }
        } catch (e) { }
      }

      if (!data) throw new Error('Album not found');

      // Robust extraction compatible with raw_data or standard data envelopes
      const albumObj = data.raw_data?.data?.[0] || data.data?.[0] || data.results?.albums?.data?.[0] || data;
      if (!albumObj || (!albumObj.attributes && !albumObj.name)) throw new Error('Album not found in response');

      const attr = albumObj.attributes || albumObj;
      const albumDisplayName = attr.name || preferredAlbumName || 'Album';
      const albumSlug = toSlug(albumDisplayName);
      const artUrl = cleanArtworkUrl(attr.artwork?.url || data.artwork_url, 600, 600);
      const artistId = albumObj.relationships?.artists?.data?.[0]?.id || data.artist_id || attr.artistId || null;
      const artistName = attr.artistName || data.artist_name || '';

      // Update slug URL with actual album name if not already matching
      const targetSearch = targetTrackId ? `i=${targetTrackId}` : '';
      syncUrl(`/album/${albumSlug}/${albumId}`, targetSearch, true);

      let videoUrl = null;
      try {
        const animRes = await fetch(`${API_BASE}/animatedart?album=${albumId}&l=${getCurrentLang()}`);
        if (animRes.ok) {
          const animData = await animRes.json();
          videoUrl = animData.videoUrl || animData.url;
        }
      } catch (e) { }

      const year = attr.releaseDate ? new Date(attr.releaseDate).getFullYear() : '';
      const genre = attr.genreNames?.[0] || 'Music';
      const inLib = isAlbumInLibrary(albumId);

      // Render Album Header
      albumHeader.innerHTML = `
        <div class="am-album-art-container">
          ${videoUrl ? `<video src="${cleanMediaUrl(videoUrl)}" autoplay loop muted playsinline class="am-album-cover"></video>` : `<img src="${cleanArtworkUrl(artUrl, 600, 600)}" referrerpolicy="no-referrer" class="am-album-cover" onerror="this.src='favicon.svg'">`}
        </div>
        <div class="am-album-details">
          <h2 class="am-album-title">${escapeHTML(albumDisplayName)}</h2>
          <div class="am-album-artist" id="album-artist-link" style="${artistId || artistName ? 'cursor:pointer;' : ''}">${escapeHTML(artistName)}</div>
          <div class="am-album-meta">${escapeHTML(genre)} • ${year}</div>
          <div class="am-album-actions" style="display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap;">
            <button class="premium-btn primary" id="album-play-btn" style="border-radius:100px; padding:0 28px; height:42px; display:inline-flex; align-items:center; gap:8px;">
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5v14l11-7z"/></svg>
              <span>Play</span>
            </button>
            <button class="premium-btn secondary" id="album-add-lib-btn" style="border-radius:100px; padding:0 22px; height:42px; display:inline-flex; align-items:center; gap:8px;">
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
              <span id="album-lib-label">${inLib ? t('ctx_in_library') : t('ctx_add_library')}</span>
            </button>
          </div>
        </div>
      `;

      const artistLink = document.getElementById('album-artist-link');
      if (artistLink && (artistId || artistName)) {
        artistLink.onclick = () => showArtistView(artistId || artistName, artistName);
      }

      const addLibBtn = document.getElementById('album-add-lib-btn');
      if (addLibBtn) {
        addLibBtn.onclick = () => {
          if (isAlbumInLibrary(albumId)) {
            removeAlbumFromLibrary(albumId);
            document.getElementById('album-lib-label').textContent = t('ctx_add_library');
          } else {
            addAlbumToLibrary({ id: albumId, name: attr.name, artistName, artUrl, releaseDate: attr.releaseDate });
            document.getElementById('album-lib-label').textContent = t('ctx_in_library');
          }
        };
      }

      // Extract tracks from parsed_tracks (fast) or relationships.tracks.data
      const relTracks = albumObj.relationships?.tracks?.data || [];
      const tracks = (data.parsed_tracks && data.parsed_tracks.length > 0)
        ? data.parsed_tracks.map(tItem => ({
          id: tItem.id,
          name: tItem.title || tItem.name,
          artistName: tItem.artist || tItem.artistName || artistName,
          trackNumber: tItem.track_number || tItem.trackNumber,
          durationInMillis: tItem.duration_ms || tItem.durationInMillis,
          is_explicit: tItem.is_explicit || false
        }))
        : relTracks.map(tItem => ({
          id: tItem.id,
          name: tItem.attributes?.name,
          artistName: tItem.attributes?.artistName || artistName,
          trackNumber: tItem.attributes?.trackNumber,
          durationInMillis: tItem.attributes?.durationInMillis,
          is_explicit: tItem.attributes?.contentRating === 'explicit'
        }));

      // Apply page-wide color scheming for Album
      applyPageThemeColor(artUrl, attr.artwork?.bgColor);

      // Render Tracks
      albumTracksGrid.innerHTML = tracks.map((tItem, idx) => `
        <div class="am-track-row animate-fade" data-id="${tItem.id}" data-index="${idx}">
           <div class="am-track-num">${tItem.trackNumber || idx + 1}</div>
           <div class="am-track-title">
             <span class="am-track-title-link" data-id="${tItem.id}" data-title="${escapeHTML(tItem.name || 'Song')}">${escapeHTML(tItem.name || 'Unknown')}</span>
             ${tItem.is_explicit ? '<span class="am-explicit-tag">E</span>' : ''}
           </div>
           <div class="am-track-duration">${formatDuration(tItem.durationInMillis)}</div>
           <button class="am-song-more-btn" data-id="${tItem.id}">•••</button>
        </div>
      `).join('');

      // Title link click: open song view (/song/songid)
      albumTracksGrid.querySelectorAll('.am-track-title-link').forEach(link => {
        link.onclick = (e) => {
          e.stopPropagation();
          const sId = link.dataset.id;
          const sTitle = link.dataset.title;
          showSongView(sId, sTitle);
        };
      });

      // Play album / preview button
      const playAlbumBtn = document.getElementById('album-play-btn');
      if (playAlbumBtn && tracks.length > 0) {
        playAlbumBtn.onclick = async () => {
          const first = tracks[0];
          const albumQueue = tracks.map(t => ({
            id: t.id,
            title: t.name,
            artist: t.artistName || artistName,
            album: attr.name,
            artUrl: artUrl,
            previewUrl: `${API_BASE}/stream?song=${t.id}&l=en-US`,
            durationMs: t.durationInMillis || 180000
          }));

          // 1. Play first track immediately with full album queue
          await loadRemoteTrack({
            trackId: first.id,
            trackName: first.name,
            artistName: first.artistName || artistName,
            collectionName: attr.name,
            albumId: albumId,
            artistId: artistId,
            artworkUrl100: artUrl,
            durationMs: first.durationInMillis
          }, albumQueue);

          // 2. Queue remaining tracks into IndexedDB in the background
          if (tracks.length > 1) {
            (async () => {
              try {
                const { addTrackToQueue } = await import('./router.js');
                for (let i = 1; i < tracks.length; i++) {
                  const tr = tracks[i];
                  await addTrackToQueue(null, {
                    name: tr.name,
                    artist: tr.artistName || artistName,
                    album: attr.name,
                    artUrl: artUrl,
                    type: 'audio/mp4',
                    ttml: '__AUTO_FETCH__',
                    amTrackId: tr.id
                  });
                }
              } catch (_) { }
            })();
          }
        };
      }

      // Track clicks: play full song like on homepage/search with full album queue
      albumTracksGrid.querySelectorAll('.am-track-row').forEach(row => {
        row.onclick = (e) => {
          if (e.target.closest('.am-track-title-link')) return;
          const id = row.dataset.id;
          const idx = parseInt(row.dataset.index, 10);
          const tItem = tracks[idx] || tracks.find(x => x.id === id);

          if (e.target.classList.contains('am-song-more-btn')) {
            e.stopPropagation();
            showContextMenu(e, {
              trackId: id,
              trackName: tItem?.name,
              artistName: tItem?.artistName || artistName,
              collectionName: attr.name,
              albumId: albumId,
              artistId: artistId,
              artworkUrl100: artUrl
            });
            return;
          }

          // Update URL to include ?i={trackId}
          syncUrl(`/album/${albumSlug}/${albumId}`, `i=${id}`);

          // Play full song directly with contextual album queue + similar songs
          queueContextualWithSimilar({
            trackId: id,
            trackName: tItem?.name,
            artistName: tItem?.artistName || artistName,
            collectionName: attr.name,
            albumId: albumId,
            artistId: artistId,
            artworkUrl100: artUrl,
            durationMs: tItem?.durationInMillis
          }, tracks.map(t => ({
            id: t.id,
            title: t.name,
            artist: t.artistName || artistName,
            album: attr.name,
            artUrl: artUrl,
            durationMs: t.durationInMillis || 180000
          })), idx);
        };
      });

      // If initial targetTrackId was requested via ?i=, start playing that track
      if (targetTrackId) {
        const foundTrack = tracks.find(t => String(t.id) === String(targetTrackId));
        if (foundTrack) {
          loadRemoteTrack({
            trackId: foundTrack.id,
            trackName: foundTrack.name,
            artistName: foundTrack.artistName || artistName,
            collectionName: attr.name,
            albumId: albumId,
            artistId: artistId,
            artworkUrl100: artUrl,
            durationMs: foundTrack.durationInMillis
          });
        }
      }

      // Footer info & Editorial Notes
      let footerContainer = document.getElementById('album-footer-info');
      if (!footerContainer) {
        footerContainer = document.createElement('div');
        footerContainer.id = 'album-footer-info';
        footerContainer.className = 'am-album-footer-info';
        albumTracksGrid.after(footerContainer);
      }

      const totalMs = tracks.reduce((acc, tItem) => acc + (tItem.durationInMillis || 0), 0);
      const editorialReview = attr.editorialNotes?.standard || attr.editorialNotes?.short || '';

      // Extract record label ID / name from relationship or attributes
      const recordLabelObj = albumObj.relationships?.['record-labels']?.data?.[0] || data.record_label || {};
      const recordLabelId = recordLabelObj.id || null;
      const recordLabelName = recordLabelObj.attributes?.name || recordLabelObj.name || attr.recordLabel || '';
      const copyrightText = attr.copyright || (recordLabelName ? `℗ ${recordLabelName}` : '℗ All Rights Reserved');

      footerContainer.innerHTML = `
        ${editorialReview ? `
          <div class="am-album-editorial-card" style="margin-bottom: 24px; padding: 18px 20px; border-radius: 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);">
            <div style="font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #ffffff; margin-bottom: 8px;">${t('editors_notes')}</div>
            <div style="font-size: 0.92rem; line-height: 1.6; color: #d1d1d6;">${escapeHTML(editorialReview.replace(/<[^>]*>/g, ''))}</div>
          </div>
        ` : ''}
        <div style="font-weight: 500;">${year}</div>
        <div>${t('lib_songs_count', { count: tracks.length })}, ${formatDuration(totalMs)}</div>
        <div style="margin-top: 4px; opacity: 0.85;">
          ${escapeHTML(copyrightText)}
          ${recordLabelName && recordLabelId ? ` • <a href="javascript:void(0)" id="album-record-label-link" data-id="${recordLabelId}" style="color: #fa586a; text-decoration: none; font-weight: 600;">${escapeHTML(recordLabelName)}</a>` : (recordLabelName ? ` • <span>${escapeHTML(recordLabelName)}</span>` : '')}
        </div>
      `;

      const rlLink = document.getElementById('album-record-label-link');
      if (rlLink && recordLabelId) {
        rlLink.onclick = (e) => {
          e.preventDefault();
          showRecordLabelView(recordLabelId, recordLabelName);
        };
      }

      // Header Preview Button — Plays 30s previews of the album in the mini player
      const playBtn = document.getElementById('album-play-btn');
      if (playBtn && tracks.length > 0) {
        playBtn.onclick = () => {
          previewPlayer.playAlbum(data, 0);
        };
      }

      // "More by {artistName}" Row in random order
      let moreBySection = document.getElementById('album-more-by-section');
      if (!moreBySection) {
        moreBySection = document.createElement('div');
        moreBySection.id = 'album-more-by-section';
        moreBySection.className = 'am-search-section';
        moreBySection.style.marginTop = '36px';
        moreBySection.style.marginBottom = '40px';
        footerContainer.after(moreBySection);
      }

      moreBySection.innerHTML = `
        <h3 class="am-search-section-title">${t('album_more_by', { artist: escapeHTML(artistName) })}</h3>
        <div class="am-cards-horizontal-scroll" id="album-more-by-grid">
          <div class="am-loading-msg">${t('loading')}</div>
        </div>
      `;

      // Fetch other albums by artist and randomize
      fetchArtistOtherAlbums(artistId, artistName, albumId);

    } catch (err) {
      console.error(err);
      albumHeader.innerHTML = `<div class="am-error-msg">${t('error')}: ${err.message}</div>`;
    }
  }

  async function fetchArtistOtherAlbums(artistId, artistName, currentAlbumId) {
    const moreGrid = document.getElementById('album-more-by-grid');
    if (!moreGrid) return;

    try {
      let otherAlbums = [];
      if (artistId && /^\d+$/.test(String(artistId))) {
        try {
          const res = await fetch(`${API_BASE}/artist/albums?artist=${artistId}&limit=25&l=${getCurrentLang()}`);
          if (res.ok) {
            const data = await res.json();
            otherAlbums = data.data || [];
          }
        } catch (e) { }
      }

      if (otherAlbums.length === 0 && artistName) {
        // Fallback to search query for artist name
        try {
          const sRes = await fetch(`${API_BASE}/search?term=${encodeURIComponent(artistName)}&types=albums&limit=25&l=${getCurrentLang()}`);
          if (sRes.ok) {
            const sData = await sRes.json();
            otherAlbums = sData.results?.albums?.data || [];
          }
        } catch (e) { }
      }

      if (otherAlbums.length === 0 && artistId && /^\d+$/.test(String(artistId))) {
        try {
          const lRes = await fetch(`${API_BASE}/itunes/lookup?id=${artistId}&entity=album&limit=25`);
          if (lRes.ok) {
            const lData = await lRes.json();
            const results = lData.results || [];
            otherAlbums = results.filter(r => r.wrapperType === 'collection').map(c => ({
              id: String(c.collectionId),
              type: 'albums',
              attributes: {
                name: c.collectionName,
                artistName: c.artistName,
                releaseDate: c.releaseDate,
                artwork: { url: c.artworkUrl100 }
              }
            }));
          }
        } catch (e) { }
      }

      // Filter out current album and randomize
      const filtered = otherAlbums.filter(a => String(a.id) !== String(currentAlbumId));
      const randomized = filtered.sort(() => 0.5 - Math.random()).slice(0, 15);

      if (randomized.length === 0) {
        moreGrid.innerHTML = `<p class="am-empty-msg">${t('empty_other_albums')}</p>`;
        return;
      }

      moreGrid.innerHTML = randomized.map(alb => {
        const attr = alb.attributes || alb || {};
        const art = cleanArtworkUrl(attr.artwork?.url || attr.artworkUrl100, 300, 300);
        const y = attr.releaseDate ? new Date(attr.releaseDate).getFullYear() : '';
        return `
          <div class="am-standard-media-card animate-fade" data-id="${alb.id}">
            <img src="${art}" loading="lazy" referrerpolicy="no-referrer" class="am-media-card-art" onerror="this.src='favicon.svg'">
            <div class="am-media-card-title">${escapeHTML(attr.name || attr.collectionName || '')}</div>
            <div class="am-media-card-sub">${escapeHTML(y || t('badge_album'))}</div>
          </div>
        `;
      }).join('');

      moreGrid.querySelectorAll('.am-standard-media-card').forEach(card => {
        card.onclick = () => {
          const title = card.querySelector('.am-media-card-title')?.textContent || '';
          showAlbumView(card.dataset.id, title);
        };
      });

    } catch (e) {
      moreGrid.innerHTML = `<p class="am-empty-msg">${t('empty_other_albums')}</p>`;
    }
  }

  // ── Artist View with Apple Music Catalog Compound Request, Dynamic Hero (Video vs Centered Avatar) & Shelves ──
  async function openArtistView(artistId, artistName) {
    if (searchBarWrapper) searchBarWrapper.classList.add('hidden');
    if (artistViewContainer) artistViewContainer.classList.remove('hidden');
    if (albumViewContainer) albumViewContainer.classList.add('hidden');
    if (playlistViewContainer) playlistViewContainer.classList.add('hidden');
    if (songViewContainer) songViewContainer.classList.add('hidden');
    if (listenInitialContent) listenInitialContent.classList.add('hidden');
    if (searchResultsContainer) searchResultsContainer.classList.add('hidden');

    artistViewContent.innerHTML = `<div class="am-loading-msg">${t('loading_artist_profile')}</div>`;

    try {
      let attr = {};
      let albums = [];
      let songs = [];
      let resolvedArtistId = artistId;

      const isNumericId = /^\d+$/.test(String(artistId || '').trim());

      // If artistId is not numeric (or missing), search for artist to get proper artist ID & artwork
      if (!isNumericId && (artistName || artistId)) {
        const query = artistName || artistId;
        try {
          const sRes = await fetch(`${API_BASE}/search?term=${encodeURIComponent(query)}&types=artists&limit=5&l=${getCurrentLang()}`);
          if (sRes.ok) {
            const sData = await sRes.json();
            const foundArt = sData.results?.artists?.data?.[0] || sData.results?.top?.data?.find(x => x.type === 'artists');
            if (foundArt) {
              resolvedArtistId = foundArt.id;
              if (foundArt.attributes) attr = { ...foundArt.attributes };
            }
          }
        } catch (e) { }
      }

      let artistViews = {};
      let artistRels = {};
      let rawResources = {};
      let canvasShelvesCollections = {};

      // 1. Fetch using Apple Music Catalog API compound endpoint
      if (resolvedArtistId && /^\d+$/.test(String(resolvedArtistId))) {
        const langCode = getCurrentLang() === 'ru' ? 'ru' : 'en-GB';
        const catalogUrl = `${API_BASE}/v1/catalog/kz/artists/${resolvedArtistId}?art[url]=c,f&extend=artistBio,editorialArtwork,editorialVideo,extendedAssetUrls,hasBiographyContent,hero,keyColor,plainEditorialNotes,seoDescription,seoTitle&extend[canvas-shelves-header]=badge&extend[concerts]=tickets&filter[canvas-shelves-collection.contents.type]=albums,apple-curators,artists,concerts,music-movies,music-videos,playlists,songs,stations,uploaded-videos,venues&format[resources]=map&include=canvas,default-playable-content&include[canvas-shelves-collection]=contents&include[canvas-shelves-group]=children&include[concerts]=artists,venues&include[songs]=albums&l=${langCode}&limit[canvas-shelves-collection:contents]=12&limit[canvas-shelves-collection:contents{displayStyle}]=artist-featured-track-lockup:24&omit[resource]=autos&platform=web&relate[canvas-shelves-collection]=see-all`;

        try {
          const catRes = await fetch(catalogUrl);
          if (catRes.ok) {
            const catData = await catRes.json();
            rawResources = catData.resources || {};
            const artObj = rawResources.artists?.[String(resolvedArtistId)] ||
              (catData.data && catData.data[0] ? rawResources.artists?.[catData.data[0].id] : null);
            if (artObj?.attributes) {
              attr = { ...attr, ...artObj.attributes };
            }
            if (artObj?.relationships) {
              artistRels = { ...artObj.relationships };
            }

            // Normalise songs and albums from resources
            if (rawResources.songs) {
              songs = Object.values(rawResources.songs);
            }
            if (rawResources.albums) {
              albums = Object.values(rawResources.albums);
            }
            if (rawResources['canvas-shelves-collection']) {
              canvasShelvesCollections = rawResources['canvas-shelves-collection'];
            }
          }
        } catch (e) {
          console.warn("[Artist Fetch] Catalog compound endpoint error:", e);
        }

        // Secondary fallback to standard artist endpoint if still needed
        if (!attr.name || (songs.length === 0 && albums.length === 0)) {
          try {
            const artistApiUrl = `${API_BASE}/artist?id=${resolvedArtistId}&storefront=us&l=en-US&include=albums,music-videos,playlists,station&views=top-songs,full-albums,singles-eps,featured-playlists,latest-release,appears-on-albums,similar-artists&extend=editorialArtwork,editorialVideo,editorialNotes`;
            const res = await fetch(artistApiUrl);
            if (res.ok) {
              const data = await res.json();
              const found = Array.isArray(data.data) ? data.data[0] : (data.data || data);
              if (found?.attributes) attr = { ...attr, ...found.attributes };
              artistViews = found?.views || data.views || {};
              if (!artistRels.albums) artistRels = found?.relationships || data.relationships || {};
              if (songs.length === 0 && artistViews['top-songs']?.data?.length > 0) {
                songs = artistViews['top-songs'].data;
              }
              if (albums.length === 0) {
                if (artistViews['full-albums']?.data?.length > 0) albums = artistViews['full-albums'].data;
                else if (artistRels.albums?.data?.length > 0) albums = artistRels.albums.data;
              }
            }
          } catch (e) { }
        }
      }

      const displayName = attr.name || artistName || (isNumericId ? '' : artistId) || 'Artist';

      if (resolvedArtistId) {
        syncUrl(`/artist/${toSlug(displayName)}/${resolvedArtistId}`, '', true);
      }

      // If artwork is missing, search by artist name to retrieve artwork
      if (!attr.artwork?.url && displayName) {
        try {
          const sRes = await fetch(`${API_BASE}/search?term=${encodeURIComponent(displayName)}&types=artists&limit=5&l=${getCurrentLang()}`);
          if (sRes.ok) {
            const sData = await sRes.json();
            const foundArt = sData.results?.artists?.data?.[0] || sData.results?.top?.data?.find(x => x.type === 'artists');
            if (foundArt?.attributes?.artwork) {
              attr.artwork = foundArt.attributes.artwork;
              if (!resolvedArtistId) resolvedArtistId = foundArt.id;
            }
          }
        } catch (e) { }
      }

      // Supplementary Discography fetch to guarantee all albums are retrieved (up to 100)
      if (resolvedArtistId && /^\d+$/.test(String(resolvedArtistId))) {
        try {
          const dRes = await fetch(`${API_BASE}/artist/albums?artist=${resolvedArtistId}&limit=100&l=en-US`);
          if (dRes.ok) {
            const dData = await dRes.json();
            const fetchedAlbs = dData?.data || dData?.results?.albums?.data || [];
            if (fetchedAlbs.length > 0) {
              albums = [...albums, ...fetchedAlbs];
            }
          }
        } catch (e) { }
      }

      // Determine hero video & motion assets
      const edVideo = attr.editorialVideo || {};
      const heroVideoObj = edVideo.motionArtistFullscreen16x9 || edVideo.motionArtistWide16x9 || edVideo.motionArtistSquare1x1 || null;
      const heroVideoUrl = heroVideoObj?.video || null;
      const heroVideoPreview = heroVideoObj?.previewFrame?.url || null;

      // Determine logo trimmed image
      const logoArtwork = attr.editorialArtwork?.musicContentColorLogoTrimmed || null;
      const logoUrl = logoArtwork ? cleanLogoUrl(logoArtwork.url, 400, 133) : null;

      // Determine artist photo (portrait / identity)
      let heroContentArtwork = null;
      if (Array.isArray(attr.hero)) {
        for (const h of attr.hero) {
          if (Array.isArray(h?.content)) {
            const cArt = h.content[0]?.artwork?.url;
            if (cArt) { heroContentArtwork = cArt; break; }
          }
        }
      }

      let rawArtistPhoto = heroVideoPreview ||
        attr.artwork?.url ||
        heroContentArtwork ||
        attr.editorialArtwork?.storeFlowcase?.url ||
        attr.editorialArtwork?.bannerUber?.url ||
        attr.editorialArtwork?.header?.url;

      if (!rawArtistPhoto && albums.length > 0) {
        rawArtistPhoto = albums[0]?.attributes?.artwork?.url;
      }
      if (!rawArtistPhoto && songs.length > 0) {
        rawArtistPhoto = songs[0]?.attributes?.artwork?.url;
      }
      const artistPhoto = rawArtistPhoto ? cleanArtworkUrl(rawArtistPhoto, 1200, 1200) : '';

      // Dominant / Accent Color
      const rawHexColor = attr.keyColor || attr.artwork?.bgColor || '1b1917';
      const tintColor = rawHexColor.startsWith('#') ? rawHexColor : `#${rawHexColor}`;

      // Resolve releases into Albums vs Singles/EPs
      const allReleasesMap = new Map();
      const addRelease = (item) => {
        if (!item || !item.id) return;
        const idStr = String(item.id);
        if (!allReleasesMap.has(idStr)) {
          allReleasesMap.set(idStr, item);
        }
      };

      // Extract from canvas-shelves-collection if available
      let shelfAlbums = [];
      let shelfSingles = [];
      let shelfEssentials = [];
      let shelfLive = [];
      let shelfTopSongs = [];
      let shelfSimilar = [];
      let shelfPlaylists = [];
      let shelfVideos = [];
      let shelfPosts = [];
      let shelfMoreToSee = [];
      let shelfConcerts = [];
      let shelfLatestRelease = null;

      Object.values(canvasShelvesCollections).forEach(shelf => {
        const kind = (shelf.attributes?.kind || '').toUpperCase();
        const shelfId = shelf.id || '';
        const title = (shelf.attributes?.title || '').toLowerCase();
        const cData = shelf.relationships?.contents?.data || [];
        const resolvedItems = cData.map(d => rawResources[d.type]?.[d.id] || d).filter(Boolean);

        if (kind === 'TOP_SONGS' || shelfId.includes('TopSongs')) {
          shelfTopSongs = resolvedItems;
        } else if (kind === 'ALBUMS' || shelfId.includes('Albums')) {
          shelfAlbums = resolvedItems;
        } else if (shelfId.includes('ArtistSingles') || title.includes('singles')) {
          shelfSingles = resolvedItems;
        } else if (kind === 'ESSENTIALS' || shelfId.includes('Essentials')) {
          shelfEssentials = resolvedItems;
        } else if (shelfId.includes('LiveAlbums')) {
          shelfLive = resolvedItems;
        } else if (kind === 'SIMILAR_ARTISTS' || shelfId.includes('SimilarArtists')) {
          shelfSimilar = resolvedItems;
        } else if (kind === 'ARTIST_PLAYLISTS' || shelfId.includes('ArtistPlaylists')) {
          shelfPlaylists = resolvedItems;
        } else if (kind === 'MUSIC_VIDEOS' || shelfId.includes('MusicVideos')) {
          shelfVideos = resolvedItems;
        } else if (kind === 'POSTS' || kind === 'SOCIAL_POSTS' || shelfId.includes('Posts') || title.includes('posts')) {
          shelfPosts = resolvedItems;
        } else if (kind === 'MORE_TO_SEE' || kind === 'MORE_TO_HEAR' || shelfId.includes('MoreToSee') || shelfId.includes('MoreToHear') || title.includes('more to see') || title.includes('more to hear')) {
          shelfMoreToSee = resolvedItems;
        } else if (kind === 'CONCERTS' || shelfId.includes('Concerts') || shelfId.includes('TourDates')) {
          shelfConcerts = resolvedItems;
        } else if (shelfId.includes('LatestReleaseFallback') || shelfId.includes('LatestRelease')) {
          shelfLatestRelease = resolvedItems[0] || null;
        }
      });


      // Upcoming dynamic concerts
      const rawConcertsList = (shelfConcerts.length > 0 ? shelfConcerts : (Object.values(rawResources.concerts || {}) || artistViews['upcoming-concerts']?.data || artistViews.concerts?.data || [])).filter(c => c && (c.attributes || c.name));
      const hasConcerts = rawConcertsList.length > 0;

      if (shelfTopSongs.length > 0) songs = shelfTopSongs;
      if (shelfAlbums.length > 0) shelfAlbums.forEach(addRelease);
      if (shelfSingles.length > 0) shelfSingles.forEach(addRelease);
      (artistViews['full-albums']?.data || []).forEach(addRelease);
      (artistViews['singles-eps']?.data || []).forEach(addRelease);
      (artistRels.albums?.data || []).forEach(addRelease);
      (albums || []).forEach(addRelease);

      const fullAlbums = [];
      const singles = [];
      const compilations = [];
      const appearedOn = [];

      allReleasesMap.forEach(alb => {
        const aAttr = alb.attributes || alb || {};
        const name = (aAttr.name || aAttr.collectionName || '').toLowerCase();
        const artist = (aAttr.artistName || '').toLowerCase();
        const dispArtist = (displayName || '').toLowerCase();
        const trackCount = aAttr.trackCount || 0;
        const isCompilation = aAttr.isCompilation === true ||
          aAttr.isComplete === false ||
          name.includes('compilation') ||
          name.includes('greatest hits') ||
          name.includes('best of') ||
          artist.includes('various artists');
        const isAppeared = artist && dispArtist && !artist.includes(dispArtist) && !dispArtist.includes(artist);

        const isSingle = aAttr.isSingle === true ||
          (trackCount > 0 && trackCount <= 3) ||
          name.includes(' - single') ||
          name.includes(' - ep') ||
          name.includes(' (single)') ||
          name.includes(' (ep)') ||
          name.endsWith(' single') ||
          name.endsWith(' ep');

        if (isAppeared) appearedOn.push(alb);
        else if (isCompilation) compilations.push(alb);
        else if (isSingle) singles.push(alb);
        else fullAlbums.push(alb);
      });

      fullAlbums.sort((a, b) => new Date(b.attributes?.releaseDate || b.releaseDate || 0) - new Date(a.attributes?.releaseDate || a.releaseDate || 0));
      singles.sort((a, b) => new Date(b.attributes?.releaseDate || b.releaseDate || 0) - new Date(a.attributes?.releaseDate || a.releaseDate || 0));
      compilations.sort((a, b) => new Date(b.attributes?.releaseDate || b.releaseDate || 0) - new Date(a.attributes?.releaseDate || a.releaseDate || 0));
      appearedOn.sort((a, b) => new Date(b.attributes?.releaseDate || b.releaseDate || 0) - new Date(a.attributes?.releaseDate || a.releaseDate || 0));

      // Extra collections
      const artistPlaylists = shelfPlaylists.length > 0 ? shelfPlaylists : (artistViews['featured-playlists']?.data || artistRels.playlists?.data || []);
      const artistMusicVideos = shelfVideos.length > 0 ? shelfVideos : (artistRels['music-videos']?.data || (rawResources['music-videos'] ? Object.values(rawResources['music-videos']) : []));
      const artistStation = artistRels.station?.data?.[0] || (rawResources.stations ? Object.values(rawResources.stations)[0] : null);
      const similarArtists = shelfSimilar.length > 0 ? shelfSimilar : (artistViews['similar-artists']?.data || []);

      const inLib = isArtistInLibrary(resolvedArtistId || displayName);

      const bioRaw = attr.artistBio || attr.editorialNotes?.standard || attr.editorialNotes?.short || '';
      const bioText = bioRaw
        ? escapeHTML(bioRaw.replace(/<[^>]*>/g, '')).replace(/&lt;br\s*\/?&gt;/gi, '<br>').replace(/&amp;nbsp;/g, ' ').replace(/\n/g, '<br>')
        : "";

      const genre = attr.genreNames?.[0] || 'Music';

      // Pinned / Latest Release Object
      const latestReleaseObj = shelfLatestRelease ||
        (artistViews?.['latest-release']?.data?.[0]) ||
        (attr.views?.['latest-release']?.data?.[0]) ||
        singles[0] ||
        fullAlbums[0] ||
        null;

      let latestReleaseHTML = '';
      if (latestReleaseObj) {
        const lrAttr = latestReleaseObj.attributes || latestReleaseObj;
        const lrArt = cleanArtworkUrl(lrAttr.artwork?.url || lrAttr.artworkUrl100, 240, 240);
        const lrDate = lrAttr.releaseDate ? formatLocalizedDate(lrAttr.releaseDate) : '';
        const lrTitle = lrAttr.name || lrAttr.collectionName || 'Latest Release';
        const lrCount = lrAttr.trackCount ? (lrAttr.trackCount === 1 ? '1 song' : `${lrAttr.trackCount} songs`) : 'Single';
        const lrInLib = isAlbumInLibrary(latestReleaseObj.id);

        latestReleaseHTML = `
          <div class="am-artist-latest-card" data-id="${latestReleaseObj.id}">
            <img src="${lrArt}" class="am-artist-latest-art" onerror="this.src='favicon.svg'" alt="">
            <div class="am-artist-latest-info">
              <div class="am-artist-latest-date">${escapeHTML(lrDate)}</div>
              <div class="am-artist-latest-title">${escapeHTML(lrTitle)}</div>
              <div class="am-artist-latest-count">${escapeHTML(lrCount)}</div>
            </div>
            <button class="am-artist-latest-add-btn" data-id="${latestReleaseObj.id}" title="Add to Library">
              ${lrInLib ? '✓' : '+'}
            </button>
          </div>
        `;
      }

      // Top 24 Songs
      const top24Songs = songs.slice(0, 24);
      const topSongsCardsHTML = top24Songs.map((s, i) => {
        const sAttr = s.attributes || s || {};
        const sArt = cleanArtworkUrl(sAttr.artwork?.url || sAttr.artworkUrl100, 120, 120);
        const releaseYear = sAttr.releaseDate ? new Date(sAttr.releaseDate).getFullYear() : '';
        const albumSub = sAttr.albumName || sAttr.collectionName || '';
        const subLine = [albumSub, releaseYear].filter(Boolean).join(' • ');

        return `
          <div class="am-artist-song-card animate-fade" data-id="${s.id}" data-idx="${i}">
            <img src="${sArt}" loading="lazy" referrerpolicy="no-referrer" class="am-artist-song-art" onerror="this.src='favicon.svg'">
            <div class="am-artist-song-info">
              <div class="am-artist-song-title">${escapeHTML(sAttr.name || sAttr.trackName || '')}</div>
              <div class="am-artist-song-artist">${escapeHTML(subLine || displayName)}</div>
            </div>
            <button class="am-song-more-btn" data-id="${s.id}" data-idx="${i}">•••</button>
          </div>
        `;
      }).join('') || `<p class="am-empty-msg">${t('empty_artist_songs')}</p>`;

      const renderAlbumItem = (alb, typeOverride = null) => {
        const aAttr = alb.attributes || alb || {};
        const art = cleanArtworkUrl(aAttr.artwork?.url || aAttr.artworkUrl100, 300, 300);
        const y = aAttr.releaseDate ? new Date(aAttr.releaseDate).getFullYear() : '';
        const albName = aAttr.name || aAttr.collectionName || '';
        const artist = aAttr.artistName || '';
        const isComp = typeOverride === 'compilation' || aAttr.isCompilation === true || albName.toLowerCase().includes('compilation');
        const isApp = typeOverride === 'appearedOn';

        let badgeTag = '';
        if (isComp) {
          badgeTag = `<div class="am-media-badge-tag" style="background: rgba(250, 88, 106, 0.9); color: #fff;">Compilation</div>`;
        } else if (isApp) {
          badgeTag = `<div class="am-media-badge-tag" style="background: rgba(255, 255, 255, 0.85); color: #000;">Appeared On</div>`;
        }

        const subText = isApp ? (artist || displayName) : (isComp ? 'Compilation' : (y || t('badge_album')));

        return `
          <div class="am-standard-media-card animate-fade" data-id="${alb.id}">
            ${badgeTag}
            <img src="${art}" loading="lazy" referrerpolicy="no-referrer" class="am-media-card-art" onerror="this.src='favicon.svg'">
            <div class="am-media-card-title">${escapeHTML(albName)}</div>
            <div class="am-media-card-sub">${escapeHTML(subText)}</div>
          </div>
        `;
      };

      const renderPlaylistItem = (pl) => {
        const pAttr = pl.attributes || pl || {};
        const art = cleanArtworkUrl(pAttr.artwork?.url, 300, 300);
        return `
          <div class="am-standard-media-card am-playlist-card animate-fade" data-id="${pl.id}">
            <img src="${art}" loading="lazy" referrerpolicy="no-referrer" class="am-media-card-art" onerror="this.src='favicon.svg'">
            <div class="am-media-card-title">${escapeHTML(pAttr.name || '')}</div>
            <div class="am-media-card-sub">${escapeHTML(pAttr.curatorName || 'Playlist')}</div>
          </div>
        `;
      };

      const renderVideoItem = (vid) => {
        const vAttr = vid.attributes || vid || {};
        const art = cleanArtworkUrl(vAttr.artwork?.url, 480, 270);
        return `
          <div class="am-standard-media-card am-video-card-item animate-fade" data-id="${vid.id}">
            <img src="${art}" loading="lazy" referrerpolicy="no-referrer" class="am-media-card-art" style="aspect-ratio: 16/9; object-fit: cover;" onerror="this.src='favicon.svg'">
            <div class="am-media-card-title">${escapeHTML(vAttr.name || '')}</div>
            <div class="am-media-card-sub">${escapeHTML(vAttr.artistName || displayName)}</div>
          </div>
        `;
      };

      const renderArtistItem = (artItem) => {
        const artAttr = artItem.attributes || artItem || {};
        const artImg = cleanArtworkUrl(artAttr.artwork?.url, 300, 300);
        return `
          <div class="am-standard-media-card am-artist-card-item animate-fade" data-id="${artItem.id}" style="text-align: center;">
            <img src="${artImg}" loading="lazy" referrerpolicy="no-referrer" class="am-media-card-art" style="border-radius: 50%; aspect-ratio: 1/1; object-fit: cover;" onerror="this.src='favicon.svg'">
            <div class="am-media-card-title" style="margin-top: 8px;">${escapeHTML(artAttr.name || '')}</div>
            <div class="am-media-card-sub">${escapeHTML(artAttr.genreNames?.[0] || t('badge_artist'))}</div>
          </div>
        `;
      };

      const renderPostItem = (post) => {
        const pAttr = post.attributes || post || {};
        const art = cleanArtworkUrl(pAttr.artwork?.url || artistPhoto, 480, 480);
        const text = pAttr.body || pAttr.caption || pAttr.name || 'Artist Post';
        const dateStr = pAttr.date || pAttr.postedDate || '';
        return `
          <div class="am-standard-media-card am-post-card-item animate-fade" data-id="${post.id}" data-url="${pAttr.url || ''}">
            <img src="${art}" loading="lazy" referrerpolicy="no-referrer" class="am-media-card-art" style="aspect-ratio: 1/1; object-fit: cover; border-radius: 12px;" onerror="this.src='favicon.svg'">
            <div class="am-media-card-title" style="font-size: 0.88rem; line-height: 1.3; margin-top: 8px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${escapeHTML(text)}</div>
            <div class="am-media-card-sub">${dateStr ? escapeHTML(formatLocalizedDate(dateStr)) : displayName}</div>
          </div>
        `;
      };

      const albumsCount = fullAlbums.length;
      const showAlbumsViewAllChevron = albumsCount > 7;

      const albumsShelfHTML = fullAlbums.slice(0, 14).map(a => renderAlbumItem(a)).join('');
      const allAlbumsGridHTML = fullAlbums.map(a => renderAlbumItem(a)).join('');
      const singlesHTML = singles.map(s => renderAlbumItem(s)).join('');
      const compilationsHTML = compilations.map(c => renderAlbumItem(c, 'compilation')).join('');
      const appearedOnHTML = appearedOn.map(a => renderAlbumItem(a, 'appearedOn')).join('');
      const essentialsHTML = shelfEssentials.map(e => renderAlbumItem(e)).join('') || '';
      const playlistsHTML = artistPlaylists.map(renderPlaylistItem).join('') || '';
      const videosHTML = artistMusicVideos.map(renderVideoItem).join('') || '';
      const postsHTML = shelfPosts.map(renderPostItem).join('') || '';
      const moreToSeeHTML = shelfMoreToSee.map(renderVideoItem).join('') || '';
      const similarArtistsHTML = similarArtists.map(renderArtistItem).join('') || '';


      const stationHTML = artistStation ? `
        <div class="am-artist-station-card animate-fade" data-id="${artistStation.id}" style="display: flex; align-items: center; gap: 16px; padding: 14px 18px; border-radius: 14px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); cursor: pointer; transition: background 0.2s;">
          <img src="${cleanArtworkUrl(artistStation.attributes?.artwork?.url || artistPhoto, 120, 120)}" style="width: 56px; height: 56px; border-radius: 10px; object-fit: cover;" onerror="this.src='favicon.svg'">
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 0.72rem; font-weight: 700; text-transform: uppercase; color: #fa586a; letter-spacing: 0.04em;">Artist Radio</div>
            <div style="font-size: 1.05rem; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(artistStation.attributes?.name || `${displayName} Radio`)}</div>
          </div>
          <div style="width: 38px; height: 38px; border-radius: 50%; background: #fa586a; display: flex; align-items: center; justify-content: center; color: #fff; flex-shrink: 0;">
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z"/></svg>
          </div>
        </div>
      ` : '';

      // Construct Hero Markup
      const hasHeroVideo = Boolean(heroVideoUrl);
      const identityHTML = logoUrl
        ? `<img src="${logoUrl}" class="am-artist-logo-img" alt="${escapeHTML(displayName)}">`
        : `<h1 class="am-artist-pc-hero-title">${escapeHTML(displayName)}</h1>`;

      // Top navigation overlay for mobile (Back, Share, More)
      const mobileTopNavMarkup = `
        <div class="am-artist-mobile-nav-bar">
          <button class="am-artist-mob-nav-btn back-btn" id="artist-mob-back-btn" title="Back" aria-label="Back">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
          <div class="am-artist-mob-nav-right">
            <button class="am-artist-mob-nav-btn share-btn" id="artist-mob-share-btn" title="Share" aria-label="Share">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg>
            </button>
            <button class="am-artist-mob-nav-btn more-btn" id="artist-mob-more-btn" title="More" aria-label="More">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="12" r="2"/></svg>
            </button>
          </div>
        </div>
      `;

      let heroMarkup = '';
      if (hasHeroVideo) {
        // Taylor Swift style: Full-width video banner with identity & action buttons
        heroMarkup = `
          <div class="am-artist-pc-hero-wrap" id="am-artist-pc-hero" style="--am-artist-tint: ${tintColor};">
            ${mobileTopNavMarkup}
            <div class="am-artist-pc-hero-video-banner">
              <video src="${heroVideoUrl}" autoplay loop muted playsinline poster="${cleanArtworkUrl(heroVideoPreview || artistPhoto, 1800, 900)}"></video>
              <div class="am-artist-pc-hero-gradient-overlay"></div>
              <div class="am-artist-hero-identity">
                ${identityHTML}
                <div class="am-artist-hero-actions">
                  <button class="am-artist-icon-round-btn" id="artist-open-info-btn" title="${t('artist_about_title')}" aria-label="${t('artist_about_title')}">
                    <span>i</span>
                  </button>
                  <button class="am-artist-hero-play-btn" id="artist-play-top-btn" title="${t('artist_play_top')}" aria-label="${t('ctx_play')}">
                    <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                  </button>
                  <button class="am-artist-icon-round-btn ${inLib ? 'favorited' : ''}" id="artist-add-lib-btn" title="${inLib ? t('ctx_in_library') : t('ctx_favorite')}" aria-label="${t('ctx_favorite')}">
                    <svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        `;
      } else {
        // Full portrait editorial image banner on mobile, centered avatar on desktop
        heroMarkup = `
          <div class="am-artist-pc-hero-wrap" id="am-artist-pc-hero" style="--am-artist-tint: ${tintColor};">
            ${mobileTopNavMarkup}
            <div class="am-artist-mobile-portrait-banner">
              <img src="${cleanArtworkUrl(artistPhoto, 1200, 1400)}" class="am-artist-mobile-portrait-img" onerror="this.src='favicon.svg'" alt="${escapeHTML(displayName)}">
              <div class="am-artist-mobile-portrait-gradient"></div>
              <div class="am-artist-mobile-portrait-identity">
                ${identityHTML}
                <div class="am-artist-hero-actions">
                  <button class="am-artist-icon-round-btn" id="artist-open-info-btn" title="${t('artist_about_title')}" aria-label="${t('artist_about_title')}">
                    <span>i</span>
                  </button>
                  <button class="am-artist-hero-play-btn" id="artist-play-top-btn" title="${t('artist_play_top')}" aria-label="${t('ctx_play')}">
                    <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                  </button>
                  <button class="am-artist-icon-round-btn ${inLib ? 'favorited' : ''}" id="artist-add-lib-btn" title="${inLib ? t('ctx_in_library') : t('ctx_favorite')}" aria-label="${t('ctx_favorite')}">
                    <svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                  </button>
                </div>
              </div>
            </div>
            <div class="am-artist-pc-hero-centered">
              ${artistPhoto ? `
                <div class="am-artist-hero-backdrop-blur" style="background-image: url('${artistPhoto}');"></div>
                <div class="am-artist-hero-backdrop-gradient"></div>
              ` : ''}
              <div class="am-artist-circle-avatar-wrap">
                <img src="${cleanArtworkUrl(artistPhoto, 500, 500)}" class="am-artist-circle-avatar-img" onerror="this.src='favicon.svg'" alt="${escapeHTML(displayName)}">
              </div>
              ${hasConcerts ? `
                <div class="am-artist-hero-badge">
                  <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z"/></svg>
                  <span>${t('artist_upcoming_concerts')}</span>
                </div>
              ` : ''}
              <div class="am-artist-hero-identity">
                ${identityHTML}
              </div>
              <div class="am-artist-hero-actions">
                <button class="am-artist-icon-round-btn" id="artist-open-info-btn-desktop" title="${t('artist_about_title')}" aria-label="${t('artist_about_title')}">
                  <span>i</span>
                </button>
                <button class="am-artist-hero-play-btn" id="artist-play-top-btn-desktop" title="${t('artist_play_top')}" aria-label="${t('ctx_play')}">
                  <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                </button>
                <button class="am-artist-icon-round-btn ${inLib ? 'favorited' : ''}" id="artist-add-lib-btn-desktop" title="${inLib ? t('ctx_in_library') : t('ctx_favorite')}" aria-label="${t('ctx_favorite')}">
                  <svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                </button>
              </div>
            </div>
          </div>
        `;
      }

      // Sticky bar when scrolled
      const stickyBarMarkup = `
        <div class="am-artist-sticky-bar" id="am-artist-sticky-bar">
          <div class="am-artist-sticky-left">
            <img src="${cleanArtworkUrl(artistPhoto, 120, 120)}" class="am-artist-sticky-avatar" onerror="this.src='favicon.svg'">
            <h2 class="am-artist-sticky-title">${escapeHTML(displayName)}</h2>
          </div>
          <div class="am-artist-sticky-right">
            <button class="am-artist-icon-round-btn" id="artist-sticky-play-btn" style="width: 36px; height: 36px;" title="Play">
              <svg viewBox="0 0 24 24" style="width: 14px; height: 14px; fill: #fff; margin-left: 2px;"><path d="M8 5v14l11-7z"/></svg>
            </button>
          </div>
        </div>
      `;

      // Dynamic Concert Cards HTML
      const concertsCardsHTML = rawConcertsList.map(cnc => {
        const cAttr = cnc.attributes || cnc;
        const venue = cAttr.venueName || cAttr.city || cAttr.location || '';
        const name = cAttr.name || cAttr.title || `${displayName} Live`;
        const dateStr = cAttr.start || cAttr.date || '';
        let monthStr = 'LIVE';
        let dayStr = '';
        if (dateStr) {
          try {
            const d = new Date(dateStr);
            monthStr = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
            dayStr = d.getDate();
          } catch (_) {}
        }
        const concertUrl = cAttr.url || cAttr.ticketUrl || cAttr.eventUrl || (cAttr.externalUrls?.ticketmaster) || (cAttr.externalUrls?.bandsintown) || '';
        return `
          <div class="am-standard-media-card am-concert-card animate-fade" data-url="${escapeHTML(concertUrl)}" style="min-width: 220px; max-width: 260px; padding: 16px; border-radius: 14px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); cursor: pointer; transition: transform 0.2s ease, background 0.2s ease;">
            <div style="display: flex; gap: 14px; align-items: center; margin-bottom: 10px;">
              <div style="width: 48px; height: 48px; border-radius: 10px; background: rgba(250,88,106,0.15); color: #fa586a; display: flex; flex-direction: column; align-items: center; justify-content: center; font-weight: 800; line-height: 1.1;">
                <span style="font-size: 0.65rem;">${escapeHTML(monthStr)}</span>
                <span style="font-size: 1.15rem;">${escapeHTML(String(dayStr))}</span>
              </div>
              <div style="flex: 1; min-width: 0;">
                <div style="font-size: 0.92rem; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(venue || displayName)}</div>
                <div style="font-size: 0.78rem; color: rgba(255,255,255,0.6);">${escapeHTML(cAttr.city || 'Tour Date')}</div>
              </div>
            </div>
            <div style="font-size: 0.82rem; color: rgba(255,255,255,0.8); line-height: 1.3; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">${escapeHTML(name)}</div>
          </div>
        `;
      }).join('');

      // Full Layout Assembly
      artistViewContent.innerHTML = `
        ${artistPhoto ? `
          <div class="am-artist-ambient-canvas-blur" style="background-image: url('${artistPhoto}');"></div>
          <div class="am-artist-ambient-canvas-gradient"></div>
        ` : ''}
        ${stickyBarMarkup}
        ${heroMarkup}

        <div class="am-artist-canvas-body" style="padding: 0 4px; margin-top: 12px; position: relative; z-index: 2;">
          <!-- Dual Grid: Latest Release / Pinned Release fallback paired with Top Songs -->
          <div style="display: flex; gap: 28px; flex-wrap: wrap; align-items: flex-start; margin-top: 24px;">
            ${latestReleaseHTML ? `
              <div style="flex: 1; min-width: 280px; max-width: 360px;">
                <h3 class="am-search-section-title" style="margin-bottom: 12px;">${(t('artist_latest_release') !== 'artist_latest_release' && t('artist_latest_release')) || 'Latest Release'}</h3>
                ${latestReleaseHTML}
              </div>
            ` : ''}

            <div style="flex: 2; min-width: 320px; position: relative;">
              <div class="am-section-header-row" style="margin-bottom: 12px;">
                <h3 class="am-search-section-title" style="margin-bottom: 0;">${(t('artist_top_songs') !== 'artist_top_songs' && t('artist_top_songs')) || 'Top Songs'}</h3>
                <div class="am-shelf-nav-arrows">
                  <button class="am-shelf-arrow-btn prev" data-target="#artist-top-songs-scroll" title="Scroll Left">‹</button>
                  <button class="am-shelf-arrow-btn next" data-target="#artist-top-songs-scroll" title="Scroll Right">›</button>
                </div>
              </div>
              <div class="am-artist-top-songs-grid" id="artist-top-songs-scroll">${topSongsCardsHTML}</div>
            </div>
          </div>

          ${essentialsHTML ? `
            <!-- Essential Albums Shelf (Directly under Top Songs / Latest Release) -->
            <div class="am-search-section" style="margin-top: 38px;">
              <div class="am-section-header-row">
                <h3 class="am-search-section-title">${t('artist_essentials')}</h3>
                <div class="am-shelf-nav-arrows">
                  <button class="am-shelf-arrow-btn prev" data-target="#artist-essentials-scroll" title="Scroll Left">‹</button>
                  <button class="am-shelf-arrow-btn next" data-target="#artist-essentials-scroll" title="Scroll Right">›</button>
                </div>
              </div>
              <div class="am-cards-horizontal-scroll" id="artist-essentials-scroll">${essentialsHTML}</div>
            </div>
          ` : ''}

          ${hasConcerts ? `
            <!-- Dynamic Upcoming Concerts Shelf -->
            <div class="am-search-section" style="margin-top: 38px;">
              <div class="am-section-header-row">
                <h3 class="am-search-section-title">${t('artist_upcoming_concerts')}</h3>
                <div class="am-shelf-nav-arrows">
                  <button class="am-shelf-arrow-btn prev" data-target="#artist-concerts-scroll" title="Scroll Left">‹</button>
                  <button class="am-shelf-arrow-btn next" data-target="#artist-concerts-scroll" title="Scroll Right">›</button>
                </div>
              </div>
              <div class="am-cards-horizontal-scroll" id="artist-concerts-scroll">${concertsCardsHTML}</div>
            </div>
          ` : ''}

          <!-- Albums Shelf (only rendered if artist has albums) -->
          ${albumsShelfHTML ? `
            <div class="am-search-section" style="margin-top: 38px;">
              <div class="am-section-header-row">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <h3 class="am-search-section-title">${t('artist_albums')}</h3>
                  ${showAlbumsViewAllChevron ? `
                    <button class="am-shelf-header-chevron-btn" id="artist-toggle-all-albums-btn" title="View All Albums">
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </button>
                  ` : ''}
                </div>
                <div class="am-shelf-nav-arrows">
                  <button class="am-shelf-arrow-btn prev" data-target="#artist-albums-scroll" title="Scroll Left">‹</button>
                  <button class="am-shelf-arrow-btn next" data-target="#artist-albums-scroll" title="Scroll Right">›</button>
                </div>
              </div>
              <div class="am-cards-horizontal-scroll" id="artist-albums-scroll">${albumsShelfHTML}</div>
              <div class="am-home-media-grid hidden" id="artist-all-albums-grid" style="margin-top: 14px;">${allAlbumsGridHTML}</div>
            </div>
          ` : ''}

          <!-- Singles & EPs Shelf (only rendered if artist has singles) -->
          ${singlesHTML ? `
            <div class="am-search-section" style="margin-top: 38px;">
              <div class="am-section-header-row">
                <h3 class="am-search-section-title">${t('artist_singles')}</h3>
                <div class="am-shelf-nav-arrows">
                  <button class="am-shelf-arrow-btn prev" data-target="#artist-singles-scroll" title="Scroll Left">‹</button>
                  <button class="am-shelf-arrow-btn next" data-target="#artist-singles-scroll" title="Scroll Right">›</button>
                </div>
              </div>
              <div class="am-cards-horizontal-scroll" id="artist-singles-scroll">${singlesHTML}</div>
            </div>
          ` : ''}

          <!-- Compilations Shelf -->
          ${compilationsHTML ? `
            <div class="am-search-section" style="margin-top: 38px;">
              <div class="am-section-header-row">
                <h3 class="am-search-section-title">${t('artist_compilations')}</h3>
                <div class="am-shelf-nav-arrows">
                  <button class="am-shelf-arrow-btn prev" data-target="#artist-compilations-scroll" title="Scroll Left">‹</button>
                  <button class="am-shelf-arrow-btn next" data-target="#artist-compilations-scroll" title="Scroll Right">›</button>
                </div>
              </div>
              <div class="am-cards-horizontal-scroll" id="artist-compilations-scroll">${compilationsHTML}</div>
            </div>
          ` : ''}

          <!-- Appears On Shelf -->
          ${appearedOnHTML ? `
            <div class="am-search-section" style="margin-top: 38px;">
              <div class="am-section-header-row">
                <h3 class="am-search-section-title">${t('artist_appeared_on')}</h3>
                <div class="am-shelf-nav-arrows">
                  <button class="am-shelf-arrow-btn prev" data-target="#artist-appeared-scroll" title="Scroll Left">‹</button>
                  <button class="am-shelf-arrow-btn next" data-target="#artist-appeared-scroll" title="Scroll Right">›</button>
                </div>
              </div>
              <div class="am-cards-horizontal-scroll" id="artist-appeared-scroll">${appearedOnHTML}</div>
            </div>
          ` : ''}

          ${playlistsHTML ? `
            <!-- Curated Artist Playlists Shelf -->
            <div class="am-search-section" style="margin-top: 38px;">
              <div class="am-section-header-row">
                <h3 class="am-search-section-title">${t('artist_playlists')}</h3>
                <div class="am-shelf-nav-arrows">
                  <button class="am-shelf-arrow-btn prev" data-target="#artist-playlists-scroll" title="Scroll Left">‹</button>
                  <button class="am-shelf-arrow-btn next" data-target="#artist-playlists-scroll" title="Scroll Right">›</button>
                </div>
              </div>
              <div class="am-cards-horizontal-scroll" id="artist-playlists-scroll">${playlistsHTML}</div>
            </div>
          ` : ''}

          ${videosHTML ? `
            <!-- Music Videos Shelf -->
            <div class="am-search-section" style="margin-top: 38px;">
              <div class="am-section-header-row">
                <h3 class="am-search-section-title">${t('artist_videos')}</h3>
                <div class="am-shelf-nav-arrows">
                  <button class="am-shelf-arrow-btn prev" data-target="#artist-videos-scroll" title="Scroll Left">‹</button>
                  <button class="am-shelf-arrow-btn next" data-target="#artist-videos-scroll" title="Scroll Right">›</button>
                </div>
              </div>
              <div class="am-cards-horizontal-scroll" id="artist-videos-scroll">${videosHTML}</div>
            </div>
          ` : ''}

          ${postsHTML ? `
            <!-- Artist Posts Shelf -->
            <div class="am-search-section" style="margin-top: 38px;">
              <div class="am-section-header-row">
                <h3 class="am-search-section-title">${(t('artist_posts') !== 'artist_posts' && t('artist_posts')) || 'Posts'}</h3>
                <div class="am-shelf-nav-arrows">
                  <button class="am-shelf-arrow-btn prev" data-target="#artist-posts-scroll" title="Scroll Left">‹</button>
                  <button class="am-shelf-arrow-btn next" data-target="#artist-posts-scroll" title="Scroll Right">›</button>
                </div>
              </div>
              <div class="am-cards-horizontal-scroll" id="artist-posts-scroll">${postsHTML}</div>
            </div>
          ` : ''}

          ${moreToSeeHTML ? `
            <!-- More to See / Hear Shelf -->
            <div class="am-search-section" style="margin-top: 38px;">
              <div class="am-section-header-row">
                <h3 class="am-search-section-title">${(t('artist_more_to_see') !== 'artist_more_to_see' && t('artist_more_to_see')) || 'More to See'}</h3>
                <div class="am-shelf-nav-arrows">
                  <button class="am-shelf-arrow-btn prev" data-target="#artist-more-scroll" title="Scroll Left">‹</button>
                  <button class="am-shelf-arrow-btn next" data-target="#artist-more-scroll" title="Scroll Right">›</button>
                </div>
              </div>
              <div class="am-cards-horizontal-scroll" id="artist-more-scroll">${moreToSeeHTML}</div>
            </div>
          ` : ''}

          ${stationHTML ? `
            <!-- Artist Radio Station -->
            <div class="am-search-section" style="margin-top: 38px; max-width: 440px;">
              <h3 class="am-search-section-title" style="margin-bottom: 12px;">${t('artist_station')}</h3>
              ${stationHTML}
            </div>
          ` : ''}

          ${similarArtistsHTML ? `
            <!-- Similar Artists Shelf -->
            <div class="am-search-section" style="margin-top: 38px; margin-bottom: 50px;">
              <div class="am-section-header-row">
                <h3 class="am-search-section-title">${t('artist_similar')}</h3>
                <div class="am-shelf-nav-arrows">
                  <button class="am-shelf-arrow-btn prev" data-target="#artist-similar-scroll" title="Scroll Left">‹</button>
                  <button class="am-shelf-arrow-btn next" data-target="#artist-similar-scroll" title="Scroll Right">›</button>
                </div>
              </div>
              <div class="am-cards-horizontal-scroll" id="artist-similar-scroll">${similarArtistsHTML}</div>
            </div>
          ` : ''}
        </div>
      `;

      // ── Progressive Scroll Blur & Fade Dynamics ──
      const heroElem = artistViewContent.querySelector('#am-artist-pc-hero');
      const stickyBar = artistViewContent.querySelector('#am-artist-sticky-bar');

      const handleArtistScroll = () => {
        const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
        if (heroElem) {
          const heroHeight = heroElem.offsetHeight || 400;
          const progress = Math.min(Math.max(scrollY / (heroHeight * 0.8), 0), 1);
          // Progressive upward blur + fade-out
          heroElem.style.opacity = String(1 - (progress * 0.85));
          heroElem.style.filter = `blur(${progress * 16}px)`;
          heroElem.style.transform = `translateY(${progress * -20}px)`;

          if (stickyBar) {
            if (scrollY > heroHeight * 0.7) {
              stickyBar.classList.add('visible');
            } else {
              stickyBar.classList.remove('visible');
            }
          }
        }
      };

      window.removeEventListener('scroll', window.__waveArtistScrollHandler);
      window.__waveArtistScrollHandler = handleArtistScroll;
      window.addEventListener('scroll', handleArtistScroll, { passive: true });

      // ── Apple Music (i) About Artist Sheet Modal ──
      const openAboutModal = () => {
        let sheet = document.getElementById('am-about-artist-sheet');
        if (!sheet) {
          sheet = document.createElement('div');
          sheet.id = 'am-about-artist-sheet';
          sheet.className = 'am-about-sheet-backdrop';
          document.body.appendChild(sheet);
        }

        const bioParagraphs = bioText
          ? bioText.split('<br><br>').map(p => `<p>${p}</p>`).join('')
          : `<p>${t('empty_artist_bio') || 'No editorial biography available for this artist.'}</p>`;

        sheet.innerHTML = `
          <div class="am-about-sheet-card">
            <button class="am-about-sheet-close-btn" id="close-about-sheet-btn" aria-label="${t('profile_close')}">✕</button>
            <div class="am-about-sheet-scrollable">
              <div class="am-about-sheet-hero-art">
                <img src="${cleanArtworkUrl(artistPhoto, 900, 900)}" class="am-about-sheet-hero-img" onerror="this.src='favicon.svg'" alt="">
                <div class="am-about-sheet-hero-gradient"></div>
              </div>
              <div class="am-about-sheet-body">
                <h2 class="am-about-sheet-artist-name">${escapeHTML(displayName)}</h2>

                <div class="am-about-sheet-meta-block">
                  <div class="am-about-sheet-meta-label">${t('artist_genre')}</div>
                  <div class="am-about-sheet-genre-pill">${escapeHTML(genre)}</div>
                </div>

                <div class="am-about-sheet-bio-section">
                  <h3 class="am-about-sheet-bio-title">${t('artist_about')}</h3>
                  <div class="am-about-sheet-bio-text">
                    ${bioParagraphs}
                  </div>
                </div>
              </div>
            </div>
          </div>
        `;

        sheet.classList.remove('hidden');
        sheet.style.display = 'flex';

        const closeBtn = sheet.querySelector('#close-about-sheet-btn');
        if (closeBtn) {
          closeBtn.onclick = () => {
            sheet.classList.add('hidden');
            sheet.style.display = 'none';
          };
        }
        sheet.onclick = (e) => {
          if (e.target === sheet) {
            sheet.classList.add('hidden');
            sheet.style.display = 'none';
          }
        };
      };

      // Wire hero video playback (HLS stream support)
      if (hasHeroVideo && heroVideoUrl) {
        const heroVideoEl = artistViewContent.querySelector('.am-artist-pc-hero-video-banner video');
        if (heroVideoEl) {
          playHlsStream(heroVideoEl, heroVideoUrl, { autoplay: true, isMuted: true, loop: true });
        }
      }

      // Wire Mobile Navigation Buttons (Back, Share, More)
      const mobBackBtn = artistViewContent.querySelector('#artist-mob-back-btn');
      if (mobBackBtn) {
        mobBackBtn.onclick = (e) => {
          e.stopPropagation();
          if (window.history.length > 1) {
            window.history.back();
          } else {
            switchPage('listen');
          }
        };
      }

      const mobShareBtn = artistViewContent.querySelector('#artist-mob-share-btn');
      if (mobShareBtn) {
        mobShareBtn.onclick = (e) => {
          e.stopPropagation();
          shareEntity('artist', resolvedArtistId || displayName, displayName);
        };
      }

      const mobMoreBtn = artistViewContent.querySelector('#artist-mob-more-btn');
      if (mobMoreBtn) {
        mobMoreBtn.onclick = (e) => {
          e.stopPropagation();
          openAboutModal();
        };
      }

      // Wire (i) Info buttons (both mobile and desktop)
      artistViewContent.querySelectorAll('#artist-open-info-btn, #artist-open-info-btn-desktop').forEach(btn => {
        btn.onclick = openAboutModal;
      });

      // Wire Favorite / Library button (both mobile and desktop)
      const handleFavToggle = () => {
        const inNow = isArtistInLibrary(resolvedArtistId || displayName);
        if (inNow) {
          removeArtistFromLibrary(resolvedArtistId || displayName);
          artistViewContent.querySelectorAll('#artist-add-lib-btn, #artist-add-lib-btn-desktop').forEach(b => b.classList.remove('favorited'));
          showToast({ message: t('ctx_removed_from_lib') });
        } else {
          addArtistToLibrary({ id: resolvedArtistId || displayName, name: displayName, artUrl: artistPhoto, genre });
          artistViewContent.querySelectorAll('#artist-add-lib-btn, #artist-add-lib-btn-desktop').forEach(b => b.classList.add('favorited'));
          showToast({ message: t('ctx_added_to_lib') });
        }
      };

      artistViewContent.querySelectorAll('#artist-add-lib-btn, #artist-add-lib-btn-desktop').forEach(btn => {
        btn.onclick = handleFavToggle;
      });

      // Wire Albums View All Chevron (Toggle Grid vs Horizontal Scroll)
      const toggleAllAlbumsBtn = artistViewContent.querySelector('#artist-toggle-all-albums-btn');
      const albumsScrollEl = artistViewContent.querySelector('#artist-albums-scroll');
      const allAlbumsGridEl = artistViewContent.querySelector('#artist-all-albums-grid');
      if (toggleAllAlbumsBtn && albumsScrollEl && allAlbumsGridEl) {
        toggleAllAlbumsBtn.onclick = (e) => {
          e.stopPropagation();
          const isGridVisible = !allAlbumsGridEl.classList.contains('hidden');
          if (isGridVisible) {
            allAlbumsGridEl.classList.add('hidden');
            albumsScrollEl.classList.remove('hidden');
            toggleAllAlbumsBtn.style.transform = 'rotate(0deg)';
          } else {
            allAlbumsGridEl.classList.remove('hidden');
            albumsScrollEl.classList.add('hidden');
            toggleAllAlbumsBtn.style.transform = 'rotate(90deg)';
          }
        };
      }

      // Wire Shelf Horizontal Nav Arrows
      artistViewContent.querySelectorAll('.am-shelf-arrow-btn').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const targetSelector = btn.getAttribute('data-target');
          if (!targetSelector) return;
          const container = artistViewContent.querySelector(targetSelector);
          if (!container) return;
          const isPrev = btn.classList.contains('prev');
          const scrollDistance = container.clientWidth * 0.75;
          container.scrollBy({
            left: isPrev ? -scrollDistance : scrollDistance,
            behavior: 'smooth'
          });
        };
      });

      // Helper: build artist top songs queue
      const createArtistTopSongsQueue = (startIdx) => {
        const after = top24Songs.slice(startIdx);
        const before = top24Songs.slice(0, startIdx);
        return [...after, ...before].map(s => {
          const sAttr = s.attributes || s || {};
          const albumId = s?.relationships?.albums?.data?.[0]?.id || sAttr.url?.match(/\/album\/[^/]+\/(\d+)/)?.[1] || null;
          return {
            id: s.id,
            title: sAttr.name || sAttr.trackName,
            artist: sAttr.artistName || displayName,
            album: sAttr.albumName || sAttr.collectionName || 'Top Song',
            artUrl: cleanArtworkUrl(sAttr.artwork?.url || sAttr.artworkUrl100, 300, 300),
            previewUrl: `${API_BASE}/stream?song=${s.id}&l=en-US`,
            durationMs: sAttr.durationInMillis || 180000
          };
        });
      };

      // Wire Play Top Songs Buttons (mobile, desktop, and sticky)
      const handlePlayTopSongs = (e) => {
        if (e) e.stopPropagation();
        if (top24Songs.length === 0) return;
        const firstSong = top24Songs[0];
        const sAttr = firstSong.attributes || firstSong || {};
        const albumId = firstSong?.relationships?.albums?.data?.[0]?.id || sAttr.url?.match(/\/album\/[^/]+\/(\d+)/)?.[1] || null;
        const topQueue = createArtistTopSongsQueue(0);
        loadRemoteTrack({
          trackId: firstSong.id,
          trackName: sAttr.name || sAttr.trackName,
          artistName: sAttr.artistName || displayName,
          collectionName: sAttr.albumName || sAttr.collectionName,
          albumId: albumId,
          artistId: resolvedArtistId || artistId,
          artworkUrl100: cleanArtworkUrl(sAttr.artwork?.url || sAttr.artworkUrl100, 100, 100)
        }, topQueue);
      };

      artistViewContent.querySelectorAll('#artist-play-top-btn, #artist-play-top-btn-desktop, #artist-sticky-play-btn').forEach(btn => {
        btn.onclick = handlePlayTopSongs;
      });

      // Latest release card click
      artistViewContent.querySelectorAll('.am-artist-latest-card').forEach(card => {
        card.onclick = (e) => {
          if (e.target.closest('.am-artist-latest-add-btn')) return;
          showAlbumView(card.dataset.id);
        };
      });

      // Latest release add button
      artistViewContent.querySelectorAll('.am-artist-latest-add-btn').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const albId = btn.dataset.id;
          if (isAlbumInLibrary(albId)) {
            removeAlbumFromLibrary(albId);
            btn.textContent = '+';
            showToast({ message: t('ctx_removed_from_lib') });
          } else {
            addAlbumToLibrary({ id: albId, name: latestReleaseObj?.attributes?.name, artUrl: cleanArtworkUrl(latestReleaseObj?.attributes?.artwork?.url, 300, 300) });
            btn.textContent = '✓';
            showToast({ message: t('ctx_added_to_lib') });
          }
        };
      });

      // Albums, Singles, and Appears-On card clicks
      artistViewContent.querySelectorAll('.am-standard-media-card:not(.am-playlist-card):not(.am-artist-card-item):not(.am-video-card-item):not(.am-concert-card)').forEach(card => {
        card.onclick = () => {
          const title = card.querySelector('.am-media-card-title')?.textContent || '';
          showAlbumView(card.dataset.id, title);
        };
      });

      // Upcoming Concerts card click (Open in new tab)
      artistViewContent.querySelectorAll('.am-concert-card').forEach(card => {
        card.onclick = (e) => {
          e.stopPropagation();
          const url = card.dataset.url;
          if (url && url.startsWith('http')) {
            window.open(url, '_blank', 'noopener,noreferrer');
          } else {
            const venue = card.querySelector('.am-media-card-title')?.textContent || '';
            const query = encodeURIComponent(`${displayName} ${venue} concert tickets`);
            window.open(`https://www.google.com/search?q=${query}`, '_blank', 'noopener,noreferrer');
          }
        };
      });

      // Playlists card click
      artistViewContent.querySelectorAll('.am-playlist-card').forEach(card => {
        card.onclick = () => {
          const title = card.querySelector('.am-media-card-title')?.textContent || '';
          showRemotePlaylistView(card.dataset.id, title);
        };
      });

      // Music Videos and More to See card click
      artistViewContent.querySelectorAll('.am-video-card-item').forEach(card => {
        card.onclick = () => {
          const title = card.querySelector('.am-media-card-title')?.textContent || '';
          const artist = card.querySelector('.am-media-card-sub')?.textContent || displayName;
          playMusicVideo(card.dataset.id, title, artist);
        };
      });

      // Artist Posts card click (Play video or open post media)
      artistViewContent.querySelectorAll('.am-post-card-item').forEach(card => {
        card.onclick = () => {
          const title = card.querySelector('.am-media-card-title')?.textContent || 'Artist Post';
          const postUrl = card.dataset.url || '';
          const postId = card.dataset.id || '';
          // If the post has a direct URL or video id, play via music video player modal
          playMusicVideo(postId || postUrl, title, displayName, { customUrl: postUrl });
        };
      });

      // Station card click
      artistViewContent.querySelectorAll('.am-artist-station-card').forEach(card => {
        card.onclick = () => {
          if (top24Songs.length > 0) {
            const sAttr = top24Songs[0].attributes || top24Songs[0] || {};
            const albumId = top24Songs[0]?.relationships?.albums?.data?.[0]?.id || sAttr.url?.match(/\/album\/[^/]+\/(\d+)/)?.[1] || null;
            const topQueue = createArtistTopSongsQueue(0);
            loadRemoteTrack({
              trackId: top24Songs[0].id,
              trackName: sAttr.name || sAttr.trackName,
              artistName: sAttr.artistName || displayName,
              collectionName: sAttr.albumName || sAttr.collectionName,
              albumId: albumId,
              artistId: resolvedArtistId || artistId,
              artworkUrl100: cleanArtworkUrl(sAttr.artwork?.url || sAttr.artworkUrl100, 100, 100)
            }, topQueue);
          }
        };
      });

      // Similar Artists card click
      artistViewContent.querySelectorAll('.am-artist-card-item').forEach(card => {
        card.onclick = () => {
          const title = card.querySelector('.am-media-card-title')?.textContent || '';
          showArtistView(card.dataset.id, title);
        };
      });

      // Top songs card click & context menu
      artistViewContent.querySelectorAll('.am-artist-song-card').forEach(card => {
        card.onclick = (e) => {
          const idx = parseInt(card.dataset.idx, 10);
          const song = top24Songs[idx];
          const sAttr = song?.attributes || song || {};
          const albumId = song?.relationships?.albums?.data?.[0]?.id || sAttr.url?.match(/\/album\/[^/]+\/(\d+)/)?.[1] || null;

          if (e.target.classList.contains('am-song-more-btn')) {
            e.stopPropagation();
            showContextMenu(e, {
              trackId: song.id,
              trackName: sAttr.name || sAttr.trackName,
              artistName: sAttr.artistName || displayName,
              collectionName: sAttr.albumName || sAttr.collectionName,
              albumId: albumId,
              artistId: resolvedArtistId || artistId,
              artworkUrl100: cleanArtworkUrl(sAttr.artwork?.url || sAttr.artworkUrl100, 100, 100)
            });
            return;
          }

          queueContextualWithSimilar({
            trackId: song.id,
            trackName: sAttr.name || sAttr.trackName,
            artistName: sAttr.artistName || displayName,
            collectionName: sAttr.albumName || sAttr.collectionName,
            albumId: albumId,
            artistId: resolvedArtistId || artistId,
            artworkUrl100: cleanArtworkUrl(sAttr.artwork?.url || sAttr.artworkUrl100, 100, 100),
            durationMs: sAttr.durationInMillis
          }, top24Songs.map(s => {
            const a = s.attributes || s || {};
            return {
              id: s.id,
              title: a.name || a.trackName,
              artist: a.artistName || displayName,
              album: a.albumName || a.collectionName || 'Top Song',
              artUrl: cleanArtworkUrl(a.artwork?.url || a.artworkUrl100, 300, 300),
              durationMs: a.durationInMillis || 180000
            };
          }), idx);
        };
      });

    } catch (err) {
      console.error(err);
      artistViewContent.innerHTML = `<div class="am-error-msg">${t('error')}: ${err.message}</div>`;
    }
  }

  // ── Record Label Detail View ──
  async function showRecordLabelView(labelId, labelName, options = {}) {
    if (listenInitialContent) listenInitialContent.classList.add('hidden');
    if (searchResultsContainer) searchResultsContainer.classList.add('hidden');
    if (albumViewContainer) albumViewContainer.classList.add('hidden');
    if (artistViewContainer) artistViewContainer.classList.add('hidden');
    if (songViewContainer) songViewContainer.classList.add('hidden');
    if (playlistViewContainer) playlistViewContainer.classList.remove('hidden');

    const displayName = labelName || 'Record Label';
    playlistViewContent.innerHTML = `<div class="am-loading-msg">${t('loading')}</div>`;

    if (!options.skipUrlSync) {
      syncUrl(`/label/${toSlug(displayName)}/${labelId}`, '', options.replaceUrl);
    }

    try {
      let latestReleases = [];
      let topReleases = [];
      let labelBio = '';
      let labelArtwork = '';

      // Query official Apple Music record-labels endpoint
      let resolvedLabelName = labelName;
      if (labelId) {
        try {
          const res = await fetch(`${API_BASE}/record-labels/${labelId}?views=latest-releases,top-releases&l=${getCurrentLang()}`);
          if (res.ok) {
            const data = await res.json();
            const rlObj = data.data?.[0] || data;
            const attr = rlObj.attributes || {};
            if (attr.name) resolvedLabelName = attr.name;
            const artUrl = attr.editorialArtwork?.bannerUber?.url || attr.artwork?.url;
            labelArtwork = cleanArtworkUrl(artUrl, 2048, 1080);
            labelBio = (attr.editorialNotes?.standard || attr.editorialNotes?.short || '').replace(/<[^>]*>/g, '');

            const views = rlObj.views || {};
            const rels = rlObj.relationships || {};

            latestReleases = views['latest-releases']?.data || rels['latest-releases']?.data || [];
            topReleases = views['top-releases']?.data || rels['top-releases']?.data || [];
          }
        } catch (e) {
          console.error('[RecordLabelView] Failed to fetch label:', e);
        }
      }

      const finalDisplayName = resolvedLabelName || displayName;
      if (resolvedLabelName && resolvedLabelName !== labelName) {
        syncUrl(`/label/${toSlug(finalDisplayName)}/${labelId}`, '', true);
      }

      const renderAlbumCard = (alb) => {
        const attr = alb.attributes || alb || {};
        const art = cleanArtworkUrl(attr.artwork?.url || attr.artworkUrl100, 300, 300);
        return `
          <div class="am-standard-media-card animate-fade" data-id="${alb.id}" style="cursor: pointer;">
            <img src="${art}" loading="lazy" referrerpolicy="no-referrer" class="am-media-card-art" onerror="this.src='favicon.svg'">
            <div class="am-media-card-title">${escapeHTML(attr.name || attr.collectionName || 'Album')}</div>
            <div class="am-media-card-sub">${escapeHTML(attr.artistName || '')}</div>
          </div>
        `;
      };

      const formatReleaseDate = (dateStr) => {
        if (!dateStr) return '';
        try {
          const d = new Date(dateStr);
          return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase();
        } catch (_) {
          return dateStr.toUpperCase();
        }
      };

      const renderLatestReleaseItem = (alb) => {
        const attr = alb.attributes || alb || {};
        const art = cleanArtworkUrl(attr.artwork?.url || attr.artworkUrl100, 160, 160);
        const formattedDate = formatReleaseDate(attr.releaseDate);
        return `
          <div class="am-label-latest-item" data-id="${alb.id}" style="display: flex; align-items: center; gap: 14px; padding: 10px; border-radius: 10px; cursor: pointer; transition: background 0.2s ease; background: rgba(255, 255, 255, 0.03);">
            <img src="${art}" loading="lazy" referrerpolicy="no-referrer" style="width: 54px; height: 54px; border-radius: 8px; object-fit: cover; flex-shrink: 0;" onerror="this.src='favicon.svg'">
            <div style="flex: 1; min-width: 0;">
              ${formattedDate ? `<div style="font-size: 0.68rem; font-weight: 700; color: rgba(255, 255, 255, 0.45); letter-spacing: 0.04em; text-transform: uppercase; margin-bottom: 3px;">${formattedDate}</div>` : ''}
              <div style="font-size: 0.92rem; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px;">${escapeHTML(attr.name || attr.collectionName || '')}</div>
              <div style="font-size: 0.8rem; color: rgba(255, 255, 255, 0.55); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(attr.artistName || '')}</div>
            </div>
            <button class="am-label-more-btn" data-id="${alb.id}" style="background: none; border: none; color: #fa586a; font-size: 1.1rem; cursor: pointer; padding: 6px 10px; border-radius: 50%;">•••</button>
          </div>
        `;
      };

      let sectionsHTML = '';

      if (topReleases.length > 0) {
        sectionsHTML += `
          <div class="am-search-section" style="margin-top: 28px; margin-bottom: 36px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
              <h3 class="am-search-section-title" style="margin: 0; font-size: 1.35rem; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 4px;">
                Top Releases <span style="font-size: 1.1rem; color: rgba(255, 255, 255, 0.4); font-weight: 400;">›</span>
              </h3>
            </div>
            <div class="am-cards-horizontal-scroll" style="display: flex; gap: 18px; overflow-x: auto; padding-bottom: 10px;">
              ${topReleases.map(renderAlbumCard).join('')}
            </div>
          </div>
        `;
      }

      if (latestReleases.length > 0) {
        sectionsHTML += `
          <div class="am-search-section" style="margin-top: 28px; margin-bottom: 40px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
              <h3 class="am-search-section-title" style="margin: 0; font-size: 1.35rem; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 4px;">
                Latest Releases <span style="font-size: 1.1rem; color: rgba(255, 255, 255, 0.4); font-weight: 400;">›</span>
              </h3>
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px;">
              ${latestReleases.map(renderLatestReleaseItem).join('')}
            </div>
          </div>
        `;
      }

      if (!latestReleases.length && !topReleases.length) {
        sectionsHTML = `<p class="am-empty-msg" style="margin-top: 24px;">No official releases found for this record label.</p>`;
      }

      const bannerHTML = labelArtwork
        ? `<div style="width: 100%; height: 260px; max-height: 32vw; min-height: 180px; border-radius: 14px; overflow: hidden; background: #000 url('${labelArtwork}') center center / cover no-repeat; margin-bottom: 24px; box-shadow: 0 8px 30px rgba(0,0,0,0.5);"></div>`
        : ``;

      playlistViewContent.innerHTML = `
        ${bannerHTML}

        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
          <h1 style="font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; margin: 0; color: #fff; letter-spacing: -0.02em;">
            ${escapeHTML(finalDisplayName)}
          </h1>
          <button style="width: 36px; height: 36px; border-radius: 50%; background: rgba(255, 255, 255, 0.08); border: none; color: #fa586a; font-size: 1.1rem; display: flex; align-items: center; justify-content: center; cursor: pointer;">
            •••
          </button>
        </div>

        ${labelBio ? `
          <div class="am-album-editorial-card" style="margin: 16px 0 28px 0; padding: 18px 20px; border-radius: 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);">
            <div style="font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #ffffff; margin-bottom: 8px;">About ${escapeHTML(finalDisplayName)}</div>
            <div style="font-size: 0.92rem; line-height: 1.6; color: #d1d1d6;">${escapeHTML(labelBio)}</div>
          </div>
        ` : ''}

        ${sectionsHTML}
      `;

      playlistViewContent.querySelectorAll('.am-standard-media-card, .am-label-latest-item').forEach(card => {
        card.onclick = (e) => {
          if (e.target.closest('.am-label-more-btn')) return;
          const title = card.querySelector('.am-media-card-title')?.textContent || '';
          showAlbumView(card.dataset.id, title);
        };
      });

    } catch (err) {
      console.error(err);
      playlistViewContent.innerHTML = `<div class="am-error-msg">${t('error')}: ${err.message}</div>`;
    }
  }

  // ── Curator Detail View ──
  async function showCuratorView(curatorId, curatorName, options = {}) {
    if (listenInitialContent) listenInitialContent.classList.add('hidden');
    if (searchResultsContainer) searchResultsContainer.classList.add('hidden');
    if (albumViewContainer) albumViewContainer.classList.add('hidden');
    if (artistViewContainer) artistViewContainer.classList.add('hidden');
    if (songViewContainer) songViewContainer.classList.add('hidden');
    if (playlistViewContainer) playlistViewContainer.classList.remove('hidden');

    const displayName = curatorName || 'Curator';
    playlistViewContent.innerHTML = `<div class="am-loading-msg">${t('loading')}</div>`;

    if (!options.skipUrlSync) {
      syncUrl(`/curator/${toSlug(displayName)}/${curatorId}`, '', options.replaceUrl);
    }

    try {
      let playlists = [];
      let curatorBio = '';
      let curatorArtwork = '';

      if (curatorId) {
        try {
          const res = await fetch(`${API_BASE}/curators/${curatorId}?include=playlists&l=${getCurrentLang()}`);
          if (res.ok) {
            const data = await res.json();
            const curObj = data.data?.[0] || data;
            const attr = curObj.attributes || {};
            curatorArtwork = cleanArtworkUrl(attr.artwork?.url, 600, 600);
            curatorBio = (attr.editorialNotes?.standard || attr.editorialNotes?.short || '').replace(/<[^>]*>/g, '');
            playlists = curObj.relationships?.playlists?.data || [];
          }
        } catch (e) { }
      }

      if (playlists.length === 0 && (curatorName || curatorId)) {
        const query = curatorName || curatorId;
        try {
          const sRes = await fetch(`${API_BASE}/search?term=${encodeURIComponent(query)}&types=playlists&limit=25&l=${getCurrentLang()}`);
          if (sRes.ok) {
            const sData = await sRes.json();
            playlists = sData.results?.playlists?.data || [];
          }
        } catch (e) { }
      }

      const playlistsHTML = playlists.map(pl => {
        const attr = pl.attributes || pl || {};
        const art = cleanArtworkUrl(attr.artwork?.url || attr.artworkUrl100, 300, 300);
        return `
          <div class="am-standard-media-card animate-fade" data-id="${pl.id}">
            <img src="${art}" loading="lazy" referrerpolicy="no-referrer" class="am-media-card-art" onerror="this.src='favicon.svg'">
            <div class="am-media-card-title">${escapeHTML(attr.name || 'Playlist')}</div>
            <div class="am-media-card-sub">${escapeHTML(attr.curatorName || displayName)}</div>
          </div>
        `;
      }).join('') || `<p class="am-empty-msg">No playlists found for this curator.</p>`;

      const heroBackgroundStyle = curatorArtwork
        ? `background-image: linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(18,18,18,0.88) 60%, rgba(18,18,18,0.98) 100%), url('${curatorArtwork}');`
        : `background: linear-gradient(135deg, #2c3e50 0%, #0f1820 100%);`;

      playlistViewContent.innerHTML = `
        <div class="am-artist-header am-artist-hero" style="${heroBackgroundStyle}">
          <div class="am-artist-name-row">
            <h1 class="am-artist-name">${escapeHTML(displayName)}</h1>
            <div style="font-size: 0.9rem; color: #fa586a; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">Curator</div>
          </div>
        </div>

        ${curatorBio ? `
          <div class="am-album-editorial-card" style="margin: 24px 0; padding: 18px 20px; border-radius: 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);">
            <div style="font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #ffffff; margin-bottom: 8px;">About</div>
            <div style="font-size: 0.92rem; line-height: 1.6; color: #d1d1d6;">${escapeHTML(curatorBio)}</div>
          </div>
        ` : ''}

        <div class="am-search-section" style="margin-top: 30px; margin-bottom: 40px;">
          <h3 class="am-search-section-title">Curated Playlists</h3>
          <div class="am-cards-horizontal-scroll">${playlistsHTML}</div>
        </div>
      `;

      playlistViewContent.querySelectorAll('.am-standard-media-card').forEach(card => {
        card.onclick = () => {
          const name = card.querySelector('.am-media-card-title')?.textContent || 'Playlist';
          showRemotePlaylistView(card.dataset.id, name);
        };
      });

    } catch (err) {
      console.error(err);
      playlistViewContent.innerHTML = `<div class="am-error-msg">${t('error')}: ${err.message}</div>`;
    }
  }

  // ── Remote Playlist View ──
  // ── Remote Playlist View ──
  async function showRemotePlaylistView(playlistId, playlistName, options = {}) {
    if (searchBarWrapper) searchBarWrapper.classList.add('hidden');
    if (listenInitialContent) listenInitialContent.classList.add('hidden');
    if (searchResultsContainer) searchResultsContainer.classList.add('hidden');
    if (albumViewContainer) albumViewContainer.classList.add('hidden');
    if (artistViewContainer) artistViewContainer.classList.add('hidden');
    if (songViewContainer) songViewContainer.classList.add('hidden');
    if (playlistViewContainer) playlistViewContainer.classList.remove('hidden');

    playlistViewContent.innerHTML = `<div class="am-loading-msg">${t('loading')}</div>`;

    if (!options.skipUrlSync) {
      syncUrl(`/playlist/${toSlug(playlistName || 'playlist')}/${playlistId}`, '', options.replaceUrl);
    }

    try {
      const playlistUrl = `${API_BASE}/playlist?playlist=${playlistId}&storefront=us&l=en-US&extend=editorialVideo,editorialArtwork,editorialNotes,trackCount,extendedAssetUrls&include=tracks,curator&include[tracks]=artists,albums,composers&views=animated-artwork`;
      const res = await fetch(playlistUrl);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();

      const plObj = Array.isArray(data.data) ? data.data[0] : (data.data || data);
      const attr = plObj?.attributes || {};
      const rels = plObj?.relationships || {};

      const name = attr.name || data.name || playlistName || 'Playlist';
      const curator = attr.curatorName || rels.curator?.data?.[0]?.attributes?.name || data.curator_name || 'Apple Music';
      const rawArt = attr.artwork?.url || data.artwork_url;
      const artUrl = cleanArtworkUrl(rawArt, 600, 600);
      const descRaw = attr.editorialNotes?.standard || attr.editorialNotes?.short || attr.description?.standard || attr.description?.short || data.description || '';
      const desc = descRaw ? descRaw.replace(/<[^>]*>/g, '') : '';

      // Parse tracks from relationships.tracks.data
      const rawTracks = rels.tracks?.data || data.parsed_tracks || [];
      const tracks = rawTracks.map(tItem => {
        const tAttr = tItem.attributes || tItem;
        return {
          id: tItem.id || tAttr.playParams?.id,
          title: tAttr.name || tAttr.title || 'Unknown',
          artist: tAttr.artistName || tAttr.artist || curator,
          album: tAttr.albumName || tAttr.album || name,
          album_id: tItem.relationships?.albums?.data?.[0]?.id || tAttr.albumId || null,
          duration_ms: tAttr.durationInMillis || tAttr.duration_ms || 0,
          artwork_url: cleanArtworkUrl(tAttr.artwork?.url || tAttr.artworkUrl100 || rawArt, 300, 300),
          is_explicit: (tAttr.contentRating === 'explicit') || Boolean(tAttr.is_explicit)
        };
      });

      const trackCount = attr.trackCount || tracks.length;

      if (attr.name && attr.name !== playlistName) {
        syncUrl(`/playlist/${toSlug(name)}/${playlistId}`, '', true);
      }

      // Check for motion video artwork
      const motionVideoUrl = attr.editorialVideo?.motionDetailTall?.video || attr.editorialVideo?.motionSquareVideo1x1?.video || attr.editorialVideo?.motionDetailSquare?.video || '';
      const heroArt = cleanArtworkUrl(rawArt, 1200, 1200);
      const isMobile = window.innerWidth <= 768;

      // Apply page-wide color scheming for Playlist
      applyPageThemeColor(artUrl, attr.artwork?.bgColor);

      const renderPlaylistTrackRows = () => tracks.map((tItem, idx) => `
        <div class="am-track-row animate-fade" data-id="${tItem.id}" data-idx="${idx}">
          <div class="am-track-num">${idx + 1}</div>
          <div class="am-track-title">
            <span class="am-track-title-link" data-id="${tItem.id}" data-title="${escapeHTML(tItem.title || 'Song')}">${escapeHTML(tItem.title || 'Unknown')}</span>
            ${tItem.is_explicit ? '<span class="am-explicit-tag">E</span>' : ''}
          </div>
          <div class="am-track-duration">${formatDuration(tItem.duration_ms)}</div>
          <button class="am-song-more-btn" data-id="${tItem.id}">•••</button>
        </div>
      `).join('');

      if (isMobile) {
        playlistViewContent.innerHTML = `
          <div class="am-artist-mob-hero">
            ${motionVideoUrl ? `
              <video src="${motionVideoUrl}" autoplay loop muted playsinline class="am-artist-mob-bg" style="object-fit: cover;" poster="${heroArt}"></video>
            ` : `
              <div class="am-artist-mob-bg" style="background-image: url('${heroArt}');"></div>
            `}
            <div class="am-artist-mob-overlay"></div>

            <!-- Top Nav Controls -->
            <div class="am-artist-mob-top-bar">
              <button class="am-artist-mob-nav-btn" id="playlist-mob-back-btn" aria-label="Back">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
              </button>
              <div class="am-artist-mob-top-right">
                <button class="am-artist-mob-nav-btn" id="playlist-mob-share-btn" aria-label="Share">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                </button>
                <button class="am-artist-mob-nav-btn" id="playlist-mob-more-btn" aria-label="More">•••</button>
              </div>
            </div>

            <!-- Centered Title & Action Buttons -->
            <div class="am-artist-mob-center-content">
              <h1 class="am-artist-mob-title" style="font-size: clamp(1.6rem, 5.5vw, 2.2rem);">${escapeHTML(name)}</h1>
              <div style="font-size: 0.95rem; font-weight: 600; color: #fa586a; margin-top: 4px; margin-bottom: 2px;">${escapeHTML(curator)}</div>
              <div style="font-size: 0.8rem; color: rgba(255,255,255,0.6); margin-bottom: 14px;">${trackCount} Songs</div>

              <div class="am-artist-mob-actions-row">
                <!-- Info (i) Button -->
                <button class="am-artist-circle-btn" id="playlist-mob-info-btn" title="About Playlist" aria-label="About Playlist">
                  <span>i</span>
                </button>

                <!-- Large Play Button -->
                <button class="am-artist-play-circle-btn" id="playlist-mob-play-btn" title="Play All" aria-label="Play">
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                </button>

                <!-- Share / More Button -->
                <button class="am-artist-circle-btn" id="playlist-mob-fav-btn" title="Share" aria-label="Share">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                </button>
              </div>
            </div>
          </div>

          <div class="am-album-tracks" style="margin-top: 20px;">
            ${renderPlaylistTrackRows()}
          </div>
        `;
      } else {
        playlistViewContent.innerHTML = `
          <div class="am-album-header" style="display: flex; gap: 24px; align-items: flex-end; padding: 24px 0; position: relative;">
            <div class="am-album-art-container" style="position: relative; overflow: hidden; border-radius: 12px;">
              ${motionVideoUrl ? `
                <video src="${motionVideoUrl}" autoplay loop muted playsinline class="am-album-cover" style="object-fit: cover;" poster="${artUrl}"></video>
              ` : `
                <img src="${artUrl}" class="am-album-cover" onerror="this.src='favicon.svg'">
              `}
            </div>
            <div class="am-album-details">
              <h2 class="am-album-title">${escapeHTML(name)}</h2>
              <div class="am-album-artist" style="color: #fa586a; font-weight: 600;">${escapeHTML(curator)}</div>
              <div style="margin-top: 10px; font-size: 0.85rem; color: #6e6e73;">${trackCount} Songs</div>
              <div class="am-album-actions" style="display: flex; gap: 12px; margin-top: 16px;">
                <button class="am-album-play-btn" id="playlist-desktop-play-btn" style="display: flex; align-items: center; gap: 8px; padding: 8px 20px; border-radius: 20px; background: #fa586a; color: #fff; border: none; font-weight: 600; cursor: pointer;">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Play
                </button>
              </div>
            </div>
          </div>

          <div class="am-album-tracks" style="margin-top: 20px;">
            ${renderPlaylistTrackRows()}
          </div>
        `;
      }

      // Title link click: open song view (/song/songid)
      playlistViewContent.querySelectorAll('.am-track-title-link').forEach(link => {
        link.onclick = (e) => {
          e.stopPropagation();
          const sId = link.dataset.id;
          const sTitle = link.dataset.title;
          showSongView(sId, sTitle);
        };
      });

      // Mobile controls
      const mobBack = playlistViewContent.querySelector('#playlist-mob-back-btn');
      if (mobBack) mobBack.onclick = () => window.history.back();

      const mobShare = playlistViewContent.querySelector('#playlist-mob-share-btn') || playlistViewContent.querySelector('#playlist-mob-fav-btn');
      if (mobShare) {
        mobShare.onclick = () => {
          shareEntity({
            title: name,
            text: `Listen to ${name} on Lyricsflow`,
            url: `/playlist/${toSlug(name)}/${playlistId}`
          });
        };
      }

      // Helper: build playlist queue from clicked index onwards
      const createPlaylistQueue = (startIdx) => {
        const after = tracks.slice(startIdx);
        const before = tracks.slice(0, startIdx);
        return [...after, ...before].map(t => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          album: t.album,
          artUrl: t.artwork_url,
          previewUrl: `${API_BASE}/stream?song=${t.id}&l=en-US`,
          durationMs: t.duration_ms || 180000
        }));
      };

      const mobPlay = playlistViewContent.querySelector('#playlist-mob-play-btn');
      const deskPlay = playlistViewContent.querySelector('#playlist-desktop-play-btn');
      const handlePlayAll = () => {
        if (!tracks || tracks.length === 0) return;
        const plQueue = createPlaylistQueue(0);
        loadRemoteTrack({
          trackId: tracks[0].id,
          trackName: tracks[0].title,
          artistName: tracks[0].artist,
          collectionName: tracks[0].album,
          albumId: tracks[0].album_id,
          artworkUrl100: tracks[0].artwork_url
        }, plQueue);
      };
      if (mobPlay) mobPlay.onclick = handlePlayAll;
      if (deskPlay) deskPlay.onclick = handlePlayAll;

      playlistViewContent.querySelectorAll('.am-track-row').forEach(row => {
        row.onclick = (e) => {
          if (e.target.closest('.am-track-title-link')) return;
          const idx = parseInt(row.dataset.idx, 10);
          const tItem = tracks[idx];
          if (!tItem) return;

          if (e.target.classList.contains('am-song-more-btn')) {
            e.stopPropagation();
            showContextMenu(e, {
              trackId: tItem.id,
              trackName: tItem.title,
              artistName: tItem.artist,
              collectionName: tItem.album,
              albumId: tItem.album_id,
              artworkUrl100: tItem.artwork_url
            });
            return;
          }

          queueContextualWithSimilar({
            trackId: tItem.id,
            trackName: tItem.title,
            artistName: tItem.artist,
            collectionName: tItem.album,
            albumId: tItem.album_id,
            artworkUrl100: tItem.artwork_url,
            durationMs: tItem.duration_ms
          }, tracks.map(t => ({
            id: t.id,
            title: t.title,
            artist: t.artist,
            album: t.album,
            artUrl: t.artwork_url,
            durationMs: t.duration_ms || 180000
          })), idx);
        };
      });

    } catch (err) {
      console.error(err);
      playlistViewContent.innerHTML = `<div class="am-error-msg">${t('error')}: ${err.message}</div>`;
    }
  }

  // ── Contextual Queue with Ordered Tracks & Similar Songs Appended ──
  async function queueContextualWithSimilar(currentSong, list = [], clickedIndex = 0) {
    if (!currentSong) return;
    const songId = currentSong.trackId || currentSong.id;

    // 1. Arrange queue: Clicked song first, followed by songs after it, followed by songs before it
    const orderedList = [];
    if (list && list.length > 0) {
      const idx = (clickedIndex >= 0 && clickedIndex < list.length) ? clickedIndex : list.findIndex(x => String(x.id || x.trackId) === String(songId));
      if (idx >= 0) {
        for (let i = idx; i < list.length; i++) orderedList.push(list[i]);
        for (let i = 0; i < idx; i++) orderedList.push(list[i]);
      } else {
        orderedList.push(currentSong);
        for (const item of list) {
          if (String(item.id || item.trackId) !== String(songId)) orderedList.push(item);
        }
      }
    } else {
      orderedList.push(currentSong);
    }

    // Format queue items for PreviewPlayer
    const formattedQueue = orderedList.map(item => ({
      id: item.id || item.trackId || item.amTrackId,
      title: item.title || item.name || item.trackName || 'Track',
      artist: item.artist || item.artistName || '',
      album: item.album || item.collectionName || '',
      artUrl: cleanArtworkUrl(item.artUrl || item.artworkUrl100 || item.artwork_url, 300, 300),
      previewUrl: item.previewUrl || `${API_BASE}/stream?song=${item.id || item.trackId}&l=en-US`,
      durationMs: item.durationMs || item.durationInMillis || item.duration_ms || 180000
    }));

    // Start playing the clicked song immediately
    loadRemoteTrack(currentSong, formattedQueue);

    // 2. Fetch similar songs using search/artist recommendations and append to queue
    (async () => {
      try {
        const queryTerm = currentSong.artistName || currentSong.artist || currentSong.trackName || currentSong.title || '';
        if (!queryTerm) return;
        const recRes = await fetch(`${API_BASE}/search?term=${encodeURIComponent(queryTerm)}&types=songs&limit=25&l=en-US`);
        if (recRes.ok) {
          const recData = await recRes.json();
          const recSongs = recData?.results?.songs?.data || [];
          const existingIds = new Set(previewPlayer.queue.map(x => String(x.id)));
          const additional = [];
          for (const s of recSongs) {
            if (!existingIds.has(String(s.id))) {
              existingIds.add(String(s.id));
              const sAttr = s.attributes || {};
              additional.push({
                id: s.id,
                title: sAttr.name || 'Song',
                artist: sAttr.artistName || '',
                album: sAttr.albumName || '',
                artUrl: cleanArtworkUrl(sAttr.artwork?.url, 300, 300),
                previewUrl: `${API_BASE}/stream?song=${s.id}&l=en-US`,
                durationMs: sAttr.durationInMillis || 180000
              });
            }
          }
          if (additional.length > 0) {
            previewPlayer.queue.push(...additional);
          }
        }
      } catch (_) {}
    })();
  }
  window.queueContextualWithSimilar = queueContextualWithSimilar;

  // ── Remote Track Load & Playback (Plays in bottom mini player immediately) ──
  async function loadRemoteTrack(song, queue = []) {
    const songId = song.trackId || song.id;
    let fullSongData = null;

    // Always query the /song endpoint to obtain authoritative metadata
    if (songId && !isNaN(Number(songId))) {
      try {
        const sRes = await fetch(`${API_BASE}/song?song=${songId}&l=en-US`);
        if (sRes.ok) {
          const sJson = await sRes.json();
          fullSongData = sJson.data?.[0] || sJson.results?.songs?.data?.[0] || (sJson.resources?.songs ? Object.values(sJson.resources.songs)[0] : null);
        }
      } catch (e) {
        console.warn('[upload.js] Failed to fetch /song metadata:', e);
      }
    }

    const attr = fullSongData?.attributes || {};
    const rels = fullSongData?.relationships || {};

    const finalTitle = attr.name || attr.trackName || song.trackName || song.title || 'Track';
    const finalArtist = attr.artistName || song.artistName || song.artist || 'Artist';
    const finalAlbum = attr.albumName || attr.collectionName || song.collectionName || song.album || '';
    const finalAlbumId = rels.albums?.data?.[0]?.id || song.albumId || attr.url?.match(/\/album\/[^/]+\/(\d+)/)?.[1] || null;
    const finalArtistId = rels.artists?.data?.[0]?.id || song.artistId || null;
    const rawArt = attr.artwork?.url || song.artworkUrlLarge || song.rawArtwork || song.artworkUrl100 || song.artUrl;
    const finalArt = resolveArtworkUrl(rawArt, { width: 1000, height: 1000 }) || cleanArtworkUrl(rawArt, 600, 600);
    const finalDurationMs = attr.durationInMillis || song.durationMs || 180000;
    const finalReleaseDate = attr.releaseDate || song.releaseDate || null;
    const finalAudioTraits = attr.audioTraits || song.audioTraits || [];
    const isSongExplicit = Boolean(attr.contentRating === 'explicit' || song.contentRating === 'explicit' || song.is_explicit);

    // 1. Seed into IndexedDB immediately so player.html has full rich data ready
    try {
      const { clearQueue, addTrackToQueue, setCurrentIndex } = await import('./router.js');
      await clearQueue();
      
      // Determine full track list to seed
      const queueToSeed = (queue && queue.length > 0) ? queue : [{
        id: songId,
        title: finalTitle,
        artist: finalArtist,
        album: finalAlbum,
        albumId: finalAlbumId,
        artistId: finalArtistId,
        artUrl: finalArt,
        type: 'audio/mp4',
        ttml: song.ttml || '__AUTO_FETCH__',
        amTrackId: songId,
        releaseDate: finalReleaseDate,
        year: finalReleaseDate ? new Date(finalReleaseDate).getFullYear() : (song.year || null),
        audioTraits: finalAudioTraits,
        is_explicit: isSongExplicit,
        songwriters: song.songwriters || [],
        credits: song.credits || null
      }];

      let activeIndexInQueue = 0;
      for (let qi = 0; qi < queueToSeed.length; qi++) {
        const item = queueToSeed[qi];
        const isCurrent = String(item.id || item.trackId || item.amTrackId) === String(songId);
        if (isCurrent) activeIndexInQueue = qi;

        await addTrackToQueue(null, {
          name: isCurrent ? finalTitle : (item.title || item.name || 'Track'),
          artist: isCurrent ? finalArtist : (item.artist || item.artistName || 'Artist'),
          album: isCurrent ? finalAlbum : (item.album || item.collectionName || ''),
          albumId: isCurrent ? finalAlbumId : (item.albumId || null),
          artistId: isCurrent ? finalArtistId : (item.artistId || null),
          artUrl: isCurrent ? finalArt : cleanArtworkUrl(item.artUrl || item.artworkUrl100 || '', 600, 600),
          type: 'audio/mp4',
          ttml: isCurrent ? (song.ttml || '__AUTO_FETCH__') : (item.ttml || '__AUTO_FETCH__'),
          amTrackId: item.id || item.trackId || item.amTrackId || songId,
          releaseDate: isCurrent ? finalReleaseDate : (item.releaseDate || null),
          year: isCurrent ? (finalReleaseDate ? new Date(finalReleaseDate).getFullYear() : (song.year || null)) : (item.year || null),
          audioTraits: isCurrent ? finalAudioTraits : (item.audioTraits || []),
          is_explicit: isCurrent ? isSongExplicit : Boolean(item.is_explicit || item.contentRating === 'explicit'),
          songwriters: isCurrent ? (song.songwriters || []) : (item.songwriters || []),
          credits: isCurrent ? (song.credits || null) : (item.credits || null)
        });
      }
      setCurrentIndex(activeIndexInQueue);
    } catch (e) {
      console.warn('[upload.js] Failed to pre-seed queue for player:', e);
    }

    const trackObj = {
      id: songId,
      title: finalTitle,
      artist: finalArtist,
      album: finalAlbum,
      albumId: finalAlbumId,
      artistId: finalArtistId,
      artUrl: finalArt,
      previewUrl: song.previewUrl || `${API_BASE}/stream?song=${songId}&l=en-US`,
      durationMs: finalDurationMs,
      releaseDate: finalReleaseDate,
      year: finalReleaseDate ? new Date(finalReleaseDate).getFullYear() : (song.year || null),
      audioTraits: finalAudioTraits,
      ttml: song.ttml || null
    };

    addToRecent(trackObj);
    syncHomeNavVisibility();

    previewPlayer.playTrack(trackObj, queue);
  }

  async function loadTrackById(id, queue = []) {
    if (!prepOverlay) return;

    prepOverlay.classList.add('active');
    prepStatus.textContent = t('loading_metadata');

    try {
      let songData = null;
      let attr = null;
      let albumId = null;
      let artistId = null;
      let parsedAmp = null;
      let songTtml = null;
      let songwriters = [];

      try {
        const songAmpUrl = `${API_BASE}/v1/catalog/kz/songs/${id}?art[url]=f&extend=lyricsExcerpt,offers&fields[albums]=artistName,artistUrl,artwork,name,url&fields[artists]=name,url&format[resources]=map&include=albums,artists,credits,lyrics,music-videos&l=${getCurrentLang() || 'en-GB'}&platform=web`;
        const res = await fetch(songAmpUrl);
        if (res.ok) {
          const raw = await res.json();
          parsedAmp = parseAmpResponse(raw);
          songData = parsedAmp.data?.[0] || parsedAmp.resources?.songs?.[id] || null;
          if (songData) {
            attr = songData.attributes || songData;
            albumId = songData.relationships?.albums?.[0]?.id || songData.relationships?.albums?.data?.[0]?.id || attr.url?.match(/\/album\/[^/]+\/(\d+)/)?.[1] || null;
            artistId = songData.relationships?.artists?.[0]?.id || songData.relationships?.artists?.data?.[0]?.id || null;

            // Direct extraction of high-fidelity TTML lyrics and credits if included in AMP response
            const lyricsObj = parsedAmp.resources?.lyrics?.[id] || songData.relationships?.lyrics?.[0];
            if (lyricsObj?.attributes?.ttml) {
              songTtml = lyricsObj.attributes.ttml;
            } else if (lyricsObj?.ttml) {
              songTtml = lyricsObj.ttml;
            }

            const creditsData = songData.relationships?.credits || [];
            if (Array.isArray(creditsData)) {
              songwriters = creditsData.map(c => c.name || c.attributes?.name).filter(Boolean);
            }
          }
        }
      } catch (e) {
        console.warn("[ID Loader] AMP API fetch failed, trying legacy route:", e);
      }

      // Legacy API_BASE fallback if AMP proxy failed
      if (!songData) {
        try {
          const legacyRes = await fetch(`${API_BASE}/song?song=${id}&l=${getCurrentLang()}`);
          if (legacyRes.ok) {
            const data = await legacyRes.json();
            songData = data.data?.[0] || data.results?.songs?.data?.[0];
            if (songData) {
              attr = songData.attributes || {};
              albumId = songData.relationships?.albums?.data?.[0]?.id || attr.url?.match(/\/album\/[^/]+\/(\d+)/)?.[1] || null;
              artistId = songData.relationships?.artists?.data?.[0]?.id || null;
            }
          }
        } catch (_) {}
      }

      // Seamless fallback to Apple iTunes lookup API if spicyamll API returned 404
      if (!songData) {
        const itunesRes = await fetch(`https://itunes.apple.com/lookup?id=${id}`);
        if (!itunesRes.ok) throw new Error(`Status ${itunesRes.status}`);
        const itunesData = await itunesRes.json();
        const itunesTrack = itunesData?.results?.[0];
        if (!itunesTrack) throw new Error("Track ID not found");

        const song = {
          trackId: itunesTrack.trackId || id,
          trackName: itunesTrack.trackName,
          artistName: itunesTrack.artistName,
          collectionName: itunesTrack.collectionName,
          albumId: itunesTrack.collectionId || null,
          artistId: itunesTrack.artistId || null,
          releaseDate: itunesTrack.releaseDate || null,
          year: itunesTrack.releaseDate ? new Date(itunesTrack.releaseDate).getFullYear().toString() : null,
          artworkUrl100: itunesTrack.artworkUrl100 ? itunesTrack.artworkUrl100.replace('100x100', '600x600') : '',
          artworkUrlLarge: itunesTrack.artworkUrl100 ? itunesTrack.artworkUrl100.replace('100x100', '1000x1000') : '',
          durationMs: itunesTrack.trackTimeMillis || 180000,
          previewUrl: itunesTrack.previewUrl || `${API_BASE}/stream?song=${id}&l=${getCurrentLang()}`
        };

        if (itunesTrack.previewUrl) {
          previewPlayer.playTrack({
            id: song.trackId,
            title: song.trackName,
            artist: song.artistName,
            album: song.collectionName,
            artUrl: song.artworkUrlLarge || song.artworkUrl100,
            previewUrl: itunesTrack.previewUrl,
            durationMs: itunesTrack.trackTimeMillis || 180000
          }, queue);
          if (prepOverlay) prepOverlay.classList.remove('active');
          return;
        }

        await loadRemoteTrack(song, queue);
        if (prepOverlay) prepOverlay.classList.remove('active');
        return;
      }

      const rawArt = attr.artwork || attr.editorialArtwork;
      const artworkUrl100 = resolveArtworkUrl(rawArt, { width: 100, height: 100 }) || cleanArtworkUrl(attr.artwork?.url, 100, 100);
      const artworkUrlLarge = resolveArtworkUrl(rawArt, { width: 1000, height: 1000 }) || cleanArtworkUrl(attr.artwork?.url, 1000, 1000);

      const song = {
        trackId: songData.id,
        trackName: attr.name,
        artistName: attr.artistName,
        collectionName: attr.albumName,
        albumId: albumId,
        artistId: artistId,
        releaseDate: attr.releaseDate || null,
        year: attr.releaseDate ? formatLocalizedYear(attr.releaseDate) : null,
        rawArtwork: rawArt,
        artworkUrl100: artworkUrl100,
        artworkUrlLarge: artworkUrlLarge,
        durationMs: attr.durationInMillis || 180000,
        audioTraits: attr.audioTraits || [],
        lyricsExcerpt: attr.lyricsExcerpt || null,
        ttml: songTtml,
        songwriters: songwriters
      };

      await loadRemoteTrack(song, queue);
      if (prepOverlay) prepOverlay.classList.remove('active');
    } catch (err) {
      console.error("[ID Loader] Failed:", err);
      if (prepOverlay) prepOverlay.classList.remove('active');
      showToast({ message: `Could not load track ${id}: ${err.message}` });
    }
  }

  // ── Unified Contextual + Similar Songs Queueing Helper ──
  async function queueContextualWithSimilar(clickedTrack, listTracks = [], currentIndex = 0) {
    let contextualQueue = [];
    if (listTracks && listTracks.length > 0) {
      const after = listTracks.slice(currentIndex);
      const before = listTracks.slice(0, currentIndex);
      contextualQueue = [...after, ...before].map(t => {
        const tId = t.id || t.trackId;
        const tTitle = t.title || t.trackName || t.name || 'Song';
        const tArtist = t.artist || t.artistName || 'Artist';
        const tAlbum = t.album || t.collectionName || '';
        const tArt = t.artUrl || t.artwork_url || t.artworkUrl100 || '';
        const tDuration = t.durationMs || t.duration_ms || t.durationInMillis || 180000;
        return {
          id: tId,
          title: tTitle,
          artist: tArtist,
          album: tAlbum,
          artUrl: cleanArtworkUrl(tArt, 300, 300),
          previewUrl: t.previewUrl || `${API_BASE}/stream?song=${tId}&l=en-US`,
          durationMs: tDuration
        };
      });
    }

    // Play clicked track with reordered contextual queue immediately
    await loadRemoteTrack(clickedTrack, contextualQueue);

    // Asynchronously fetch similar songs from Apple Music catalog endpoint
    (async () => {
      try {
        const songId = clickedTrack.trackId || clickedTrack.id;
        const artist = clickedTrack.artistName || clickedTrack.artist || '';
        let similarSongs = [];

        // 1. Try Apple Music catalog similar-songs view
        if (songId) {
          try {
            const res = await fetch(`${API_BASE}/v1/catalog/kz/songs/${songId}?views=similar-songs&l=en-US`);
            if (res.ok) {
              const data = await res.json();
              similarSongs = data.resources?.songs ? Object.values(data.resources.songs) : (data.views?.['similar-songs']?.data || []);
            }
          } catch (_) {}
        }

        // 2. Fallback search by artist if similar-songs view returned empty
        if (!similarSongs || similarSongs.length === 0) {
          if (artist) {
            const sRes = await fetch(`${API_BASE}/search?term=${encodeURIComponent(artist)}&types=songs&limit=15&l=en-US`);
            if (sRes.ok) {
              const sData = await sRes.json();
              similarSongs = sData.results?.songs?.data || [];
            }
          }
        }

        if (similarSongs && similarSongs.length > 0) {
          const existingIds = new Set(previewPlayer.queue.map(x => String(x.id)));
          if (clickedTrack.trackId || clickedTrack.id) existingIds.add(String(clickedTrack.trackId || clickedTrack.id));

          const appendItems = [];
          for (const s of similarSongs) {
            const sId = String(s.id);
            if (!existingIds.has(sId)) {
              existingIds.add(sId);
              const attr = s.attributes || s;
              appendItems.push({
                id: sId,
                title: attr.name || attr.trackName || 'Song',
                artist: attr.artistName || artist,
                album: attr.albumName || attr.collectionName || '',
                artUrl: cleanArtworkUrl(attr.artwork?.url || attr.artworkUrl100, 300, 300),
                previewUrl: `${API_BASE}/stream?song=${sId}&l=en-US`,
                durationMs: attr.durationInMillis || 180000
              });
            }
          }

          if (appendItems.length > 0) {
            previewPlayer.queue.push(...appendItems);
          }
        }
      } catch (err) {
        console.warn('[Queue] Failed to append similar songs:', err);
      }
    })();
  }

  // ── Community Profile View (Pure /:username, No @, Handcrafted Aesthetics) ──
  async function showCommunityProfileView(identifier, options = {}) {
    switchPage('listen', { skipUrlSync: true });
    if (listenInitialContent) listenInitialContent.classList.add('hidden');
    if (searchResultsContainer) searchResultsContainer.classList.add('hidden');
    if (albumViewContainer) albumViewContainer.classList.add('hidden');
    if (artistViewContainer) artistViewContainer.classList.add('hidden');
    if (songViewContainer) songViewContainer.classList.add('hidden');
    if (playlistViewContainer) playlistViewContainer.classList.remove('hidden');

    const cleanUsername = identifier.replace(/^@/, '').trim();
    if (!options.skipUrlSync) {
      syncUrl(`/${cleanUsername}`, '', options.replaceUrl);
    }
    window.showCommunityProfileView = showCommunityProfileView;

    playlistViewContent.innerHTML = `
      <div style="display:-webkit-box;display:-webkit-flex;display:-ms-flexbox;display:flex;-webkit-box-orient:vertical;-webkit-box-direction:normal;-webkit-flex-direction:column;-ms-flex-direction:column;flex-direction:column;-webkit-box-align:center;-webkit-align-items:center;-ms-flex-align:center;align-items:center;-webkit-box-pack:center;-webkit-justify-content:center;-ms-flex-pack:center;justify-content:center;min-height:55vh;color:#8e8e93;gap:16px;">
        <div class="am-spinner"></div>
        <div style="font-size:0.95rem;font-weight:500;letter-spacing:-0.01em;">Loading ${escapeHTML(cleanUsername)}...</div>
      </div>`;

    try {
      const res = await fetch(`${API_BASE}/api/community/profile/${encodeURIComponent(cleanUsername)}`);
      if (!res.ok) {
        showNotFoundView(cleanUsername);
        return;
      }
      const data = await res.json();

      // Handle rename redirection
      if (data.redirect) {
        syncUrl(`/${data.redirect}`, '', true);
        showCommunityProfileView(data.redirect, { skipUrlSync: true });
        return;
      }

      // Decode protected in-transit payload
      let profile = data;
      const encodedPayload = data._lyricsflow_payload || data._spicy_payload;
      if (encodedPayload) {
        try {
          const raw = atob(encodedPayload);
          profile = JSON.parse(raw);
        } catch (decErr) {
          console.error('[Profile] Payload decode error:', decErr);
        }
      }

      renderCommunityProfile(profile);
    } catch (err) {
      console.error('[Profile] Failed to fetch profile:', err);
      showNotFoundView(cleanUsername);
    }
  }

  function showNotFoundView(slug) {
    if (playlistViewContainer) playlistViewContainer.classList.remove('hidden');
    playlistViewContent.innerHTML = `
      <div style="max-width:520px;margin:60px auto;padding:44px 28px;border-radius:24px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);-webkit-backdrop-filter:blur(32px);backdrop-filter:blur(32px);text-align:center;box-shadow:0 24px 60px rgba(0,0,0,0.6);">
        <div style="font-size:5rem;font-weight:800;background:-webkit-linear-gradient(315deg,#fc576b,#ff7b8b);background:linear-gradient(135deg,#fc576b,#ff7b8b);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;line-height:1;margin-bottom:8px;font-family:var(--font-main, -apple-system);">404</div>
        <h2 style="font-size:1.45rem;font-weight:700;color:#f0f0f2;margin-bottom:10px;letter-spacing:-0.02em;">Page Not Found</h2>
        <button id="profile-404-home-btn" class="am-btn-primary" style="padding:12px 26px;border-radius:12px;font-size:0.92rem;font-weight:650;background:#fc576b;color:#fff;border:none;cursor:pointer;">Return to Home</button>
      </div>
    `;
    const homeBtn = playlistViewContent.querySelector('#profile-404-home-btn');
    if (homeBtn) {
      homeBtn.addEventListener('click', () => {
        if (playlistViewContainer) playlistViewContainer.classList.add('hidden');
        if (typeof switchPage === 'function') {
          switchPage(hasListenedSongs() ? 'home' : 'listen');
        } else {
          window.location.pathname = '/';
        }
      });
    }
  }

  function renderCommunityProfile(profile) {
    const bannerUrl = profile.banner || '';
    const avatarUrl = profile.pfp || 'icons/account_avatar.png';
    const nickname = profile.nickname || profile.username || 'Creator';
    const username = profile.username || 'user';
    const makesSongs = Array.isArray(profile.makes_songs) ? profile.makes_songs : [];
    const uploadedSongs = Array.isArray(profile.uploaded_songs) ? profile.uploaded_songs : [];
    const legacySongs = Array.isArray(profile.songs) ? profile.songs : [];

    const finalMakes = makesSongs.length ? makesSongs : (uploadedSongs.length === 0 ? legacySongs : []);
    const finalUploads = uploadedSongs.length ? uploadedSongs : [];

    const makesCount = profile.makes_count || finalMakes.length;
    const uploadsCount = profile.uploads_count || finalUploads.length;

    const totalPlaysMap = (profile.total_plays && typeof profile.total_plays === 'object') ? profile.total_plays : {};
    let realPlaysTotal = 0;
    Object.values(totalPlaysMap).forEach(v => {
      const num = Number(v);
      if (!isNaN(num)) realPlaysTotal += num;
    });
    const totalViews = profile.total_views || realPlaysTotal || 0;

    const customLinks = profile.links || {};
    const bioText = profile.bio || '';
    const blurBanner = profile.blur_banner !== false;

    // Blurry banner background styling
    const bannerBg = bannerUrl
      ? `background: linear-gradient(180deg, rgba(20,20,24,0.3) 0%, rgba(20,20,24,0.7) 45%, #141416 100%), url('${cleanArtworkUrl(bannerUrl, 1800, 700)}') center top / cover no-repeat;`
      : `background: radial-gradient(ellipse at 50% 0%, rgba(252,87,107,0.14) 0%, rgba(20,20,24,0.92) 65%, #141416 100%);`;

    // Map social links to icons
    const linkKeys = Object.keys(customLinks).filter(k => customLinks[k] && customLinks[k].trim());
    const socialIconsHtml = linkKeys.map(k => {
      const u = customLinks[k];
      const safeUrl = escapeHTML(u.startsWith('http') ? u : `https://${u}`);
      let iconSvg = `<svg width="15" height="15" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/></svg>`;
      const lk = k.toLowerCase();
      if (lk.includes('twitter') || lk.includes('x')) {
        iconSvg = `<svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`;
      } else if (lk.includes('tiktok')) {
        iconSvg = `<svg width="15" height="15" fill="currentColor" viewBox="0 0 24 24"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.88 2.89 2.89 0 0 1-2.89-2.88 2.89 2.89 0 0 1 2.89-2.89c.31 0 .61.05.88.13V9.41a6.33 6.33 0 0 0-.88-.06A6.34 6.34 0 0 0 3 15.69 6.34 6.34 0 0 0 9.34 22a6.34 6.34 0 0 0 6.34-6.31V8.5a8.28 8.28 0 0 0 3.91 1.07V6.69z"/></svg>`;
      } else if (lk.includes('soundcloud')) {
        iconSvg = `<svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M1.17 12.22c-.05 0-.09.05-.09.11v4.75c0 .06.04.11.09.11s.09-.05.09-.11v-4.75c0-.06-.04-.11-.09-.11zm1.56-1.5c-.06 0-.11.05-.11.11v6.78c0 .06.05.11.11.11s.11-.05.11-.11v-6.78c0-.06-.05-.11-.11-.11zm1.57-1.34c-.07 0-.13.06-.13.13v8.52c0 .07.06.13.13.13s.13-.06.13-.13V9.51c0-.07-.06-.13-.13-.13zm15.7 1.5c-.53 0-1.02.16-1.44.43-.33-2.76-2.69-4.89-5.56-4.89-.64 0-1.25.11-1.82.3-.22.08-.34.31-.27.53.08.22.31.34.53.27.49-.17 1.01-.26 1.56-.26 2.45 0 4.46 1.83 4.75 4.21.03.24.23.42.47.42.03 0 .06 0 .09-.01.42-.09.85-.14 1.29-.14 2.65 0 4.8 2.15 4.8 4.8s-2.15 4.8-4.8 4.8h-7.6c-.28 0-.5-.22-.5-.5s.22-.5.5-.5h7.6c2.1 0 3.8-1.7 3.8-3.8s-1.7-3.86-3.8-3.86z"/></svg>`;
      } else if (lk.includes('youtube')) {
        iconSvg = `<svg width="15" height="15" fill="currentColor" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`;
      }
      return `
        <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" title="${escapeHTML(k)}"
          style="width:36px;height:36px;border-radius:10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);display:inline-flex;align-items:center;justify-content:center;color:#ffffff;text-decoration:none;transition:all 0.16s ease;"
          onmouseover="this.style.background='rgba(255,255,255,0.15)';this.style.transform='translateY(-2px)';"
          onmouseout="this.style.background='rgba(255,255,255,0.06)';this.style.transform='translateY(0)';">
          ${iconSvg}
        </a>`;
    }).join('');

    playlistViewContent.innerHTML = `
      <div class="community-profile-page" style="position:relative;overflow:hidden;min-height:88vh;padding:48px 24px 64px;margin:-24px -24px 0;border-radius:18px;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">
        <!-- Backdrop Banner (with customizable blur) -->
        <div style="position:absolute;top:0;left:0;right:0;height:360px;${bannerBg} ${blurBanner ? 'filter:blur(36px);-webkit-filter:blur(36px);transform:scale(1.08);' : ''} pointer-events:none;z-index:0;opacity:0.85;"></div>
        <div style="position:absolute;top:0;left:0;right:0;height:360px;background:linear-gradient(180deg, rgba(20,20,24,0.1) 0%, #141416 100%);pointer-events:none;z-index:1;"></div>

        <div style="position:relative;z-index:2;">
          <!-- Top Profile Header (Clean, No DND presence, No guild tags, No static Creator tag) -->
          <div style="display:flex;flex-direction:column;align-items:center;text-align:center;margin-bottom:34px;">
            <div style="position:relative;margin-bottom:14px;">
              <img src="${cleanArtworkUrl(avatarUrl, 260, 260)}" alt="${escapeHTML(nickname)}"
                style="width:116px;height:116px;border-radius:50%;object-fit:cover;border:3px solid rgba(255,255,255,0.85);box-shadow:0 10px 32px rgba(0,0,0,0.6);background:#18181a;display:block;"
                onerror="this.src='icons/account_avatar.png';" />
            </div>
            <h1 style="font-size:2.05rem;font-weight:750;color:#ffffff;margin:0 0 4px;letter-spacing:-0.025em;line-height:1.2;">${escapeHTML(nickname)}</h1>
            <div style="font-size:0.95rem;color:#8e8e93;margin-bottom:12px;font-weight:500;">@${escapeHTML(username)}</div>

            ${bioText ? `
              <div style="max-width:460px;font-size:0.92rem;line-height:1.45;color:#d0d0d4;margin-bottom:16px;font-weight:450;">
                ${escapeHTML(bioText)}
              </div>
            ` : ''}

            <!-- Social / Platform Links -->
            ${socialIconsHtml ? `
              <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-bottom:8px;">
                ${socialIconsHtml}
              </div>
            ` : ''}
          </div>

          <!-- Main Layout -->
          <div style="display:grid;grid-template-columns:270px 1fr;gap:26px;max-width:1160px;margin:0 auto;" class="profile-layout-grid">
            <!-- Left Column: Total Views Card -->
            <div>
              <div style="background:rgba(255,255,255,0.035);border:1px solid rgba(255,255,255,0.075);backdrop-filter:blur(28px);-webkit-backdrop-filter:blur(28px);border-radius:18px;padding:22px 20px;box-shadow:0 14px 40px rgba(0,0,0,0.38);">
                <div style="font-size:0.8rem;font-weight:600;color:#8e8e93;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:16px;">Total views</div>
                <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:20px;padding-bottom:18px;border-bottom:1px solid rgba(255,255,255,0.07);">
                  <div>
                    <div style="font-size:1.75rem;font-weight:750;color:#ffffff;line-height:1.1;letter-spacing:-0.02em;">${totalViews.toLocaleString()}</div>
                    <div style="font-size:0.76rem;color:#8e8e93;margin-top:3px;font-weight:500;">Makes</div>
                  </div>
                  <div style="text-align:right;">
                    <div style="font-size:1.55rem;font-weight:750;color:#e8e8ed;line-height:1.1;letter-spacing:-0.02em;">${uploadsCount.toLocaleString()}</div>
                    <div style="font-size:0.76rem;color:#8e8e93;margin-top:3px;font-weight:500;">Uploads</div>
                  </div>
                </div>
                <button style="width:100%;display:flex;align-items:center;justify-content:center;gap:6px;padding:11px;border-radius:11px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.09);color:#f0f0f2;font-size:0.86rem;font-weight:600;cursor:pointer;transition:all 0.18s ease;">
                  View profile stats <span style="font-size:0.88rem;opacity:0.8;">↗</span>
                </button>
              </div>
            </div>

            <!-- Right Column: Makes / Uploads Tabs, Search, Sort & Song List -->
            <div>
              <!-- Pill Tabs -->
              <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,0.045);padding:4px;border-radius:11px;margin-bottom:16px;border:1px solid rgba(255,255,255,0.08);">
                <button id="profile-tab-makes" class="profile-tab-btn active" style="padding:6px 18px;border-radius:8px;background:rgba(255,255,255,0.12);color:#ffffff;border:none;font-size:0.85rem;font-weight:600;cursor:pointer;transition:all 0.15s ease;">
                  Makes <span style="background:rgba(255,255,255,0.2);padding:1px 7px;border-radius:999px;font-size:0.75rem;margin-left:4px;font-weight:600;">${makesCount}</span>
                </button>
                <button id="profile-tab-uploads" class="profile-tab-btn" style="padding:6px 18px;border-radius:8px;background:transparent;color:#8e8e93;border:none;font-size:0.85rem;font-weight:500;cursor:pointer;transition:all 0.15s ease;">
                  Uploads <span style="background:rgba(255,255,255,0.09);padding:1px 7px;border-radius:999px;font-size:0.75rem;margin-left:4px;font-weight:600;">${uploadsCount}</span>
                </button>
              </div>

              <!-- Search Filter and Sort Controls -->
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;position:relative;">
                <div style="flex:1;position:relative;">
                  <input type="text" id="profile-track-search" placeholder="Search title, artist, album, or paste a track link"
                    style="width:100%;box-sizing:border-box;padding:10px 14px 10px 38px;border-radius:11px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.09);color:#ffffff;font-size:0.88rem;outline:none;" />
                  <svg style="position:absolute;left:13px;top:50%;transform:translateY(-50%);color:#8e8e93;" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                </div>

                <!-- Sort Dropdown Trigger -->
                <div style="position:relative;" id="profile-sort-dropdown-wrap">
                  <button id="profile-sort-btn" style="display:flex;align-items:center;gap:7px;padding:9px 14px;border-radius:11px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.11);color:#ffffff;font-size:0.84rem;font-weight:600;cursor:pointer;white-space:nowrap;">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 15l5 5 5-5M7 9l5-5 5 5"/></svg>
                    <span>Sort: <b id="profile-current-sort-label">Views</b></span>
                    <span style="font-size:0.72rem;opacity:0.7;">⌵</span>
                  </button>

                  <!-- Sort Popover Menu -->
                  <div id="profile-sort-menu" style="display:none;position:absolute;right:0;top:calc(100% + 6px);width:160px;background:#242428;border:1px solid rgba(255,255,255,0.14);border-radius:12px;padding:6px;box-shadow:0 14px 35px rgba(0,0,0,0.6);z-index:100;backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);">
                    <div class="profile-sort-option active" data-sort="views" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-radius:8px;font-size:0.82rem;color:#ffffff;cursor:pointer;font-weight:600;">
                      <span>Views</span>
                      <span class="sort-check">✓</span>
                    </div>
                    <div class="profile-sort-option" data-sort="title" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-radius:8px;font-size:0.82rem;color:#8e8e93;cursor:pointer;">
                      <span>Title</span>
                      <span class="sort-check" style="display:none;">✓</span>
                    </div>
                    <div class="profile-sort-option" data-sort="artist" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-radius:8px;font-size:0.82rem;color:#8e8e93;cursor:pointer;">
                      <span>Artist</span>
                      <span class="sort-check" style="display:none;">✓</span>
                    </div>
                    <div class="profile-sort-option" data-sort="date" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-radius:8px;font-size:0.82rem;color:#8e8e93;cursor:pointer;">
                      <span>Upload date</span>
                      <span class="sort-check" style="display:none;">✓</span>
                    </div>
                    <div class="profile-sort-option" data-sort="length" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-radius:8px;font-size:0.82rem;color:#8e8e93;cursor:pointer;">
                      <span>Song length</span>
                      <span class="sort-check" style="display:none;">✓</span>
                    </div>
                  </div>
                </div>

                <!-- Sort Order Toggle Arrow (Ascending / Descending) -->
                <button id="profile-sort-dir-btn" title="Toggle Ascending / Descending" style="display:flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:11px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.11);color:#ffffff;font-size:0.95rem;cursor:pointer;flex-shrink:0;">
                  <span id="profile-sort-dir-arrow">↓</span>
                </button>
              </div>

              <!-- Songs List: Single IDs vs Dynamic Apple Music-Style Stacks -->
              <div id="profile-songs-list" style="display:flex;flex-direction:column;gap:12px;"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Active state trackers
    let activeTab = 'makes'; // 'makes' | 'uploads'
    let currentSort = 'views';
    let currentOrder = 'desc'; // 'asc' | 'desc'
    let searchQuery = '';

    function getActiveSongList() {
      return activeTab === 'makes' ? finalMakes : finalUploads;
    }

    function renderSongList() {
      const container = playlistViewContent.querySelector('#profile-songs-list');
      if (!container) return;

      let list = [...getActiveSongList()];

      // Filter by search query
      if (searchQuery) {
        list = list.filter(item => {
          const sId = (item && typeof item === 'object') ? (item.id || (item.ids && item.ids[0]) || '') : String(item);
          const sTitle = (item && typeof item === 'object') ? (item.title || item.name || `Track ${sId}`) : `Track ${sId}`;
          const sArtist = (item && typeof item === 'object') ? (item.artist || nickname) : nickname;
          const fullText = `${sTitle} ${sArtist} ${sId}`.toLowerCase();
          return fullText.includes(searchQuery);
        });
      }

      // Sort items
      list.sort((a, b) => {
        const idA = (a && typeof a === 'object') ? (a.id || (a.ids && a.ids[0]) || '') : String(a);
        const idB = (b && typeof b === 'object') ? (b.id || (b.ids && b.ids[0]) || '') : String(b);
        const viewsA = totalPlaysMap[idA] || (typeof a === 'object' && a.views) || 0;
        const viewsB = totalPlaysMap[idB] || (typeof b === 'object' && b.views) || 0;
        const titleA = (a && typeof a === 'object') ? (a.title || a.name || idA) : idA;
        const titleB = (b && typeof b === 'object') ? (b.title || b.name || idB) : idB;
        const artistA = (a && typeof a === 'object') ? (a.artist || nickname) : nickname;
        const artistB = (b && typeof b === 'object') ? (b.artist || nickname) : nickname;
        const dateA = (a && typeof a === 'object' && a.uploaded_at) ? a.uploaded_at : 0;
        const dateB = (b && typeof b === 'object' && b.uploaded_at) ? b.uploaded_at : 0;
        const durA = (a && typeof a === 'object' && a.duration) ? a.duration : 0;
        const durB = (b && typeof b === 'object' && b.duration) ? b.duration : 0;

        let comp = 0;
        if (currentSort === 'views') comp = Number(viewsA) - Number(viewsB);
        else if (currentSort === 'title') comp = titleA.localeCompare(titleB);
        else if (currentSort === 'artist') comp = artistA.localeCompare(artistB);
        else if (currentSort === 'date') comp = Number(dateA) - Number(dateB);
        else if (currentSort === 'length') comp = Number(durA) - Number(durB);

        return currentOrder === 'desc' ? -comp : comp;
      });

      if (list.length === 0) {
        container.innerHTML = `
          <div style="padding:48px 24px;text-align:center;color:#8e8e93;background:rgba(255,255,255,0.02);border-radius:14px;border:1px dashed rgba(255,255,255,0.08);">
            No songs found in ${activeTab === 'makes' ? 'Makes' : 'Uploads'}.
          </div>
        `;
        return;
      }

      container.innerHTML = list.map((songItem, idx) => {
        const isMulti = typeof songItem === 'object' && (songItem.single_upload === false || (Array.isArray(songItem.ids) && songItem.ids.length > 1));
        const bundledIds = isMulti ? (songItem.ids || [songItem.id]) : [];
        const variantCount = bundledIds.length || 1;
        const sId = isMulti ? bundledIds[0] : (typeof songItem === 'object' ? (songItem.id || songItem.song_id) : songItem);
        const sTitle = typeof songItem === 'object' ? (songItem.title || songItem.name || `Track ${sId}`) : `Track ${sId}`;
        const sArtist = typeof songItem === 'object' ? (songItem.artist || nickname) : nickname;
        const realPlays = totalPlaysMap[sId] || (typeof songItem === 'object' && songItem.views) || (totalViews ? Math.max(0, Math.floor(totalViews / (list.length || 1))) : 0);
        const sArt = typeof songItem === 'object' ? (songItem.art || 'favicon.svg') : 'favicon.svg';

        if (isMulti) {
          // Exactly 2 variants: 2-card offset stack (matching screenshot 2)
          // 3 or more variants: 3-card offset stack (matching screenshot 1)
          const isTwoCardStack = variantCount === 2;

          return `
            <div class="profile-multi-stack-container" data-song-id="${escapeHTML(sId)}" style="position:relative;margin-bottom:12px;">
              ${!isTwoCardStack ? `
                <!-- Underlay 3 (lowest layer for 3+ stacks) -->
                <div style="position:absolute;left:18px;right:18px;bottom:-10px;height:18px;background:#18181a;border:1px solid rgba(255,255,255,0.06);border-radius:14px;z-index:0;box-shadow:0 6px 16px rgba(0,0,0,0.45);"></div>
              ` : ''}
              
              <!-- Underlay 2 (middle layer for 3+ stacks, or bottom layer for 2 stacks) -->
              <div style="position:absolute;left:10px;right:10px;bottom:-5px;height:18px;background:#202024;border:1px solid rgba(255,255,255,0.09);border-radius:14px;z-index:1;box-shadow:0 4px 12px rgba(0,0,0,0.38);"></div>

              <!-- Main Foreground Card -->
              <div class="profile-song-card profile-stack-main" data-song-id="${escapeHTML(sId)}"
                style="position:relative;z-index:2;display:flex;align-items:center;gap:14px;padding:12px 18px;border-radius:14px;background:#2b2930;border:1px solid rgba(255,255,255,0.14);transition:all 0.18s ease;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,0.3);">
                <img src="${cleanArtworkUrl(sArt, 100, 100)}" alt="" style="width:48px;height:48px;border-radius:8px;object-fit:cover;background:#18181a;flex-shrink:0;" onerror="this.src='favicon.svg';" />
                <div style="flex:1;min-width:0;">
                  <div style="font-size:0.96rem;font-weight:700;color:#ffffff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-0.015em;">${escapeHTML(sTitle)}</div>
                  <div style="font-size:0.80rem;color:#a0a0a6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;">${escapeHTML(sArtist)}</div>
                </div>

                <div style="display:flex;align-items:center;gap:12px;flex-shrink:0;">
                  <!-- Variant Counter Pill -->
                  <div style="padding:4px 10px;border-radius:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);font-size:0.78rem;color:#f0f0f2;font-weight:650;">
                    ${variantCount} variants
                  </div>

                  <!-- Views Count Pill -->
                  <div style="display:flex;align-items:center;gap:5px;padding:4px 10px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);font-size:0.78rem;color:#d0d0d4;font-weight:550;">
                    <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    <span>${Number(realPlays).toLocaleString()}</span>
                  </div>

                  <!-- Listen Button -->
                  <button class="profile-listen-btn" data-song-id="${escapeHTML(sId)}" style="display:flex;align-items:center;gap:6px;padding:6px 14px;border-radius:8px;background:transparent;border:none;color:#ffffff;font-size:0.85rem;font-weight:600;cursor:pointer;">
                    <span>▷</span> Listen
                  </button>

                  <!-- Expand Arrow -->
                  <span class="profile-stack-arrow" style="font-size:0.85rem;color:#8e8e93;transition:transform 0.2s ease;">⌵</span>
                </div>
              </div>

              <!-- Click-to-Spread Drawer -->
              <div class="profile-stack-drawer hidden" style="display:none;padding:12px 14px;margin:8px 6px 0;background:rgba(0,0,0,0.45);border:1px solid rgba(255,255,255,0.08);border-radius:12px;">
                <div style="font-size:0.75rem;color:#8e8e93;text-transform:uppercase;margin-bottom:8px;font-weight:650;letter-spacing:0.04em;">All ${variantCount} Song IDs in this Stack:</div>
                <div style="display:flex;flex-direction:column;gap:6px;">
                  ${bundledIds.map(bid => `
                    <div class="profile-stack-item-row" data-song-id="${escapeHTML(bid)}" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);cursor:pointer;transition:all 0.15s ease;" onmouseover="this.style.background='rgba(255,255,255,0.09)';" onmouseout="this.style.background='rgba(255,255,255,0.04)';">
                      <div style="font-size:0.82rem;font-weight:600;color:#ffffff;">Track ID: ${escapeHTML(bid)}</div>
                      <button class="profile-listen-btn" data-song-id="${escapeHTML(bid)}" style="padding:4px 10px;border-radius:6px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.16);color:#ffffff;font-size:0.76rem;font-weight:600;cursor:pointer;">
                        ▶ Play ID
                      </button>
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>
          `;
        } else {
          // Standard Single ID Card (NO STACK)
          return `
            <div class="profile-song-card" data-song-id="${escapeHTML(sId)}" style="display:flex;align-items:center;gap:14px;padding:12px 18px;border-radius:14px;background:#2b2930;border:1px solid rgba(255,255,255,0.14);transition:all 0.18s ease;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,0.22);">
              <img src="${cleanArtworkUrl(sArt, 100, 100)}" alt="" style="width:48px;height:48px;border-radius:8px;object-fit:cover;background:#18181a;flex-shrink:0;" onerror="this.src='favicon.svg';" />
              <div style="flex:1;min-width:0;">
                <div style="font-size:0.96rem;font-weight:700;color:#ffffff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-0.015em;">${escapeHTML(sTitle)}</div>
                <div style="font-size:0.80rem;color:#a0a0a6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;">${escapeHTML(sArtist)} &bull; ID: ${escapeHTML(sId)}</div>
              </div>
              <div style="display:flex;align-items:center;gap:12px;flex-shrink:0;">
                <div style="display:flex;align-items:center;gap:5px;padding:4px 10px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);font-size:0.78rem;color:#d0d0d4;font-weight:550;">
                  <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  <span>${Number(realPlays).toLocaleString()}</span>
                </div>
                <button class="profile-listen-btn" data-song-id="${escapeHTML(sId)}" style="display:flex;align-items:center;gap:6px;padding:6px 14px;border-radius:8px;background:transparent;border:none;color:#ffffff;font-size:0.85rem;font-weight:600;cursor:pointer;">
                  <span>▷</span> Listen
                </button>
              </div>
            </div>
          `;
        }
      }).join('');

      // Click to spread / expand stacked variants
      container.querySelectorAll('.profile-stack-main').forEach(card => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('.profile-listen-btn')) return;
          const containerWrap = card.closest('.profile-multi-stack-container');
          if (containerWrap) {
            const drawer = containerWrap.querySelector('.profile-stack-drawer');
            const arrow = containerWrap.querySelector('.profile-stack-arrow');
            if (drawer) {
              const isHidden = drawer.style.display === 'none' || drawer.classList.contains('hidden');
              drawer.style.display = isHidden ? 'block' : 'none';
              drawer.classList.toggle('hidden', !isHidden);
              if (arrow) arrow.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
            }
          }
        });
      });

      // Hook listen buttons
      container.querySelectorAll('.profile-listen-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const sid = btn.dataset.songId;
          if (sid) {
            loadTrackById(sid);
          }
        });
      });

      // Hydrate song cards with real metadata (Title, Artist, Artwork, Duration) from Apple Music / iTunes
      hydrateProfileSongMetadata(container, list);
    }

    // Cache for track metadata in session to avoid duplicate lookups
    window._profileTrackMetaCache = window._profileTrackMetaCache || {};

    async function hydrateProfileSongMetadata(container, songList) {
      if (!container || !Array.isArray(songList) || songList.length === 0) return;

      const idsToFetch = [];
      songList.forEach(item => {
        const isMulti = typeof item === 'object' && (item.single_upload === false || (Array.isArray(item.ids) && item.ids.length > 1));
        const allIds = isMulti ? (item.ids || [item.id]) : [(typeof item === 'object' ? (item.id || item.song_id) : item)];
        allIds.forEach(id => {
          const sid = String(id).trim();
          if (sid && !window._profileTrackMetaCache[sid] && !idsToFetch.includes(sid)) {
            idsToFetch.push(sid);
          }
        });
      });

      // Apply any already cached metadata immediately
      applyCachedMetadataToDom(container);

      if (idsToFetch.length === 0) return;

      // Batch fetch up to 50 IDs at a time from iTunes lookup
      for (let i = 0; i < idsToFetch.length; i += 50) {
        const chunk = idsToFetch.slice(i, i + 50);
        try {
          const res = await fetch(`https://itunes.apple.com/lookup?id=${chunk.join(',')}`);
          if (res.ok) {
            const data = await res.json();
            (data.results || []).forEach(track => {
              if (track && track.trackId) {
                const art100 = track.artworkUrl100 || '';
                const art600 = art100 ? art100.replace('100x100', '600x600') : '';
                window._profileTrackMetaCache[String(track.trackId)] = {
                  title: track.trackName || '',
                  artist: track.artistName || '',
                  album: track.collectionName || '',
                  art: art600 || art100,
                  duration: track.trackTimeMillis || 0
                };
              }
            });
            applyCachedMetadataToDom(container);
          }
        } catch (err) {
          console.warn('[Profile] Metadata hydration fetch failed:', err);
        }
      }
    }

    function applyCachedMetadataToDom(container) {
      if (!container) return;
      Object.keys(window._profileTrackMetaCache).forEach(sid => {
        const meta = window._profileTrackMetaCache[sid];
        if (!meta) return;

        // Update single song cards matching this ID
        container.querySelectorAll(`.profile-song-card[data-song-id="${sid}"]`).forEach(card => {
          const titleEl = card.querySelector('div[style*="font-weight:700"]');
          if (titleEl && meta.title && titleEl.textContent.startsWith('Track ')) {
            titleEl.textContent = meta.title;
          }
          const artistEl = card.querySelector('div[style*="color:#a0a0a6"]');
          if (artistEl && meta.artist) {
            artistEl.innerHTML = `${escapeHTML(meta.artist)} &bull; ID: ${escapeHTML(sid)}`;
          }
          const imgEl = card.querySelector('img');
          if (imgEl && meta.art && (imgEl.src.includes('favicon.svg') || imgEl.src.includes('account_avatar.png'))) {
            imgEl.src = meta.art;
          }
        });

        // Update variant sub-items in stacked drawers
        container.querySelectorAll(`.profile-variant-item[data-song-id="${sid}"]`).forEach(item => {
          const titleEl = item.querySelector('div[style*="font-weight:600"]');
          if (titleEl && meta.title && titleEl.textContent.startsWith('Track ID:')) {
            titleEl.textContent = meta.title;
          }
          const subEl = item.querySelector('div[style*="font-size:0.75rem"]');
          if (subEl && meta.artist) {
            subEl.innerHTML = `${escapeHTML(meta.artist)} &bull; ID: ${escapeHTML(sid)}`;
          }
        });
      });
    }

    // Initialize list render
    renderSongList();

    // Tab switching (Makes vs Uploads)
    const tabMakes = playlistViewContent.querySelector('#profile-tab-makes');
    const tabUploads = playlistViewContent.querySelector('#profile-tab-uploads');

    if (tabMakes && tabUploads) {
      tabMakes.addEventListener('click', () => {
        if (activeTab === 'makes') return;
        activeTab = 'makes';
        tabMakes.classList.add('active');
        tabMakes.style.background = 'rgba(255,255,255,0.12)';
        tabMakes.style.color = '#ffffff';
        tabUploads.classList.remove('active');
        tabUploads.style.background = 'transparent';
        tabUploads.style.color = '#8e8e93';
        renderSongList();
      });

      tabUploads.addEventListener('click', () => {
        if (activeTab === 'uploads') return;
        activeTab = 'uploads';
        tabUploads.classList.add('active');
        tabUploads.style.background = 'rgba(255,255,255,0.12)';
        tabUploads.style.color = '#ffffff';
        tabMakes.classList.remove('active');
        tabMakes.style.background = 'transparent';
        tabMakes.style.color = '#8e8e93';
        renderSongList();
      });
    }

    // Sort Dropdown Popover
    const sortBtn = playlistViewContent.querySelector('#profile-sort-btn');
    const sortMenu = playlistViewContent.querySelector('#profile-sort-menu');
    const sortLabel = playlistViewContent.querySelector('#profile-current-sort-label');
    const sortDirBtn = playlistViewContent.querySelector('#profile-sort-dir-btn');
    const sortDirArrow = playlistViewContent.querySelector('#profile-sort-dir-arrow');

    if (sortBtn && sortMenu) {
      sortBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sortMenu.style.display = sortMenu.style.display === 'block' ? 'none' : 'block';
      });

      document.addEventListener('click', () => {
        if (sortMenu) sortMenu.style.display = 'none';
      });

      sortMenu.querySelectorAll('.profile-sort-option').forEach(opt => {
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          currentSort = opt.dataset.sort;
          sortMenu.querySelectorAll('.profile-sort-option').forEach(o => {
            o.classList.remove('active');
            o.style.color = '#8e8e93';
            const chk = o.querySelector('.sort-check');
            if (chk) chk.style.display = 'none';
          });
          opt.classList.add('active');
          opt.style.color = '#ffffff';
          const myChk = opt.querySelector('.sort-check');
          if (myChk) myChk.style.display = 'inline';

          if (sortLabel) {
            sortLabel.textContent = opt.querySelector('span').textContent;
          }
          sortMenu.style.display = 'none';
          renderSongList();
        });
      });
    }

    // Sort Order Direction Arrow (Ascending / Descending)
    if (sortDirBtn && sortDirArrow) {
      sortDirBtn.addEventListener('click', () => {
        currentOrder = currentOrder === 'desc' ? 'asc' : 'desc';
        sortDirArrow.textContent = currentOrder === 'desc' ? '↓' : '↑';
        renderSongList();
      });
    }

    // Search filter input
    const searchInput = playlistViewContent.querySelector('#profile-track-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase().trim();
        renderSongList();
      });
    }
  }

  // ── URL Routing for /album, /artist, /label, /playlist, /curator, /video, /search, /home, /song ──
  function checkUrlRouting() {
    const rawHash = (window.location.hash || '').replace(/^#\/?/, '');
    const [hashPath, hashQuery] = rawHash.split('?');

    // Prefer hash route if present; otherwise fall back to pathname
    let path = '';
    let search = '';
    if (hashPath) {
      path = '/' + hashPath;
      search = hashQuery ? `?${hashQuery}` : '';
    } else {
      path = window.location.pathname || '';
      search = window.location.search || '';
    }
    const urlParams = new URLSearchParams(search);

    // 0. Check GitHub Pages SPA redirection param (?p=... or sessionStorage)
    const spaParam = urlParams.get('p') || sessionStorage.getItem('spa_redirect_path');
    if (spaParam) {
      sessionStorage.removeItem('spa_redirect_path');
      const restored = decodeURIComponent(spaParam).replace(/^\/?/, '/');
      const extraQuery = urlParams.get('q') ? '?' + decodeURIComponent(urlParams.get('q')) : '';
      path = restored;
      search = extraQuery;
      try {
        window.history.replaceState(null, '', path + search);
      } catch (_) { }
    }

    // 1. Check entity routes: /label/[slug]/[id], /album/[slug]/[id], /artist/[slug]/[id], /playlist/[slug]/[id], /curator/[slug]/[id], /video/[slug]/[id]
    // Record Label: /label/[slug]/[id] or /label/[id]
    const labelMatch = path.match(/^\/label\/(?:([^/]+)\/)?([^/?#]+)/i);
    if (labelMatch) {
      const slugName = labelMatch[1] ? decodeURIComponent(labelMatch[1]).replace(/-/g, ' ') : '';
      const labelId = labelMatch[2];
      showRecordLabelView(labelId, slugName, { skipUrlSync: true });
      return true;
    }

    // Album: /album/[slug]/[id] or /album/[id] (with optional ?i=[trackId])
    const albumMatch = path.match(/^\/album\/(?:([^/]+)\/)?(\d+)/i);
    if (albumMatch) {
      const slugName = albumMatch[1] ? decodeURIComponent(albumMatch[1]).replace(/-/g, ' ') : '';
      const albumId = albumMatch[2];
      const trackId = urlParams.get('i') || null;
      showAlbumView(albumId, slugName, trackId, { skipUrlSync: true });
      return true;
    }

    // Artist: /artist/[slug]/[id] or /artist/[id]
    const artistMatch = path.match(/^\/artist\/(?:([^/]+)\/)?([^/?#]+)/i);
    if (artistMatch) {
      const slugName = artistMatch[1] ? decodeURIComponent(artistMatch[1]).replace(/-/g, ' ') : '';
      const artistId = artistMatch[2];
      showArtistView(artistId, slugName, { skipUrlSync: true });
      return true;
    }

    // Playlist: /playlist/[slug]/[id] or /playlist/[id]
    const playlistMatch = path.match(/^\/playlist\/(?:([^/]+)\/)?([^/?#]+)/i);
    if (playlistMatch) {
      const slugName = playlistMatch[1] ? decodeURIComponent(playlistMatch[1]).replace(/-/g, ' ') : '';
      const playlistId = playlistMatch[2];
      showRemotePlaylistView(playlistId, slugName, { skipUrlSync: true });
      return true;
    }

    // Curator: /curator/[slug]/[id] or /curator/[id]
    const curatorMatch = path.match(/^\/curator\/(?:([^/]+)\/)?([^/?#]+)/i);
    if (curatorMatch) {
      const slugName = curatorMatch[1] ? decodeURIComponent(curatorMatch[1]).replace(/-/g, ' ') : '';
      const curatorId = curatorMatch[2];
      showCuratorView(curatorId, slugName, { skipUrlSync: true });
      return true;
    }

    // Music Video: /video/[slug]/[id] or /video/[id]
    const videoMatch = path.match(/^\/video\/(?:([^/]+)\/)?(\d+)/i);
    if (videoMatch) {
      const slugName = videoMatch[1] ? decodeURIComponent(videoMatch[1]).replace(/-/g, ' ') : '';
      const videoId = videoMatch[2];
      playMusicVideo(videoId, slugName, '', { skipUrlSync: true });
      return true;
    }

    // Song: /song/[slug]/[id] or /song/[id]
    const songRouteMatch = path.match(/^\/song\/(?:([^/]+)\/)?(\d+)/i);
    if (songRouteMatch) {
      const slugName = songRouteMatch[1] ? decodeURIComponent(songRouteMatch[1]).replace(/-/g, ' ') : '';
      const songId = songRouteMatch[2];
      showSongView(songId, slugName, { skipUrlSync: true });
      return true;
    }

    // 2. Check top-level page routes: /home, /search, /upload, /playlists, /recently-added, /library, /recently-listened
    const cleanPath = path.replace(/\/+$/, '').toLowerCase();
    if (cleanPath === '/home') {
      switchPage('home', { skipUrlSync: true });
      return true;
    }
    if (cleanPath === '/new') {
      switchPage('new', { skipUrlSync: true });
      return true;
    }
    if (cleanPath === '/search') {
      const q = urlParams.get('q') || urlParams.get('query') || '';
      switchPage('listen', { skipUrlSync: true });
      if (q && catalogSearch) {
        catalogSearch.value = q;
        if (searchClearBtn) searchClearBtn.classList.remove('hidden');
        performCatalogSearch(q, { skipUrlSync: true });
      }
      return true;
    }
    if (cleanPath === '/upload') {
      switchPage('upload', { skipUrlSync: true });
      return true;
    }
    if (cleanPath === '/download') {
      switchPage('download-song', { skipUrlSync: true });
      return true;
    }
    if (cleanPath === '/download/ttml') {
      switchPage('download-ttml', { skipUrlSync: true });
      return true;
    }
    if (cleanPath === '/playlists') {
      switchPage('playlists', { skipUrlSync: true });
      return true;
    }
    if (cleanPath === '/recently-added') {
      switchPage('recently-added', { skipUrlSync: true });
      return true;
    }
    if (cleanPath === '/library') {
      switchPage('library-hub', { skipUrlSync: true });
      return true;
    }
    if (cleanPath === '/library/artists') {
      switchPage('library-artists', { skipUrlSync: true });
      return true;
    }
    if (cleanPath === '/library/albums') {
      switchPage('library-albums', { skipUrlSync: true });
      return true;
    }
    if (cleanPath === '/library/songs') {
      switchPage('songs', { skipUrlSync: true });
      return true;
    }
    if (cleanPath === '/recently-listened') {
      switchPage('recent', { skipUrlSync: true });
      return true;
    }

    // 3. Backwards-compatibility: Check query params ?song=123 or ?id=123
    const querySongId = urlParams.get('song') || urlParams.get('id');
    if (querySongId && /^\d+$/.test(querySongId)) {
      loadTrackById(querySongId);
      return true;
    }

    // 4. Check song route or bare ID: /song/12345 or #12345
    const pathMatch = path.match(/\/song\/(\d+)/i);
    if (pathMatch) {
      showSongView(pathMatch[1], '', { skipUrlSync: true });
      return true;
    }
    const numMatch = (window.location.hash || '').match(/\d{5,}/);
    if (numMatch) {
      showSongView(numMatch[0], '', { skipUrlSync: true });
      return true;
    }

    // 5. Community Profile Route: /@username, /user/username, or /slug
    const profileMatch = path.match(/^\/(?:@|user\/)?([a-zA-Z0-9_\-]+)\/?$/i);
    if (profileMatch) {
      const slug = profileMatch[1];
      const reservedSlugs = [
        'home', 'search', 'upload', 'playlists', 'recently-added',
        'library', 'recently-listened', 'album', 'artist', 'playlist',
        'song', 'label', 'curator', 'video', 'player', 'index', 'proxy', 'api', 'player.html'
      ];
      if (!reservedSlugs.includes(slug.toLowerCase())) {
        showCommunityProfileView(slug, { skipUrlSync: true });
        return true;
      }
    }

    return false;
  }

  window.addEventListener('hashchange', checkUrlRouting);
  window.addEventListener('popstate', () => {
    isHandlingPopState = true;
    checkUrlRouting();
    isHandlingPopState = false;
  });

  // ── Context Menu (Desktop Dropdown & Mobile 76% Centered Modal) ──
  function showContextMenu(e, song) {
    if (!song) return;
    const normalizedSong = {
      trackId: song.trackId || song.id || song.amTrackId,
      id: song.id || song.trackId || song.amTrackId,
      trackName: song.trackName || song.title || song.name || 'Song',
      name: song.name || song.trackName || song.title || 'Song',
      artistName: song.artistName || song.artist || '',
      artist: song.artist || song.artistName || '',
      collectionName: song.collectionName || song.album || '',
      album: song.album || song.collectionName || '',
      albumId: song.albumId || null,
      artistId: song.artistId || null,
      artworkUrl100: song.artworkUrl100 || song.artUrl || '',
      artUrl: song.artUrl || song.artworkUrl100 || '',
      previewUrl: song.previewUrl || ''
    };
    contextMenuTrack = normalizedSong;
    const isMobile = window.innerWidth <= 768;

    if (isMobile && mobileContextModal) {
      // Mobile 76% Centered Modal
      if (mobModalArt) mobModalArt.src = cleanArtworkUrl(normalizedSong.artworkUrl100 || normalizedSong.artUrl, 300, 300);
      if (mobModalTitle) mobModalTitle.textContent = normalizedSong.trackName;
      if (mobModalSub) mobModalSub.textContent = normalizedSong.artistName;

      const inLib = isSongInLibrary(normalizedSong.trackId);
      if (mobCtxLibLabel) mobCtxLibLabel.textContent = inLib ? t('ctx_in_library') : t('ctx_add_library');

      mobileContextModal.classList.remove('hidden');

    } else if (songContextMenu) {
      // Desktop Floating Context Menu
      const inLib = isSongInLibrary(normalizedSong.trackId);
      if (ctxAddLib) ctxAddLib.textContent = inLib ? t('ctx_in_library') : t('ctx_add_library');

      let clientX = e.clientX || e.pageX || 100;
      let clientY = e.clientY || e.pageY || 100;
      
      // Calculate top so that if clicked near bottom (e.g. from the mini-player), it pops upwards
      const menuHeight = 240;
      let top = clientY;
      if (clientY + menuHeight > window.innerHeight - 20) {
        top = Math.max(12, clientY - menuHeight);
      }
      
      songContextMenu.style.left = `${Math.min(clientX, window.innerWidth - 220)}px`;
      songContextMenu.style.top = `${top}px`;
      songContextMenu.classList.remove('hidden');
    }
  }

  // Expose globally for mini preview-player & other components
  window.showContextMenu = showContextMenu;

  function hideContextMenu() {
    if (songContextMenu) songContextMenu.classList.add('hidden');
    if (mobileContextModal) mobileContextModal.classList.add('hidden');
  }

  document.addEventListener('click', (e) => {
    if (songContextMenu && !songContextMenu.contains(e.target) && !e.target.classList.contains('am-song-more-btn') && !e.target.classList.contains('am-card-3dots-btn') && !e.target.classList.contains('am-preview-lcd-more-btn')) {
      songContextMenu.classList.add('hidden');
    }
    if (mobileContextModal && e.target === mobileContextModal) {
      mobileContextModal.classList.add('hidden');
    }
  });

  if (mobModalCloseBtn) {
    mobModalCloseBtn.onclick = hideContextMenu;
  }

  // Context Actions Handler
  const handleCtxPlay = () => {
    if (!contextMenuTrack) return;
    hideContextMenu();
    loadRemoteTrack(contextMenuTrack);
  };

  const handleCtxAddLib = () => {
    if (!contextMenuTrack) return;
    const songId = contextMenuTrack.trackId || contextMenuTrack.id;
    if (isSongInLibrary(songId)) {
      removeSongFromLibrary(songId);
      showToast({ message: t('ctx_removed_from_lib') });
    } else {
      addSongToLibrary(contextMenuTrack);
      showToast({ message: t('ctx_added_to_lib') });
    }
    hideContextMenu();
  };

  const handleCtxAddPlaylist = async () => {
    if (!contextMenuTrack) return;
    hideContextMenu();
    openPlaylistModal(contextMenuTrack);
  };

  // Direct Show Album Handler (Never falls back to plain search)
  const handleCtxViewAlbum = async () => {
    if (!contextMenuTrack) return;
    hideContextMenu();

    let albId = contextMenuTrack.albumId;

    // Resolve authentic albumId via spicyamll song lookup API if not directly present
    if (!albId && (contextMenuTrack.trackId || contextMenuTrack.id)) {
      const sId = contextMenuTrack.trackId || contextMenuTrack.id;
      try {
        const res = await fetch(`${API_BASE}/v1/catalog/kz/songs/${sId}?art[url]=f&fields[albums]=name,url&format[resources]=map&include=albums&l=en-GB&platform=web`);
        if (res.ok) {
          const data = await res.json();
          const sObj = data.resources?.songs?.[String(sId)] || data.data?.[0];
          const albRel = sObj?.relationships?.albums?.data?.[0];
          albId = albRel?.id || sObj?.attributes?.url?.match(/\/album\/[^/]+\/(\d+)/)?.[1];
          if (albId && !contextMenuTrack.collectionName) {
            contextMenuTrack.collectionName = data.resources?.albums?.[albId]?.attributes?.name || sObj?.attributes?.albumName;
          }
        }
      } catch (e) { }
    }

    // Resolve albumId via direct album search lookup only if song API failed
    if (!albId && contextMenuTrack.collectionName) {
      try {
        const searchQuery = contextMenuTrack.artistName ? `${contextMenuTrack.artistName} ${contextMenuTrack.collectionName}` : contextMenuTrack.collectionName;
        const aRes = await fetch(`${API_BASE}/search?term=${encodeURIComponent(searchQuery)}&types=albums&limit=5&l=${getCurrentLang()}`);
        if (aRes.ok) {
          const aData = await aRes.json();
          const found = aData.results?.albums?.data?.[0];
          if (found) albId = found.id;
        }
      } catch (e) { }
    }

    if (albId) {
      showAlbumView(albId);
    } else if (contextMenuTrack.collectionName) {
      switchPage('listen');
      catalogSearch.value = contextMenuTrack.collectionName;
      performCatalogSearch(contextMenuTrack.collectionName);
    }
  };

  // Direct Show Artist Handler (Always opens Artist Profile View directly)
  const handleCtxViewArtist = async () => {
    if (!contextMenuTrack) return;
    hideContextMenu();

    let artId = contextMenuTrack.artistId;
    let artName = contextMenuTrack.artistName || contextMenuTrack.artist || '';

    if (!artId && (contextMenuTrack.trackId || contextMenuTrack.id)) {
      const sId = contextMenuTrack.trackId || contextMenuTrack.id;
      try {
        const res = await fetch(`${API_BASE}/song?song=${sId}&l=${getCurrentLang()}`);
        if (res.ok) {
          const data = await res.json();
          const sObj = data.data?.[0] || data.results?.songs?.data?.[0];
          artId = sObj?.relationships?.artists?.data?.[0]?.id;
          if (!artName) artName = sObj?.attributes?.artistName || '';
        }
      } catch (e) { }
    }

    if (!artId && artName) {
      try {
        const artRes = await fetch(`${API_BASE}/search?term=${encodeURIComponent(artName)}&limit=10&l=${getCurrentLang()}`);
        if (artRes.ok) {
          const artData = await artRes.json();
          const found = artData.results?.artists?.data?.[0] || artData.results?.top?.data?.find(x => x.type === 'artists');
          if (found) {
            artId = found.id;
            artName = found.attributes?.name || artName;
          }
        }
      } catch (e) { }
    }

    showArtistView(artId || artName, artName || t('badge_artist'));
  };

  const handleCtxFavorite = async () => {
    if (!contextMenuTrack) return;
    hideContextMenu();
    const playlists = await getPlaylists();
    let favPlaylist = playlists.find(p => p.name === 'Favorites');
    if (!favPlaylist) {
      const favId = await createPlaylist('Favorites', 'icons/favorites-playlist.png');
      favPlaylist = { id: favId, name: 'Favorites', coverUrl: 'icons/favorites-playlist.png' };
    }
    await addTrackToPlaylist(favPlaylist.id, {
      name: contextMenuTrack.trackName || contextMenuTrack.name,
      artist: contextMenuTrack.artistName || contextMenuTrack.artist,
      album: contextMenuTrack.collectionName || contextMenuTrack.album,
      albumId: contextMenuTrack.albumId || null,
      artistId: contextMenuTrack.artistId || null,
      artUrl: cleanArtworkUrl(contextMenuTrack.artworkUrl100 || contextMenuTrack.artUrl, 600, 600),
      amTrackId: contextMenuTrack.trackId || contextMenuTrack.id
    }, null);
    showToast({ message: t('favorites_added') });
  };

  const handleCtxCopyId = () => {
    if (!contextMenuTrack) return;
    hideContextMenu();
    const id = contextMenuTrack.trackId || contextMenuTrack.id || '';
    if (id) {
      navigator.clipboard.writeText(String(id));
      showToast({ message: t('ctx_id_copied') });
    }
  };

  const handleCtxShare = () => {
    if (!contextMenuTrack) return;
    hideContextMenu();
    const songId = contextMenuTrack.trackId || contextMenuTrack.id || '';
    const title = contextMenuTrack.trackName || contextMenuTrack.name || 'Song';
    const artist = contextMenuTrack.artistName || contextMenuTrack.artist || 'Artist';
    const album = contextMenuTrack.collectionName || contextMenuTrack.album || '';
    const albumId = contextMenuTrack.albumId;
    let url = `/song/${songId}`;
    if (albumId) {
      url = `/album/${toSlug(album)}/${albumId}?i=${songId}`;
    }
    shareEntity({
      title: `${title} - ${artist}`,
      text: `Listen to "${title}" by ${artist} on Lyricsflow`,
      url: url
    });
  };

  const ctxShare = document.getElementById('ctx-share');
  const mobCtxShare = document.getElementById('mob-ctx-share');

  // Wire desktop context menu items
  if (ctxPlay) ctxPlay.onclick = handleCtxPlay;
  if (ctxAddLib) ctxAddLib.onclick = handleCtxAddLib;
  if (ctxAddPlaylist) ctxAddPlaylist.onclick = handleCtxAddPlaylist;
  if (ctxViewAlbum) ctxViewAlbum.onclick = handleCtxViewAlbum;
  if (ctxViewArtist) ctxViewArtist.onclick = handleCtxViewArtist;
  if (ctxFavorite) ctxFavorite.onclick = handleCtxFavorite;
  if (ctxShare) ctxShare.onclick = handleCtxShare;
  if (ctxCopyId) ctxCopyId.onclick = handleCtxCopyId;

  // Wire mobile context modal items
  if (mobCtxPlay) mobCtxPlay.onclick = handleCtxPlay;
  if (mobCtxAddLib) mobCtxAddLib.onclick = handleCtxAddLib;
  if (mobCtxAddPlaylist) mobCtxAddPlaylist.onclick = handleCtxAddPlaylist;
  if (mobCtxViewAlbum) mobCtxViewAlbum.onclick = handleCtxViewAlbum;
  if (mobCtxViewArtist) mobCtxViewArtist.onclick = handleCtxViewArtist;
  if (mobCtxFavorite) mobCtxFavorite.onclick = handleCtxFavorite;
  if (mobCtxShare) mobCtxShare.onclick = handleCtxShare;
  if (mobCtxCopyId) mobCtxCopyId.onclick = handleCtxCopyId;

  // ── Playlist Selection Modal ──
  async function openPlaylistModal(track) {
    if (!playlistModal) return;
    playlistModal.classList.remove('hidden');
    playlistOptionsList.innerHTML = `<div class="am-loading-msg">${t('loading_playlists')}</div>`;

    const playlists = await getPlaylists();
    const customPlaylists = playlists.filter(p => p.name !== 'Favorites');

    if (customPlaylists.length === 0) {
      playlistOptionsList.innerHTML = `<p class="am-empty-msg">${t('playlists_empty')}</p>`;
    } else {
      playlistOptionsList.innerHTML = customPlaylists.map(p => `
        <div class="playlist-option-item" data-id="${p.id}" style="padding:10px;border-radius:8px;cursor:pointer;display:flex;align-items:center;gap:10px;background:rgba(255,255,255,0.05);margin-bottom:8px;">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M4 10h12v2H4v-2zm0-4h12v2H4V6zm0 8h8v2H4v-2zm10 0v6l5-3-5-3z"/></svg>
          <span style="font-weight:600;">${escapeHTML(p.name)}</span>
        </div>
      `).join('');

      playlistOptionsList.querySelectorAll('.playlist-option-item').forEach(el => {
        el.onclick = async () => {
          const pId = parseInt(el.dataset.id, 10);
          await addTrackToPlaylist(pId, {
            name: track.trackName || track.name,
            artist: track.artistName || track.artist,
            album: track.collectionName || track.album,
            albumId: track.albumId || null,
            artistId: track.artistId || null,
            artUrl: cleanArtworkUrl(track.artworkUrl100 || track.artUrl, 600, 600),
            amTrackId: track.trackId || track.id
          }, null);
          playlistModal.classList.add('hidden');
          updateSidebarPlaylists();
          showToast({ message: t('playlist_added_track') });
        };
      });
    }
  }

  if (closePlaylistModal) {
    closePlaylistModal.onclick = () => playlistModal.classList.add('hidden');
  }

  if (modalCreatePlaylistBtn) {
    modalCreatePlaylistBtn.onclick = async () => {
      const name = prompt(t('prompt_enter_playlist_name'));
      if (name && name.trim()) {
        const id = await createPlaylist(name.trim());
        updateSidebarPlaylists();
        if (contextMenuTrack) {
          await addTrackToPlaylist(id, {
            name: contextMenuTrack.trackName || contextMenuTrack.name,
            artist: contextMenuTrack.artistName || contextMenuTrack.artist,
            album: contextMenuTrack.collectionName || contextMenuTrack.album,
            albumId: contextMenuTrack.albumId || null,
            artistId: contextMenuTrack.artistId || null,
            artUrl: cleanArtworkUrl(contextMenuTrack.artworkUrl100 || contextMenuTrack.artUrl, 600, 600),
            amTrackId: contextMenuTrack.trackId || contextMenuTrack.id
          }, null);
          showToast({ message: t('playlist_added_track') });
        }
        playlistModal.classList.add('hidden');
      }
    };
  }

  // ── Playlists View (User Playlists - All Playlists Grid Screenshot 2) ──
  async function renderPlaylistsPage() {
    if (!playlistsGrid) return;
    playlistDetail.classList.add('hidden');
    playlistsGrid.classList.remove('hidden');
    playlistsGrid.innerHTML = `<div class="am-loading-msg">${t('loading_playlists')}</div>`;

    const playlists = await getPlaylists();
    const displayList = playlists.filter(p => p.name !== 'Favorites');

    if (displayList.length === 0) {
      playlistsGrid.innerHTML = `<div class="am-error-msg">${t('playlists_empty')}</div>`;
      return;
    }

    const cardsHTML = await Promise.all(displayList.map(async p => {
      const tracks = await getPlaylistTracks(p.id);
      const firstArt = p.coverUrl || tracks[0]?.artUrl || 'favicon.svg';
      return `
        <div class="am-playlist-card animate-fade" data-id="${p.id}">
          <div class="am-playlist-card-art-wrap">
            <img src="${cleanArtworkUrl(firstArt, 500, 500)}" loading="lazy" referrerpolicy="no-referrer" class="am-playlist-card-art" alt="${escapeHTML(p.name)}">
            <button class="am-playlist-card-play-hover" data-id="${p.id}" title="Play">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </button>
          </div>
          <div class="am-playlist-card-title">${escapeHTML(p.name)}</div>
          <div class="am-playlist-card-curator">Apple Music</div>
          <button class="playlist-delete-btn" data-id="${p.id}" title="Delete Playlist">✕</button>
        </div>
      `;
    }));

    playlistsGrid.className = 'am-playlists-grid';
    playlistsGrid.innerHTML = cardsHTML.join('');

    playlistsGrid.querySelectorAll('.am-playlist-card').forEach(card => {
      card.onclick = (e) => {
        const pId = parseInt(card.dataset.id, 10);
        if (e.target.closest('.playlist-delete-btn')) {
          e.stopPropagation();
          if (confirm(t('prompt_confirm_delete_playlist'))) {
            deletePlaylist(pId).then(() => {
              renderPlaylistsPage();
              updateSidebarPlaylists();
            });
          }
          return;
        }
        if (e.target.closest('.am-playlist-card-play-hover')) {
          e.stopPropagation();
          getPlaylistTracks(pId).then(tracks => {
            if (tracks.length > 0) {
              queueContextualWithSimilar({
                trackId: tracks[0].amTrackId || tracks[0].id,
                trackName: tracks[0].name || tracks[0].title,
                artistName: tracks[0].artist,
                collectionName: tracks[0].album || 'Playlist',
                artworkUrl100: cleanArtworkUrl(tracks[0].artUrl, 100, 100)
              }, tracks.map(t => ({
                id: t.amTrackId || t.id,
                title: t.name || t.title,
                artist: t.artist,
                album: t.album,
                artUrl: t.artUrl,
                durationMs: 180000
              })), 0);
            }
          });
          return;
        }
        openLocalPlaylistDetail(pId);
      };
    });
  }

  async function openLocalPlaylistDetail(playlistId) {
    playlistsGrid.classList.add('hidden');
    playlistDetail.classList.remove('hidden');

    const playlists = await getPlaylists();
    const playlist = playlists.find(p => p.id === playlistId);
    const plName = playlist?.name || 'Playlist';

    const tracks = await getPlaylistTracks(playlistId);
    const firstArt = playlist?.coverUrl || tracks[0]?.artUrl || 'favicon.svg';

    playlistDetail.innerHTML = `
      <div class="am-playlist-detail-header">
        <button class="am-back-btn" id="local-playlist-back-btn" style="position:absolute;top:10px;left:10px;z-index:10;background:rgba(255,255,255,0.08);color:#fff;border:none;border-radius:20px;padding:6px 14px;cursor:pointer;">← Back</button>
        <div class="am-playlist-detail-art-wrap">
          <img src="${cleanArtworkUrl(firstArt, 600, 600)}" class="am-playlist-detail-art" alt="">
        </div>
        <div class="am-playlist-detail-info">
          <h1 class="am-playlist-detail-title">${escapeHTML(plName)}</h1>
          <a class="am-playlist-detail-curator" href="javascript:void(0)">Apple Music</a>
          <div class="am-playlist-detail-meta">Updated Monday • ${tracks.length} songs</div>
          <p class="am-playlist-detail-desc">All your favorite tracks in one playlist.</p>
          <div class="am-playlist-detail-actions">
            <button class="am-playlist-action-pill" id="local-pl-shuffle-btn">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
              <span>Shuffle</span>
            </button>
            <button class="am-playlist-action-pill primary" id="local-pl-play-btn">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              <span>Play</span>
            </button>
            <button class="am-playlist-action-pill" id="local-pl-added-btn">
              <span>✓ Added</span>
            </button>
          </div>
        </div>
      </div>

      <div class="am-tracklist-table-header">
        <div style="flex: 2;">Song</div>
        <div style="flex: 1.5;">Artist</div>
        <div style="flex: 1.5;">Album</div>
        <div style="width: 70px; text-align: right;">Time</div>
        <div style="width: 40px; text-align: center;"></div>
      </div>

      <div class="am-tracklist" id="local-pl-tracks-list">
        ${tracks.length === 0 ? `<p class="am-empty-msg">${t('playlists_empty_tracks')}</p>` : tracks.map((t, idx) => `
          <div class="am-track-row" data-id="${t.id}" data-idx="${idx}">
            <div class="am-track-num">${idx + 1}</div>
            <img src="${cleanArtworkUrl(t.artUrl || t.artworkUrl100, 60, 60)}" class="am-song-row-art" loading="lazy" alt="">
            <div class="am-track-info">
              <div class="am-track-title">${escapeHTML(t.name || t.title || 'Track')}</div>
              <div class="am-track-sub">${escapeHTML(t.artist || '')}</div>
            </div>
            <div style="flex: 1.5; color: rgba(255,255,255,0.7); font-size: 0.9rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHTML(t.album || '')}</div>
            <div class="am-track-duration">3:30</div>
            <button class="am-song-more-btn" data-id="${t.id}">•••</button>
          </div>
        `).join('')}
      </div>

      <!-- Suggested Songs Box -->
      <div class="am-suggested-songs-box">
        <div class="am-suggested-header">
          <div>
            <h3 class="am-suggested-title">Suggested Songs</h3>
            <p class="am-suggested-sub">Based on the music in this playlist</p>
          </div>
          <button class="am-suggested-refresh-btn" id="local-suggested-refresh-btn">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
            <span>Refresh</span>
          </button>
        </div>
        <div class="am-suggested-list" id="local-suggested-songs-list">
          <div class="am-loading-msg">${t('loading')}</div>
        </div>
      </div>
    `;

    const backBtn = playlistDetail.querySelector('#local-playlist-back-btn');
    if (backBtn) backBtn.onclick = () => renderPlaylistsPage();

    const playBtn = playlistDetail.querySelector('#local-pl-play-btn');
    if (playBtn && tracks.length > 0) {
      playBtn.onclick = () => {
        queueContextualWithSimilar({
          trackId: tracks[0].amTrackId || tracks[0].id,
          trackName: tracks[0].name || tracks[0].title,
          artistName: tracks[0].artist,
          collectionName: tracks[0].album || plName,
          artworkUrl100: cleanArtworkUrl(tracks[0].artUrl, 100, 100)
        }, tracks.map(t => ({
          id: t.amTrackId || t.id,
          title: t.name || t.title,
          artist: t.artist,
          album: t.album,
          artUrl: t.artUrl,
          durationMs: 180000
        })), 0);
      };
    }

    const shuffleBtn = playlistDetail.querySelector('#local-pl-shuffle-btn');
    if (shuffleBtn && tracks.length > 0) {
      shuffleBtn.onclick = () => {
        const randIdx = Math.floor(Math.random() * tracks.length);
        const tr = tracks[randIdx];
        queueContextualWithSimilar({
          trackId: tr.amTrackId || tr.id,
          trackName: tr.name || tr.title,
          artistName: tr.artist,
          collectionName: tr.album || plName,
          artworkUrl100: cleanArtworkUrl(tr.artUrl, 100, 100)
        }, tracks.map(t => ({
          id: t.amTrackId || t.id,
          title: t.name || t.title,
          artist: t.artist,
          album: t.album,
          artUrl: t.artUrl,
          durationMs: 180000
        })), randIdx);
      };
    }

    playlistDetail.querySelectorAll('#local-pl-tracks-list .am-track-row').forEach(row => {
      row.onclick = (e) => {
        const idx = parseInt(row.dataset.idx, 10);
        const tr = tracks[idx];
        if (!tr) return;
        queueContextualWithSimilar({
          trackId: tr.amTrackId || tr.id,
          trackName: tr.name || tr.title,
          artistName: tr.artist,
          collectionName: tr.album || plName,
          artworkUrl100: cleanArtworkUrl(tr.artUrl, 100, 100)
        }, tracks.map(t => ({
          id: t.amTrackId || t.id,
          title: t.name || t.title,
          artist: t.artist,
          album: t.album,
          artUrl: t.artUrl,
          durationMs: 180000
        })), idx);
      };
    });

    // Local suggested songs loader
    const loadLocalSuggestions = async () => {
      const box = playlistDetail.querySelector('#local-suggested-songs-list');
      if (!box) return;
      box.innerHTML = `<div class="am-loading-msg">${t('loading')}</div>`;
      try {
        const sampleArtist = tracks[0]?.artist || 'Taylor Swift';
        const sRes = await fetch(`${API_BASE}/search?term=${encodeURIComponent(sampleArtist)}&types=songs&limit=10&l=en-US`);
        if (sRes.ok) {
          const sData = await sRes.json();
          const sSongs = sData.results?.songs?.data || [];
          const existingIds = new Set(tracks.map(t => String(t.amTrackId || t.id)));
          const filtered = sSongs.filter(s => !existingIds.has(String(s.id))).slice(0, 6);
          if (filtered.length === 0) {
            box.innerHTML = `<p class="am-empty-msg">No suggestions found.</p>`;
            return;
          }
          box.innerHTML = filtered.map(s => {
            const a = s.attributes || {};
            const art = cleanArtworkUrl(a.artwork?.url, 100, 100);
            return `
              <div class="am-suggested-song-row" data-id="${s.id}">
                <img src="${art}" class="am-suggested-art" loading="lazy" alt="">
                <div class="am-suggested-info">
                  <div class="am-suggested-title">${escapeHTML(a.name || 'Song')}</div>
                  <div class="am-suggested-artist">${escapeHTML(a.artistName || '')}</div>
                </div>
                <button class="am-suggested-add-btn" data-id="${s.id}" title="Add to Playlist">+</button>
              </div>
            `;
          }).join('');

          box.querySelectorAll('.am-suggested-song-row').forEach(sRow => {
            sRow.onclick = async (e) => {
              const sId = sRow.dataset.id;
              if (e.target.closest('.am-suggested-add-btn')) {
                e.stopPropagation();
                const songObj = filtered.find(x => String(x.id) === String(sId));
                if (songObj) {
                  const sAttr = songObj.attributes || {};
                  await addTrackToPlaylist(playlistId, {
                    name: sAttr.name,
                    artist: sAttr.artistName,
                    album: sAttr.albumName,
                    artUrl: cleanArtworkUrl(sAttr.artwork?.url, 500, 500),
                    amTrackId: sId
                  }, null);
                  showToast({ message: 'Added to playlist!' });
                  openLocalPlaylistDetail(playlistId);
                }
                return;
              }
              if (sId) loadTrackById(sId);
            };
          });
        }
      } catch (_) {
        box.innerHTML = '';
      }
    };

    loadLocalSuggestions();

    const refBtn = playlistDetail.querySelector('#local-suggested-refresh-btn');
    if (refBtn) refBtn.onclick = () => loadLocalSuggestions();
  }

  if (playlistBackBtn) {
    playlistBackBtn.onclick = () => renderPlaylistsPage();
  }

  if (createPlaylistBtn) {
    createPlaylistBtn.onclick = async () => {
      const name = prompt(t('prompt_enter_playlist_name'));
      if (name && name.trim()) {
        await createPlaylist(name.trim());
        renderPlaylistsPage();
        updateSidebarPlaylists();
      }
    };
  }

  // ── Favorites Page ──
  async function renderFavoritesPage() {
    const favoriteGrid = document.getElementById('favorite-tracks-grid');
    if (!favoriteGrid) return;
    favoriteGrid.innerHTML = `<div class="am-loading-msg">${t('loading')}</div>`;

    const playlists = await getPlaylists();
    const favPlaylist = playlists.find(p => p.name === 'Favorites');
    if (!favPlaylist) {
      favoriteGrid.innerHTML = `<div class="am-error-msg">${t('favorites_empty')}</div>`;
      return;
    }
    const tracks = await getPlaylistTracks(favPlaylist.id);
    if (!tracks.length) {
      favoriteGrid.innerHTML = `<div class="am-error-msg">${t('favorites_empty')}</div>`;
    } else {
      renderTrackGrid(favoriteGrid, tracks, false);
    }
  }

  // ── Recent Page ──
  async function renderRecentPage() {
    const recentGrid = document.getElementById('recent-tracks-grid');
    if (!recentGrid) return;
    const recentTracks = JSON.parse(localStorage.getItem('lyricsflow_recent_tracks') || '[]');
    if (!recentTracks.length) {
      recentGrid.innerHTML = `<div class="am-error-msg">${t('recent_empty')}</div>`;
    } else {
      renderTrackGrid(recentGrid, recentTracks, true);
    }
  }

  // ── Helper to render grids of tracks ──
  async function renderTrackGrid(container, tracks, isRemote = false) {
    if (!container) return;
    container.innerHTML = tracks.map((t, i) => {
      const safeName = escapeHTML(t.name || t.trackName || t.title || 'Unknown');
      const safeArtist = escapeHTML(t.artist || t.artistName || 'Unknown');
      const artUrl = cleanArtworkUrl(t.artUrl || t.artworkUrl100, 300, 300);
      return `
        <div class="trending-card animate-fade" data-index="${i}" data-id="${t.id || t.trackId || ''}">
          <div class="trending-art">
            <img src="${cleanArtworkUrl(artUrl)}" loading="lazy" referrerpolicy="no-referrer" alt="${safeName}">
          </div>
          <div class="trending-info">
            <h4>${safeName}</h4>
            <p>${safeArtist}</p>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.trending-card').forEach(card => {
      card.onclick = async () => {
        const idx = parseInt(card.dataset.index, 10);
        const track = tracks[idx];
        if (!track) return;

        if (prepOverlay) {
          prepOverlay.classList.add('active');
          prepStatus.textContent = t('loading_tracks');
        }

        try {
          await clearQueue();

          for (let i = 0; i < tracks.length; i++) {
            const t = tracks[i];
            let buffer = t.buffer;

            if (!buffer && (t.amTrackId || t.trackId)) {
              prepStatus.textContent = `Fetching ${i + 1}/${tracks.length}: ${t.name || t.trackName || ''}...`;
              const trackId = t.amTrackId || t.trackId;
              const audioUrl = `${API_BASE}/download?song=${trackId}`;
              const resp = await robustFetch(audioUrl, { skipProxy: true });
              buffer = await resp.arrayBuffer();

              if (t.id && (t.amTrackId || t.trackId)) {
                await updatePlaylistTrack(t.id, {
                  buffer,
                  type: isMP4Buffer(buffer) ? 'audio/mp4' : 'audio/mpeg'
                });
              }
            }

            const metadata = {
              name: t.name || t.trackName || t.title || 'Unknown',
              artist: t.artist || t.artistName || 'Unknown Artist',
              album: t.album || t.collectionName || '',
              albumId: t.albumId || null,
              artistId: t.artistId || null,
              artUrl: cleanArtworkUrl(t.artUrl || t.artworkUrl100, 600, 600),
              type: t.type || (buffer ? (isMP4Buffer(buffer) ? 'audio/mp4' : 'audio/mpeg') : 'audio/mpeg'),
              ttml: t.ttml || '__AUTO_FETCH__',
              amTrackId: t.amTrackId || t.trackId || null
            };
            await addTrackToQueue(buffer || null, metadata);
          }

          setCurrentIndex(idx);
          const drawer = document.getElementById('player-drawer');
          const drawerIframe = document.getElementById('player-drawer-iframe');
          if (drawer && drawerIframe) {
            drawerIframe.src = 'player.html';
            drawer.classList.add('open');
            if (prepOverlay) prepOverlay.classList.remove('active');
          } else {
            window.location.href = 'player.html';
          }
        } catch (err) {
          console.error("Failed to load track grid:", err);
          if (prepOverlay) prepOverlay.classList.remove('active');
          showToast({ message: 'Error loading tracks: ' + err.message });
        }
      };
    });
  }

  // ── Remote Playlist View (Lady Gaga / Amr Diab design with Animated Artwork) ──
  async function openRemotePlaylistView(playlistId, playlistName) {
    if (!playlistViewContainer) return;

    if (artistViewContainer) artistViewContainer.classList.add('hidden');
    if (albumViewContainer) albumViewContainer.classList.add('hidden');
    if (listenInitialContent) listenInitialContent.classList.add('hidden');
    if (searchResultsContainer) searchResultsContainer.classList.add('hidden');
    playlistViewContainer.classList.remove('hidden');

    playlistViewContent.innerHTML = `<div class="am-loading-msg">${t('loading_playlist')}</div>`;

    try {
      const playlistApiUrl = `${API_BASE}/playlist?playlist=${playlistId}&storefront=us&l=en-US&extend=editorialVideo,editorialArtwork,editorialNotes,trackCount,extendedAssetUrls&include=tracks,curator&include[tracks]=artists,albums,composers&views=animated-artwork`;
      const res = await fetch(playlistApiUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const tracks = data.parsed_tracks || [];
      const name = data.name || playlistName;
      const curator = data.curator_name || 'Apple Music';
      const description = data.description || '';
      const art = cleanArtworkUrl(data.artwork_url, 600, 600);
      const isMobile = window.innerWidth <= 768;

      // Extract Animated Artwork videos
      const rawData = data.raw_data?.data?.[0] || data.data?.[0] || data;
      const editorialVideo = rawData?.attributes?.editorialVideo || rawData?.editorialVideo || {};
      const animatedArtworkViews = rawData?.views?.['animated-artwork']?.data?.[0]?.attributes || {};

      const motionDetailTallVideo = editorialVideo.motionDetailTall?.video || animatedArtworkViews.motionDetailTall?.video || null;
      const motionSquareVideo = editorialVideo.motionSquareVideo1x1?.video || animatedArtworkViews.motionSquareVideo1x1?.video || null;

      const tracksHTML = tracks.map((t, i) => `
        <div class="am-track-row" data-id="${t.id}" data-idx="${i}">
          <div class="am-track-num">${i + 1}</div>
          ${t.artwork_url ? `<img src="${cleanArtworkUrl(t.artwork_url, 60, 60)}" class="am-song-row-art" loading="lazy" referrerpolicy="no-referrer" alt="">` : ''}
          <div class="am-track-info">
            <div class="am-track-title">${escapeHTML(t.title || '')}</div>
            <div class="am-track-sub">${escapeHTML(t.artist || '')}${t.album ? ' • ' + escapeHTML(t.album) : ''}</div>
          </div>
          ${t.is_explicit ? '<span class="am-explicit-tag">E</span>' : ''}
          <div class="am-track-duration">${formatDuration(t.duration_ms)}</div>
          <button class="am-song-more-btn" data-id="${t.id}" data-idx="${i}">•••</button>
        </div>
      `).join('') || `<p class="am-empty-msg">${t('playlists_empty_tracks')}</p>`;

      if (isMobile) {
        // Mobile Layout matching screenshot
        const hasTallVideo = !!motionDetailTallVideo;
        playlistViewContent.innerHTML = `
          <div class="am-playlist-mob-hero">
            ${hasTallVideo ? `
              <video class="am-playlist-mob-video-bg" autoplay loop muted playsinline poster="${art}">
                <source src="${motionDetailTallVideo}" type="video/mp4">
              </video>
            ` : `
              <div class="am-playlist-mob-img-bg" style="background-image: url('${art}');"></div>
            `}
            <div class="am-playlist-mob-overlay"></div>

            <!-- Top Nav Bar -->
            <div class="am-playlist-mob-top-bar">
              <button class="am-artist-mob-nav-btn" id="playlist-mob-back-btn" aria-label="Back">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
              </button>
              <div class="am-artist-mob-top-right">
                <button class="am-artist-mob-nav-btn" id="playlist-mob-share-btn" aria-label="Share">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                </button>
                <button class="am-artist-mob-nav-btn" id="playlist-mob-more-btn" aria-label="More">•••</button>
              </div>
            </div>

            <!-- Centered Header Content -->
            <div class="am-playlist-mob-center">
              <h1 class="am-playlist-mob-title">${escapeHTML(name)}</h1>
              <div class="am-playlist-mob-curator">${escapeHTML(curator)}</div>
              <div class="am-playlist-mob-meta">${tracks.length} songs</div>

              <!-- Controls: Shuffle, Large Pill Play, Add -->
              <div class="am-playlist-mob-actions-row">
                <button class="am-playlist-circle-icon-btn" id="playlist-shuffle-btn" title="Shuffle">
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
                </button>

                <button class="am-playlist-pill-play-btn" id="playlist-play-all-btn">
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                  <span>Play</span>
                </button>

                <button class="am-playlist-circle-icon-btn" id="playlist-add-btn" title="Add to Library">
                  <span>+</span>
                </button>
              </div>

              ${description ? `
                <div class="am-playlist-mob-desc">
                  "${escapeHTML(description.replace(/<[^>]*>/g, ''))}"
                </div>
              ` : ''}
            </div>
          </div>

          <!-- Tracklist -->
          <div class="am-tracklist am-playlist-mob-tracklist">${tracksHTML}</div>
          <div class="am-album-footer-info" style="padding: 20px;">
            <p class="am-footer-date">${escapeHTML(curator)} • ${t('lib_songs_count', { count: tracks.length })}</p>
          </div>
        `;
      } else {
        // Desktop / Tablet Layout matching screenshot
        const hasSquareVideo = !!motionSquareVideo;
        playlistViewContent.innerHTML = `
          <div class="am-playlist-desktop-header">
            <div class="am-playlist-art-wrap">
              ${hasSquareVideo ? `
                <video class="am-playlist-square-video" autoplay loop muted playsinline poster="${art}">
                  <source src="${motionSquareVideo}" type="video/mp4">
                </video>
              ` : `
                <img src="${art}" class="am-playlist-cover-art" onerror="this.src='favicon.svg'" alt="">
              `}
            </div>
            <div class="am-playlist-desktop-info">
              <h1 class="am-playlist-desktop-title">${escapeHTML(name)}</h1>
              <h2 class="am-playlist-desktop-curator">${escapeHTML(curator)}</h2>
              <div class="am-playlist-desktop-meta">Updated Monday • ${tracks.length} songs</div>
              ${description ? `<p class="am-playlist-desktop-desc">${escapeHTML(description.replace(/<[^>]*>/g, ''))}</p>` : ''}
              <div class="am-playlist-desktop-actions">
                <button class="am-playlist-action-pill" id="playlist-shuffle-btn">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
                  <span>Shuffle</span>
                </button>
                <button class="am-playlist-action-pill primary" id="playlist-play-all-btn">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                  <span>Play</span>
                </button>
                <button class="am-playlist-action-pill" id="playlist-added-btn">
                  <span>✓ Added</span>
                </button>
                <button class="am-artist-mob-nav-btn" id="playlist-desktop-share-btn" title="Share" style="background: rgba(255,255,255,0.08); border-radius: 50%; width: 38px; height: 38px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; color: #fa586a;">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                </button>
              </div>
            </div>
          </div>

          <div class="am-tracklist-table-header">
            <div style="flex: 2;">Song</div>
            <div style="flex: 1.5;">Artist</div>
            <div style="flex: 1.5;">Album</div>
            <div style="width: 70px; text-align: right;">Time</div>
            <div style="width: 40px; text-align: center;"></div>
          </div>

          <div class="am-tracklist">${tracksHTML}</div>
          <div class="am-album-footer-info">
            <p class="am-footer-date">${escapeHTML(curator)} • ${t('lib_songs_count', { count: tracks.length })}</p>
          </div>

          <!-- Suggested Songs Section (Screenshots 3 & 4) -->
          <div class="am-suggested-songs-box">
            <div class="am-suggested-header">
              <div>
                <h3 class="am-suggested-title">Suggested Songs</h3>
                <p class="am-suggested-sub">Based on the music in this playlist</p>
              </div>
              <button class="am-suggested-refresh-btn" id="suggested-refresh-btn">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                <span>Refresh</span>
              </button>
            </div>
            <div class="am-suggested-list" id="suggested-songs-list">
              <div class="am-loading-msg">${t('loading')}</div>
            </div>
          </div>
        `;
      }

      // Share button handler
      const pShareBtn = playlistViewContent.querySelector('#playlist-mob-share-btn') || playlistViewContent.querySelector('#playlist-desktop-share-btn');
      if (pShareBtn) {
        pShareBtn.onclick = () => {
          shareEntity({
            title: name,
            text: `Listen to "${name}" playlist on Lyricsflow`,
            url: `/playlist/${toSlug(name)}/${playlistId}`
          });
        };
      }

      // Mobile Back button handler
      const pBackBtn = playlistViewContent.querySelector('#playlist-mob-back-btn');
      if (pBackBtn) {
        pBackBtn.onclick = () => {
          window.history.back();
        };
      }

      // Play All / Play Playlist Button Handler — Starts stream directly through audio pipeline
      const playAllBtn = playlistViewContent.querySelector('#playlist-play-all-btn');
      if (playAllBtn && tracks.length > 0) {
        playAllBtn.onclick = () => {
          queueContextualWithSimilar({
            trackId: tracks[0].id,
            trackName: tracks[0].title,
            artistName: tracks[0].artist,
            collectionName: tracks[0].album || name,
            albumId: tracks[0].relationships?.albums?.data?.[0]?.id || null,
            artworkUrl100: cleanArtworkUrl(tracks[0].artwork_url, 100, 100),
            durationMs: tracks[0].duration_ms
          }, tracks.map(t => ({
            id: t.id,
            title: t.title,
            artist: t.artist,
            album: t.album || name,
            artUrl: t.artwork_url,
            durationMs: t.duration_ms || 180000
          })), 0);
        };
      }

      // Shuffle Playlist Button
      const shuffleBtn = playlistViewContent.querySelector('#playlist-shuffle-btn');
      if (shuffleBtn && tracks.length > 0) {
        shuffleBtn.onclick = () => {
          const randIdx = Math.floor(Math.random() * tracks.length);
          const tr = tracks[randIdx];
          queueContextualWithSimilar({
            trackId: tr.id,
            trackName: tr.title,
            artistName: tr.artist,
            collectionName: tr.album || name,
            albumId: tr.relationships?.albums?.data?.[0]?.id || null,
            artworkUrl100: cleanArtworkUrl(tr.artwork_url, 100, 100),
            durationMs: tr.duration_ms
          }, tracks.map(t => ({
            id: t.id,
            title: t.title,
            artist: t.artist,
            album: t.album || name,
            artUrl: t.artwork_url,
            durationMs: t.duration_ms || 180000
          })), randIdx);
        };
      }

      // Row clicks
      playlistViewContent.querySelectorAll('.am-track-row').forEach((row, idx) => {
        row.onclick = (e) => {
          const track = tracks[idx];
          if (!track) return;
          const albumId = track.relationships?.albums?.data?.[0]?.id || track.artwork_url?.match(/\/album\/[^/]+\/(\d+)/)?.[1] || null;
          const artistId = track.relationships?.artists?.data?.[0]?.id || null;

          if (e.target.classList.contains('am-song-more-btn')) {
            e.stopPropagation();
            showContextMenu(e, {
              trackId: track.id,
              trackName: track.title,
              artistName: track.artist,
              collectionName: track.album || name,
              albumId: albumId,
              artistId: artistId,
              artworkUrl100: track.artwork_url
            });
            return;
          }
          queueContextualWithSimilar({
            trackId: track.id,
            trackName: track.title,
            artistName: track.artist,
            collectionName: track.album || name,
            albumId: albumId,
            artistId: artistId,
            artworkUrl100: cleanArtworkUrl(track.artwork_url, 100, 100),
            durationMs: track.duration_ms
          }, tracks.map(t => ({
            id: t.id,
            title: t.title,
            artist: t.artist,
            album: t.album || name,
            artUrl: t.artwork_url,
            durationMs: t.duration_ms || 180000
          })), idx);
        };
      });

      // Fetch and render Suggested Songs
      const loadSuggestedSongs = async () => {
        const suggestedContainer = playlistViewContent.querySelector('#suggested-songs-list');
        if (!suggestedContainer) return;
        suggestedContainer.innerHTML = `<div class="am-loading-msg">${t('loading')}</div>`;
        try {
          const sampleArtist = tracks[0]?.artist || name;
          const sRes = await fetch(`${API_BASE}/search?term=${encodeURIComponent(sampleArtist)}&types=songs&limit=10&l=en-US`);
          if (sRes.ok) {
            const sData = await sRes.json();
            const sSongs = sData.results?.songs?.data || [];
            const existingIds = new Set(tracks.map(t => String(t.id)));
            const filtered = sSongs.filter(s => !existingIds.has(String(s.id))).slice(0, 6);
            if (filtered.length === 0) {
              suggestedContainer.innerHTML = `<p class="am-empty-msg">No suggestions found.</p>`;
              return;
            }
            suggestedContainer.innerHTML = filtered.map(s => {
              const a = s.attributes || {};
              const art = cleanArtworkUrl(a.artwork?.url, 100, 100);
              return `
                <div class="am-suggested-song-row" data-id="${s.id}">
                  <img src="${art}" class="am-suggested-art" loading="lazy" alt="">
                  <div class="am-suggested-info">
                    <div class="am-suggested-title">${escapeHTML(a.name || 'Song')}</div>
                    <div class="am-suggested-artist">${escapeHTML(a.artistName || '')}</div>
                  </div>
                  <button class="am-suggested-add-btn" data-id="${s.id}" title="Add to Playlist">+</button>
                </div>
              `;
            }).join('');

            suggestedContainer.querySelectorAll('.am-suggested-song-row').forEach(sRow => {
              sRow.onclick = (e) => {
                if (e.target.closest('.am-suggested-add-btn')) {
                  e.stopPropagation();
                  showToast({ message: 'Added to playlist!' });
                  const addBtn = e.target.closest('.am-suggested-add-btn');
                  if (addBtn) addBtn.textContent = '✓';
                  return;
                }
                const sId = sRow.dataset.id;
                if (sId) loadTrackById(sId);
              };
            });
          }
        } catch (_) {
          suggestedContainer.innerHTML = '';
        }
      };

      loadSuggestedSongs();

      const refreshBtn = playlistViewContent.querySelector('#suggested-refresh-btn');
      if (refreshBtn) {
        refreshBtn.onclick = () => loadSuggestedSongs();
      }

    } catch (err) {
      console.error("Failed to load playlist:", err);
      playlistViewContent.innerHTML = `<div class="am-error-msg">${t('error')}: ${err.message}</div>`;
    }
  }

  // ── TTML Downloader Logic ──
  if (fetchTtmlBtn) {
    fetchTtmlBtn.onclick = async () => {
      const songId = ttmlSongIdInput.value.trim();
      if (!songId) return;

      fetchTtmlBtn.disabled = true;
      ttmlStatus.textContent = t('ttml_status_extracting');

      try {
        const metadata = await TTMLDownloader.fetchMetadata(songId);
        currentFetchedSong = metadata;

        ttmlPreviewName.textContent = metadata.name;
        ttmlPreviewArtist.textContent = metadata.artist;
        ttmlPreviewArt.src = metadata.artUrl;

        const ttml = await TTMLDownloader.fetchTTML(songId);
        if (!ttml) throw new Error(t('ttml_status_no_lyrics'));

        currentFetchedTTML = ttml;
        ttmlCodeBlock.textContent = ttml;
        ttmlResultContainer.classList.remove('hidden');
        downloadTtmlBtn.disabled = false;
        ttmlStatus.textContent = t('ttml_status_success');
      } catch (err) {
        ttmlStatus.textContent = err.message;
      } finally {
        fetchTtmlBtn.disabled = false;
      }
    };
  }

  if (downloadTtmlBtn) {
    downloadTtmlBtn.onclick = () => {
      if (!currentFetchedTTML || !currentFetchedSong) return;
      const filename = `${currentFetchedSong.name} - ${currentFetchedSong.artist}.ttml`;
      TTMLDownloader.download(filename, currentFetchedTTML);
    };
  }

  // ── Helper Utilities ──
  function formatDuration(ms) {
    if (!ms) return '0:00';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  }

  function showError(msg) {
    if (errorEl) {
      errorEl.textContent = msg;
      setTimeout(() => clearError(), 5000);
    }
  }

  function clearError() {
    if (errorEl) errorEl.textContent = '';
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(e.target.error);
      reader.readAsText(file);
    });
  }

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(e.target.error);
      reader.readAsArrayBuffer(file);
    });
  }

  function isMP4Buffer(buffer) {
    const view = new DataView(buffer);
    if (view.byteLength < 12) return false;
    return view.getUint8(4) === 0x66 && view.getUint8(5) === 0x74 && view.getUint8(6) === 0x79 && view.getUint8(7) === 0x70;
  }

  function addToRecent(track) {
    if (!track) return;
    const trackId = track.id || track.trackId || track.amTrackId;
    if (!trackId) return;

    let recent = JSON.parse(localStorage.getItem('lyricsflow_recent_tracks') || '[]');
    recent = recent.filter(t => String(t.trackId || t.id || t.amTrackId) !== String(trackId));
    
    // Normalize properties so Recently Played, Algorithm, and History render completely with artwork and names
    const normalized = {
      id: trackId,
      trackId: trackId,
      amTrackId: trackId,
      title: track.title || track.name || track.trackName || 'Song',
      name: track.title || track.name || track.trackName || 'Song',
      trackName: track.title || track.name || track.trackName || 'Song',
      artist: track.artist || track.artistName || 'Unknown Artist',
      artistName: track.artist || track.artistName || 'Unknown Artist',
      album: track.album || track.collectionName || '',
      collectionName: track.album || track.collectionName || '',
      albumId: track.albumId || null,
      artistId: track.artistId || null,
      artUrl: cleanArtworkUrl(track.artUrl || track.artworkUrl100 || track.rawArtwork, 600, 600),
      artworkUrl100: cleanArtworkUrl(track.artUrl || track.artworkUrl100 || track.rawArtwork, 600, 600),
      durationMs: track.durationMs || track.durationInMillis || 180000,
      timestamp: Date.now()
    };

    recent.unshift(normalized);
    if (recent.length > 50) recent.pop();
    localStorage.setItem('lyricsflow_recent_tracks', JSON.stringify(recent));
    syncHomeNavVisibility();
  }

  // ── System Health & Terminal Status Dialog ──
  async function checkSystemHealthStatus() {
    // Only query if not dismissed in the current session
    if (sessionStorage.getItem('lyricsflow_status_dismissed')) return;

    try {
      const res = await fetch(`${API_BASE}/status`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();

      // Only display the dialog if an issue or degradation is reported
      if (data && (data.hasIssues || data.status !== 'operational')) {
        renderTerminalStatusModal(data);
      }
    } catch (_) {
      // Quiet fail if API server itself is completely offline or unreachable
    }
  }

  function renderTerminalStatusModal(statusData) {
    if (document.getElementById('lyricsflow-terminal-status-modal')) return;

    const endpoints = statusData.endpoints || {};
    const issues = statusData.issues || [];
    const serverName = statusData.server || 'api.spicyamll.online';
    const timestamp = statusData.timestamp ? new Date(statusData.timestamp * 1000).toUTCString() : new Date().toUTCString();

    const lines = Object.entries(endpoints).map(([path, ep]) => {
      const isUp = ep.status === 'up';
      const statusTag = isUp
        ? '<span style="color: #30d158; font-weight: 700;">[UP]</span>'
        : '<span style="color: #ff453a; font-weight: 700; text-shadow: 0 0 6px rgba(255,69,58,0.5);">[DOWN]</span>';
      const providerNote = ep.provider ? ` <span style="color: #8e8e93;">(${escapeHTML(ep.provider)})</span>` : '';
      const detailNote = ep.details ? `<br>&nbsp;&nbsp;&nbsp;&nbsp;↳ <span style="color: #ffd60a;">${escapeHTML(ep.details)}</span>` : '';
      return `<div style="margin-bottom: 8px;">
        <span style="color: #64d2ff;">${escapeHTML(path.padEnd(14, ' '))}</span> 
        ${statusTag} 
        <span style="color: #e5e5ea;">${escapeHTML(ep.name || '')}</span>${providerNote}
        ${detailNote}
      </div>`;
    }).join('');

    const modal = document.createElement('div');
    modal.id = 'lyricsflow-terminal-status-modal';
    modal.style.cssText = `
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.72);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      animation: lyricsflowFadeIn 0.25s ease forwards;
    `;

    modal.innerHTML = `
      <div style="
        background: rgba(18, 18, 20, 0.94);
        border: 1px solid rgba(255, 69, 58, 0.35);
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.8), 0 0 25px rgba(255, 69, 58, 0.18);
        border-radius: 14px;
        width: 100%;
        max-width: 620px;
        overflow: hidden;
        color: #f2f2f7;
        font-size: 13px;
        line-height: 1.55;
      ">
        <!-- Terminal Header / Titlebar -->
        <div style="
          background: rgba(28, 28, 30, 0.95);
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          padding: 10px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          user-select: none;
        ">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="width: 11px; height: 11px; border-radius: 50%; background: #ff5f56; display: inline-block;"></span>
            <span style="width: 11px; height: 11px; border-radius: 50%; background: #ffbd2e; display: inline-block;"></span>
            <span style="width: 11px; height: 11px; border-radius: 50%; background: #27c93f; display: inline-block;"></span>
            <span style="margin-left: 8px; color: #98989d; font-size: 11.5px; font-weight: 600; letter-spacing: 0.02em;">
              spicyamll-daemon ~ endpoint-telemetry
            </span>
          </div>
          <span style="background: rgba(255, 69, 58, 0.16); color: #ff453a; border: 1px solid rgba(255, 69, 58, 0.3); font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: 6px; text-transform: uppercase;">
            ${escapeHTML(statusData.status || 'DEGRADED')}
          </span>
        </div>

        <!-- Terminal Console Body -->
        <div style="padding: 18px 20px; max-height: 60vh; overflow-y: auto;">
          <div style="color: #98989d; margin-bottom: 12px; font-size: 11.5px;">
            <div>$ check-system-status --host <span style="color: #fff;">${escapeHTML(serverName)}</span></div>
            <div>Timestamp: ${escapeHTML(timestamp)}</div>
          </div>

          <div style="background: rgba(255, 69, 58, 0.08); border-left: 3px solid #ff453a; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; color: #ffd60a;">
            ⚠ <strong>System Degradation Detected:</strong> One or more upstream services are temporarily offline or undergoing maintenance. Affected features may fail gracefully.
          </div>

          <!-- Endpoints Table -->
          <div style="background: rgba(0, 0, 0, 0.4); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; padding: 12px 14px; margin-bottom: 16px;">
            <div style="color: #636366; font-size: 11px; font-weight: 700; text-transform: uppercase; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 4px;">
              ENDPOINT&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;STATUS&nbsp;&nbsp;SERVICE NAME
            </div>
            ${lines}
          </div>

          <div style="color: #8e8e93; font-size: 11.5px;">
            Type <span style="color: #64d2ff;">acknowledge</span> to continue using available endpoints, or re-run diagnostic check.
          </div>
        </div>

        <!-- Terminal Action Footer -->
        <div style="
          background: rgba(28, 28, 30, 0.95);
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          padding: 12px 18px;
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        ">
          <button id="status-terminal-retry-btn" style="
            background: rgba(255, 255, 255, 0.08);
            color: #fff;
            border: 1px solid rgba(255, 255, 255, 0.15);
            padding: 7px 15px;
            border-radius: 8px;
            font-size: 12px;
            font-family: inherit;
            cursor: pointer;
            transition: all 0.2s;
          ">Re-check Status</button>
          <button id="status-terminal-dismiss-btn" style="
            background: #ff453a;
            color: #fff;
            border: none;
            padding: 7px 18px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 600;
            font-family: inherit;
            cursor: pointer;
            box-shadow: 0 2px 10px rgba(255, 69, 58, 0.35);
            transition: all 0.2s;
          ">Acknowledge & Dismiss</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const dismissBtn = modal.querySelector('#status-terminal-dismiss-btn');
    if (dismissBtn) {
      dismissBtn.onclick = () => {
        sessionStorage.setItem('lyricsflow_status_dismissed', '1');
        modal.remove();
      };
    }

    const retryBtn = modal.querySelector('#status-terminal-retry-btn');
    if (retryBtn) {
      retryBtn.onclick = async () => {
        retryBtn.textContent = 'Checking...';
        try {
          const r = await fetch(`${API_BASE}/status`, { cache: 'no-store' });
          if (r.ok) {
            const fresh = await r.json();
            modal.remove();
            if (fresh && (fresh.hasIssues || fresh.status !== 'operational')) {
              renderTerminalStatusModal(fresh);
            }
          } else {
            retryBtn.textContent = 'Re-check Status';
          }
        } catch (_) {
          retryBtn.textContent = 'Re-check Status';
        }
      };
    }
  }

  // ── Initial Start Sequence ──
  updateSidebarPlaylists();
  syncHomeNavVisibility();
  checkSystemHealthStatus();

  // Check URL routing first (e.g. /song id or /#songid)
  const routed = checkUrlRouting();
  if (!routed) {
    if (hasListenedSongs()) {
      switchPage('home');
    } else {
      switchPage('listen');
    }
  }
});