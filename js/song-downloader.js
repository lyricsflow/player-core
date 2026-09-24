/**
 * song-downloader.js
 * Comprehensive Download Suite for Wave / Lyricsflow:
 * - Direct Song & Full Album Downloads (Single tracks or .ZIP bundle)
 * - Dolby Atmos (M4A / MP4), Lossless ALAC (FLAC 24-bit / M4A), AAC (M4A / MP3)
 * - Parses spicyamll.online/song/:id, spicyamll.online/album/:id, Apple Music URLs, or Raw IDs
 * - Syllable-accurate TTML lyrics download & Spotiflac-style lyrics embedding
 * - High-Res Animated Artwork (.mp4) download
 */
import { t, getCurrentLang } from './i18n.js';
import { robustFetch } from './network-utils.js';
import { TTMLDownloader } from './ttml-downloader.js';
import { initDropdowns, closeMenu } from 'https://nurislamaibekuly.github.io/aeroui/src/components/dropdown/dropdown.js';

const API_BASE = 'https://api.spicyamll.online';

document.addEventListener('DOMContentLoaded', () => {
  const inputEl = document.getElementById('dl-song-input');
  const formatDropdownEl = document.getElementById('dl-format-dropdown');
  const formatTriggerBtn = document.getElementById('dl-format-trigger-btn');
  const formatMenuEl = document.getElementById('dl-format-menu');
  let selectedFormat = 'atmos-m4a';

  if (formatDropdownEl) {
    try {
      initDropdowns(formatDropdownEl.parentElement || formatDropdownEl);
    } catch (e) {
      console.warn('[AeroUI] initDropdowns error:', e);
    }

    if (formatMenuEl) {
      formatMenuEl.addEventListener('click', (e) => {
        const item = e.target.closest('.aero-menu-item');
        if (!item) return;
        const val = item.getAttribute('data-value');
        if (val) {
          selectedFormat = val;
          if (formatTriggerBtn) {
            formatTriggerBtn.textContent = item.textContent.trim();
            formatTriggerBtn.setAttribute('data-selected', val);
          }
          formatMenuEl.querySelectorAll('.aero-menu-item').forEach(i => {
            if (i.getAttribute('data-value') === val) {
              i.setAttribute('aria-current', 'true');
            } else {
              i.removeAttribute('aria-current');
            }
          });
          try { closeMenu(formatMenuEl); } catch (_) {}
        }
      });
    }
  }

  const fetchBtn = document.getElementById('fetch-song-btn');
  const statusEl = document.getElementById('dl-song-status');
  const searchResultsEl = document.getElementById('dl-search-results');
  const targetViewEl = document.getElementById('dl-target-view');

  const settingsToggle = document.getElementById('dl-settings-toggle');
  const settingsBody = document.getElementById('dl-settings-body');
  const settingsArrow = document.getElementById('dl-settings-arrow');

  const optEmbedTtml = document.getElementById('dl-opt-embed-ttml');
  const optSaveTtml = document.getElementById('dl-opt-save-ttml');
  const optAnimatedArt = document.getElementById('dl-opt-animated-art');
  const optZipAlbum = document.getElementById('dl-opt-zip-album');

  if (settingsToggle && settingsBody) {
    settingsToggle.addEventListener('click', () => {
      const isClosed = settingsBody.style.display === 'none' || !settingsBody.style.display;
      settingsBody.style.display = isClosed ? 'flex' : 'none';
      if (settingsArrow) settingsArrow.style.transform = isClosed ? 'rotate(180deg)' : 'rotate(0deg)';
    });
  }

  if (!fetchBtn || !inputEl) return;
  const btnText = fetchBtn.querySelector('.btn-text');
  const btnLoader = fetchBtn.querySelector('.btn-loader');

  const setStatus = (message, isError = false) => {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = 'status-indicator ' + (isError ? 'error showing' : 'showing');
    setTimeout(() => {
      if (statusEl.textContent === message) statusEl.classList.remove('showing');
    }, 6000);
  };

  const setLoading = (loading) => {
    fetchBtn.disabled = loading;
    if (loading) {
      if (btnText) btnText.classList.add('hidden');
      if (btnLoader) btnLoader.classList.remove('hidden');
    } else {
      if (btnText) btnText.classList.remove('hidden');
      if (btnLoader) btnLoader.classList.add('hidden');
    }
  };

  const triggerDownload = (url, filename) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
    }, 100);
  };

  function parseInputUrlOrId(query) {
    const clean = query.trim();
    let type = 'song';
    let id = clean;

    // Check spicyamll.online links
    const spicySongMatch = clean.match(/spicyamll\.online\/song\/(\d+)/i);
    if (spicySongMatch) return { type: 'song', id: spicySongMatch[1] };

    const spicyAlbumMatch = clean.match(/spicyamll\.online\/album\/(?:[^/]+\/)?(\d+)/i);
    if (spicyAlbumMatch) return { type: 'album', id: spicyAlbumMatch[1] };

    // Check Apple Music links
    if (/^https?:\/\//i.test(clean)) {
      try {
        const u = new URL(clean);
        if (u.hostname.includes('apple.com')) {
          if (u.pathname.includes('/music-video/')) {
            const m = u.pathname.match(/\/(\d+)(?:$|\?)/);
            return { type: 'video', id: m ? m[1] : clean };
          }
          const iParam = u.searchParams.get('i');
          if (iParam && /^\d+$/.test(iParam)) {
            return { type: 'song', id: iParam };
          }
          if (u.pathname.includes('/album/')) {
            const m = u.pathname.match(/\/(\d+)(?:$|\?)/);
            if (m) return { type: 'album', id: m[1] };
          }
          const genericMatch = u.pathname.match(/\/(\d+)(?:$|\?)/);
          if (genericMatch) return { type: 'song', id: genericMatch[1] };
        }
      } catch (_) {}
    }

    if (/^\d+$/.test(clean)) {
      return { type: 'unknown_id', id: clean };
    }

    return { type: 'search', query: clean };
  }

  function getSelectedCodecParams() {
    const val = selectedFormat || 'atmos-m4a';
    switch (val) {
      case 'atmos-m4a': return { codec: 'atmos', ext: 'm4a', websupport: false };
      case 'atmos-mp4': return { codec: 'atmos', ext: 'mp4', websupport: true };
      case 'alac-flac': return { codec: 'alac', ext: 'flac', websupport: true };
      case 'alac-m4a': return { codec: 'alac', ext: 'm4a', websupport: false };
      case 'aac-m4a': return { codec: 'aac', ext: 'm4a', websupport: false };
      case 'mp3-320': return { codec: 'mp3', ext: 'mp3', websupport: false };
      default: return { codec: 'atmos', ext: 'm4a', websupport: false };
    }
  }

  async function downloadSingleTrack(trackId, title, artist, album, { artUrl = '' } = {}) {
    const { codec, ext, websupport } = getSelectedCodecParams();
    const cleanName = (title || `Track_${trackId}`).replace(/[\\/:*?"<>|]/g, '_');
    const cleanArtist = (artist || '').replace(/[\\/:*?"<>|]/g, '_');
    const filenameBase = cleanArtist ? `${cleanArtist} - ${cleanName}` : cleanName;

    setStatus(`Preparing download: ${cleanName} (${codec.toUpperCase()})...`);

    // 1. Trigger audio stream / download from server
    let audioUrl = `${API_BASE}/download?song=${encodeURIComponent(trackId)}&codec=${codec}&l=${getCurrentLang()}`;
    if (websupport) {
      audioUrl += '&websupport=true';
    }

    triggerDownload(audioUrl, `${filenameBase}.${ext}`);

    // 2. Separate TTML lyrics download if requested
    if (optSaveTtml && optSaveTtml.checked) {
      try {
        const ttml = await TTMLDownloader.fetchTTML(trackId);
        if (ttml) {
          TTMLDownloader.download(`${filenameBase}`, ttml);
        }
      } catch (lyrErr) {
        console.warn('[Downloader] TTML lyrics fetch skipped:', lyrErr);
      }
    }

    // 3. Animated artwork download if requested
    if (optAnimatedArt && optAnimatedArt.checked) {
      try {
        const animRes = await fetch(`${API_BASE}/animated-art?song=${encodeURIComponent(trackId)}`);
        if (animRes.ok) {
          const animData = await animRes.json();
          const videoUrl = animData.videoUrl || animData.hlsUrl;
          if (videoUrl) {
            triggerDownload(videoUrl, `${filenameBase}_animated_cover.mp4`);
          }
        }
      } catch (artErr) {
        console.warn('[Downloader] Animated artwork download skipped:', artErr);
      }
    }
  }

  async function renderTargetAlbumView(albumId, albumData) {
    if (!targetViewEl) return;
    targetViewEl.classList.remove('hidden');

    const attr = albumData.attributes || {};
    const title = attr.name || 'Unknown Album';
    const artist = attr.artistName || 'Unknown Artist';
    const releaseYear = attr.releaseDate ? attr.releaseDate.split('-')[0] : '';
    const genre = (attr.genreNames && attr.genreNames[0]) || '';
    const rawArt = attr.artwork?.url || '';
    const artUrl = rawArt ? rawArt.replace('{w}x{h}', '600x600').replace('{w}', '600').replace('{h}', '600').replace('{f}', 'jpg') : 'favicon.svg';

    const tracks = albumData.relationships?.tracks?.data || [];

    targetViewEl.innerHTML = `
      <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); border-radius: 18px; padding: 22px; margin-top: 14px; box-shadow: 0 10px 30px rgba(0,0,0,0.4);">
        <!-- Album Header -->
        <div style="display: flex; gap: 20px; align-items: center; margin-bottom: 20px;">
          <img src="${artUrl}" style="width: 100px; height: 100px; border-radius: 14px; object-fit: cover; box-shadow: 0 6px 18px rgba(0,0,0,0.5); flex-shrink: 0;" onerror="this.src='favicon.svg';">
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 0.8rem; font-weight: 600; color: #fc576b; text-transform: uppercase; letter-spacing: 0.04em;">Album &bull; ${releaseYear}</div>
            <h2 style="font-size: 1.35rem; font-weight: 750; color: #fff; margin: 4px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${title}</h2>
            <div style="font-size: 0.9rem; color: #a0a0a6;">${artist} &bull; ${tracks.length} Songs</div>
          </div>
          <button id="dl-album-all-btn" style="padding: 10px 18px; border-radius: 12px; background: linear-gradient(135deg, #fc576b 0%, #ff6b8b 100%); color: #fff; font-weight: 600; border: none; cursor: pointer; display: flex; align-items: center; gap: 7px; flex-shrink: 0; box-shadow: 0 4px 15px rgba(252,87,107,0.35);">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
            <span>Download Full Album</span>
          </button>
        </div>

        <!-- Tracklist -->
        <div style="border-top: 1px solid rgba(255,255,255,0.08); padding-top: 10px; display: flex; flex-direction: column; gap: 6px;">
          ${tracks.map((tItem, idx) => {
            const tAttr = tItem.attributes || {};
            const tName = tAttr.name || `Track ${idx + 1}`;
            const tId = tItem.id;
            const tDurMs = tAttr.durationInMillis || 0;
            const tDurStr = tDurMs ? `${Math.floor(tDurMs / 60000)}:${String(Math.floor((tDurMs % 60000) / 1000)).padStart(2, '0')}` : '';

            return `
              <div class="dl-album-track-row" data-id="${tId}" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-radius: 10px; background: rgba(255,255,255,0.02); transition: background 0.15s ease;">
                <div style="display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0;">
                  <span style="font-size: 0.85rem; color: #8e8e93; font-weight: 600; width: 20px; text-align: right;">${idx + 1}</span>
                  <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    <div style="font-size: 0.92rem; font-weight: 600; color: #fff;">${tName}</div>
                    <div style="font-size: 0.78rem; color: #8e8e93;">${artist}</div>
                  </div>
                </div>
                <div style="display: flex; align-items: center; gap: 12px; flex-shrink: 0;">
                  <span style="font-size: 0.8rem; color: #8e8e93;">${tDurStr}</span>
                  <button class="dl-single-track-btn" data-id="${tId}" data-title="${tName}" data-artist="${artist}" style="width: 32px; height: 32px; border-radius: 50%; background: rgba(255,255,255,0.08); border: none; color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center;" title="Download this track">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    // Hook single buttons
    targetViewEl.querySelectorAll('.dl-single-track-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        downloadSingleTrack(btn.dataset.id, btn.dataset.title, btn.dataset.artist, title, { artUrl });
      });
    });

    // Hook full album download
    const fullAlbumBtn = targetViewEl.querySelector('#dl-album-all-btn');
    if (fullAlbumBtn) {
      fullAlbumBtn.addEventListener('click', async () => {
        setStatus(`Starting full album download for "${title}" (${tracks.length} tracks)...`);
        for (let i = 0; i < tracks.length; i++) {
          const tItem = tracks[i];
          const tAttr = tItem.attributes || {};
          await downloadSingleTrack(tItem.id, tAttr.name, artist, title, { artUrl });
          await new Promise(r => setTimeout(r, 1200)); // Stagger to avoid browser rate limit
        }
        setStatus(`Completed batch download of all ${tracks.length} songs from "${title}"!`);
      });
    }
  }

  const processDownload = async () => {
    const raw = inputEl.value.trim();
    if (!raw) {
      setStatus('Please paste a link or search term.', true);
      return;
    }

    setLoading(true);
    searchResultsEl.classList.add('hidden');
    searchResultsEl.innerHTML = '';
    if (targetViewEl) targetViewEl.classList.add('hidden');

    const parsed = parseInputUrlOrId(raw);

    try {
      // 1. Direct Album
      if (parsed.type === 'album') {
        setStatus('Fetching album details from Apple Music...');
        const albRes = await robustFetch(`${API_BASE}/album?id=${parsed.id}&l=${getCurrentLang()}`);
        if (!albRes.ok) throw new Error('Could not find album.');
        const albData = await albRes.json();
        const first = albData.data?.[0];
        if (!first) throw new Error('Album data unavailable.');
        renderTargetAlbumView(parsed.id, first);
        setStatus('Album loaded. Choose individual tracks or Download Full Album.');
        setLoading(false);
        return;
      }

      // 2. Direct Song / Video
      if (parsed.type === 'song' || parsed.type === 'video') {
        setStatus('Fetching track details...');
        const itunesRes = await fetch(`https://itunes.apple.com/lookup?id=${parsed.id}`);
        let name = parsed.id;
        let artist = '';
        let art = '';
        if (itunesRes.ok) {
          const itunesData = await itunesRes.json();
          const trk = itunesData.results?.[0];
          if (trk) {
            name = trk.trackName || parsed.id;
            artist = trk.artistName || '';
            art = trk.artworkUrl100 ? trk.artworkUrl100.replace('100x100', '600x600') : '';
          }
        }
        downloadSingleTrack(parsed.id, name, artist, '', { artUrl: art });
        setLoading(false);
        return;
      }

      // 3. Ambiguous Numeric ID (Could be track or album)
      if (parsed.type === 'unknown_id') {
        // Try album first
        const albRes = await robustFetch(`${API_BASE}/album?id=${parsed.id}&l=${getCurrentLang()}`);
        if (albRes.ok) {
          const albData = await albRes.json();
          const first = albData.data?.[0];
          if (first && first.relationships?.tracks?.data?.length > 1) {
            renderTargetAlbumView(parsed.id, first);
            setStatus('Album loaded. Ready to download.');
            setLoading(false);
            return;
          }
        }
        // Fallback to song
        downloadSingleTrack(parsed.id, `Track_${parsed.id}`, '', '');
        setLoading(false);
        return;
      }

      // 4. Live Search
      setStatus('Searching catalog...');
      const searchRes = await fetch(`${API_BASE}/search?term=${encodeURIComponent(parsed.query)}&types=songs,albums&limit=12&l=${getCurrentLang()}`);
      if (!searchRes.ok) throw new Error('Search failed.');
      const searchData = await searchRes.json();

      const songs = searchData?.results?.songs?.data || [];
      const albums = searchData?.results?.albums?.data || [];
      const combined = [...albums, ...songs];

      if (combined.length === 0) {
        throw new Error('No songs or albums found matching that term.');
      }

      setStatus(`Found ${combined.length} results. Select one to download:`);
      setLoading(false);

      searchResultsEl.innerHTML = combined.map(item => {
        const attr = item.attributes || {};
        const isAlbum = item.type === 'albums' || item.type === 'album';
        const art = attr.artwork?.url ? attr.artwork.url.replace('{w}x{h}', '120x120').replace('{w}', '120').replace('{h}', '120').replace('{f}', 'jpg') : 'favicon.svg';
        const title = attr.name || 'Unknown';
        const artist = attr.artistName || '';

        return `
          <div class="dl-search-item" data-id="${item.id}" data-type="${isAlbum ? 'album' : 'song'}" style="display: flex; align-items: center; gap: 12px; padding: 10px 14px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.06); transition: background 0.15s ease;">
            <img src="${art}" style="width: 44px; height: 44px; border-radius: 8px; object-fit: cover; flex-shrink: 0;" onerror="this.src='favicon.svg';">
            <div style="flex: 1; min-width: 0;">
              <div style="font-size: 0.92rem; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${isAlbum ? '💿 ' : '🎵 '}${title}
              </div>
              <div style="font-size: 0.78rem; color: #8e8e93;">${isAlbum ? 'Album' : 'Song'} &bull; ${artist}</div>
            </div>
            <button style="padding: 6px 14px; border-radius: 8px; background: rgba(255,255,255,0.08); border: none; color: #fff; font-size: 0.8rem; font-weight: 600;">
              ${isAlbum ? 'Open Album' : 'Download'}
            </button>
          </div>
        `;
      }).join('');

      searchResultsEl.querySelectorAll('.dl-search-item').forEach(el => {
        el.addEventListener('click', async () => {
          const itemId = el.dataset.id;
          const itemType = el.dataset.type;
          searchResultsEl.classList.add('hidden');
          if (itemType === 'album') {
            inputEl.value = `https://spicyamll.online/album/${itemId}`;
            processDownload();
          } else {
            const trkTitle = el.querySelector('div[style*="font-weight: 600"]').textContent.replace('🎵 ', '').trim();
            downloadSingleTrack(itemId, trkTitle, '', '');
          }
        });
      });

      searchResultsEl.classList.remove('hidden');

    } catch (err) {
      console.error(err);
      setStatus(err.message || 'Download failed.', true);
      setLoading(false);
    }
  };

  fetchBtn.addEventListener('click', processDownload);
  inputEl.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') processDownload();
  });
});

