/**
 * Lyricsflow — Album Preview Audio Player
 * Plays 30s audio previews from Apple Music album data JSON with a sleek mini player
 * at the bottom, MediaSession OS controls, and native AMLL icons.
 */

import { showToast } from './toast.js';
import { escapeHTML } from './security-utils.js';
import { t } from './i18n.js';
import { parseAudioMetadata } from './metadata-parser.js';
import {
  initPlayerButton,
  setPlayerIcon,
} from 'https://nurislamaibekuly.github.io/aeroui/src/components/player-button/player-button.js';
import {
  initSkipLabel,
  playSkip,
} from 'https://nurislamaibekuly.github.io/aeroui/src/components/skip-label/skip-label.js';
import {
  initElasticSlider,
  setElasticValue,
  getElasticValue,
} from 'https://nurislamaibekuly.github.io/aeroui/src/components/elastic-slider/elastic-slider.js';
import {
  setProgress as setAeroProgress,
} from 'https://nurislamaibekuly.github.io/aeroui/src/components/progress/progress.js';

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

document.addEventListener('error', function (e) {
  const img = e.target;
  if (img.tagName !== 'IMG') return;
  if (img.dataset.initialFallback) return;
  const sub = img.closest('.am-preview-info-col')?.querySelector('.am-preview-sub');
  const name = sub ? sub.textContent.split('•')[0].trim() : '';
  if (!name) return;
  img.dataset.initialFallback = '1';
  img.src = generateArtistInitial(name);
}, true);

export class PreviewPlayer {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.queue = [];
    this.currentIndex = 0;
    this.isPlaying = false;
    this.isMuted = false;
    this.albumTitle = '';
    this.albumArt = '';
    this.container = null;
    this.wakeLock = null;

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this._initDOM());
    } else {
      this._initDOM();
    }
    this._bindAudioEvents();
    this._initMediaSession();
  }

  _initDOM() {
    let el = document.getElementById('am-preview-mini-player');
    // Migrate stale cached DOM — force rebuild so the Apple Music pill structure exists
    if (el && (!el.querySelector('.player-lcd') || !el.querySelector('#am-preview-expand-btn') || !el.querySelector('.player-lcd__progress-track'))) {
      el.remove();
      el = null;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = 'am-preview-mini-player';
      el.className = 'am-preview-mini-player hidden';
      el.innerHTML = `
        <div class="am-preview-inner">
          <!-- Left: Playback Transport Controls -->
          <div class="am-preview-controls-left">
            <button class="am-preview-btn am-preview-shuffle-btn" id="am-preview-shuffle-btn" title="Shuffle" aria-label="Shuffle">
              <img src="icons/button_icon_shuffle.png" alt="Shuffle">
            </button>
            <button class="am-preview-btn aero-player skip-back am-preview-prev-btn" id="am-preview-prev-btn" title="Previous" aria-label="Previous">
              <span class="aero-skip" data-direction="backward"></span>
            </button>
            <button class="am-preview-btn aero-player play-pause am-preview-play-btn" id="am-preview-play-btn" title="Play / Pause" aria-label="Play">
              <div class="aero-spinner" id="am-preview-spinner" style="display: none; width: 16px; height: 16px; border-width: 2.2px;"></div>
            </button>
            <button class="am-preview-btn aero-player skip-forward am-preview-next-btn" id="am-preview-next-btn" title="Next" aria-label="Next">
              <span class="aero-skip" data-direction="forward"></span>
            </button>
            <button class="am-preview-btn am-preview-repeat-btn" id="am-preview-repeat-btn" title="Repeat" aria-label="Repeat">
              <img src="icons/repeat.svg" alt="Repeat" id="am-preview-repeat-icon">
            </button>
          </div>

          <!-- Center: Artwork + Metadata inline with scrub bar strictly from cover to options -->
          <div class="am-preview-track-center" id="am-preview-info-col">
            <div class="am-preview-artwork-wrap">
              <img src="" class="am-preview-art" id="am-preview-art" alt="Cover">
              <button aria-label="Open Full Screen Player" class="player-lcd__artwork-overlay" id="am-preview-expand-btn" data-testid="player-lcd-artwork-overlay">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="87.48 32.45 93.07 93.16" fill="currentColor">
                  <path d="M91.969 71.954c2.587 0 4.443-1.953 4.443-4.54v-4.102l-.977-17.041 12.842 13.525 15.04 15.137c.83.879 1.903 1.27 3.075 1.27 2.784 0 4.834-1.807 4.834-4.542 0-1.318-.44-2.49-1.318-3.369L114.82 53.253l-13.525-12.842 17.09.977h4.052c2.588 0 4.59-1.807 4.59-4.443 0-2.637-1.953-4.492-4.59-4.492h-27.1c-4.98 0-7.86 2.88-7.86 7.86v27.1c0 2.54 1.904 4.541 4.492 4.541Zm53.564 53.663h27.1c4.98 0 7.91-2.881 7.91-7.862v-27.1c0-2.538-1.905-4.54-4.54-4.54-2.54 0-4.445 1.953-4.445 4.54v4.102l1.026 17.041-12.89-13.525-14.991-15.137c-.83-.879-1.953-1.27-3.125-1.27-2.734 0-4.834 1.807-4.834 4.542 0 1.318.488 2.49 1.367 3.369l15.04 15.039 13.573 12.842-17.09-.977h-4.101c-2.588 0-4.59 1.807-4.59 4.443 0 2.637 2.002 4.493 4.59 4.493Z"></path>
                </svg>
              </button>
            </div>
            <div class="am-preview-text">
              <div class="am-preview-title" id="am-preview-title">Track Title</div>
              <div class="am-preview-sub" id="am-preview-sub">Artist — Album</div>
            </div>
            <!-- Progress scrub bar placed right under cover to options button -->
            <div class="am-preview-progress-track" id="am-preview-progress-track">
              <div class="am-preview-progress-fill" id="am-preview-progress-bar"></div>
            </div>
          </div>

          <!-- Right: Actions & Utilities -->
          <div class="am-preview-actions-col">
            <span class="am-preview-dolby-badge" id="am-preview-dolby-badge" title="Dolby Atmos" style="display: none; align-items: center; justify-content: center; opacity: 0.85; margin-right: 4px;">
              <svg width="24" height="15" viewBox="0 0 100 62" fill="currentColor">
                <path d="M0 0h34.6c17.1 0 31 13.9 31 31s-13.9 31-31 31H0V0zm65.4 0H100v62H65.4c17.1 0 31-13.9 31-31s-13.9-31-31-31z"/>
              </svg>
            </span>
            <button class="am-preview-btn am-preview-more-action-btn" id="am-preview-more-btn" title="More Options" aria-label="More Options">•••</button>
            <button class="am-preview-btn am-preview-lyrics-btn" id="am-preview-lyrics-btn" title="Lyrics" aria-label="Lyrics">
              <img src="icons/lyrics.png" alt="Lyrics">
            </button>
            <button class="am-preview-btn am-preview-queue-btn" id="am-preview-queue-btn" title="Playing Next" aria-label="Queue">
              <img src="icons/queue.png" alt="Queue">
            </button>
            <button class="am-preview-btn am-preview-airplay-btn" id="am-preview-airplay-btn" title="AirPlay" aria-label="AirPlay">
              <img src="icons/airplay.png" alt="AirPlay">
            </button>
            <button class="am-preview-btn am-preview-vol-btn" id="am-preview-vol-btn" title="Volume" aria-label="Volume">
              <img src="icons/volume_full.png" id="am-preview-vol-icon" alt="Volume">
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(el);
    }
    this.container = el;

    // Cache elements
    this.infoCol = el.querySelector('#am-preview-info-col');
    this.artEl = el.querySelector('#am-preview-art');
    this.expandBtn = el.querySelector('#am-preview-expand-btn');
    this.titleEl = el.querySelector('#am-preview-title');
    this.subEl = el.querySelector('#am-preview-sub');
    this.moreBtn = el.querySelector('#am-preview-more-btn');
    this.dolbyBadge = el.querySelector('#am-preview-dolby-badge');
    this.progressBar = el.querySelector('#am-preview-progress-bar');
    this.progressTrack = el.querySelector('#am-preview-progress-track');
    this.shuffleBtn = el.querySelector('#am-preview-shuffle-btn');
    this.repeatBtn = el.querySelector('#am-preview-repeat-btn');
    this.repeatIcon = el.querySelector('#am-preview-repeat-icon');
    this.playBtn = el.querySelector('#am-preview-play-btn');
    this.playIcon = el.querySelector('#am-preview-play-icon');
    this.prevBtn = el.querySelector('#am-preview-prev-btn');
    this.nextBtn = el.querySelector('#am-preview-next-btn');
    this.lyricsBtn = el.querySelector('#am-preview-lyrics-btn');
    this.queueBtn = el.querySelector('#am-preview-queue-btn');
    this.airplayBtn = el.querySelector('#am-preview-airplay-btn');
    this.volBtn = el.querySelector('#am-preview-vol-btn');
    this.volIcon = el.querySelector('#am-preview-vol-icon');
    this.spinnerEl = el.querySelector('#am-preview-spinner');
    this.closeBtn = el.querySelector('#am-preview-close-btn');

    // Scrub state
    this.isScrubbing = false;
    this.scrubPositionMs = 0;

    // Smooth Sliding Drawer Transition to player.html
    const triggerZoomToPlayer = async (e, targetView = null) => {
      if (
        !e ||
        e.target?.closest('#am-preview-progress-track') ||
        e.target?.closest('.am-preview-progress-track') ||
        e.target?.closest('.am-preview-link') ||
        (e.target?.closest('.am-preview-btn') && !e.target?.closest('#am-preview-lyrics-btn') && !e.target?.closest('#am-preview-queue-btn') && !e.target?.closest('#am-preview-expand-btn')) ||
        this.isScrubbing
      ) {
        return;
      }
      e.stopPropagation();

      // Seed full queue metadata so player.html loads the track, queue list, and lyrics immediately
      if (this.queue && this.queue.length > 0) {
        try {
          const { clearQueue, addTrackToQueue, setCurrentIndex } = await import('./router.js');
          await clearQueue();
          for (let qi = 0; qi < this.queue.length; qi++) {
            const item = this.queue[qi];
            await addTrackToQueue(null, {
              name: item.title || item.name || 'Track',
              artist: item.artist || item.artistName || 'Artist',
              album: item.album || item.collectionName || '',
              albumId: item.albumId || null,
              artistId: item.artistId || null,
              artUrl: item.artUrl || item.artworkUrlLarge || item.artworkUrl100 || '',
              type: 'audio/mp4',
              ttml: item.ttml || '__AUTO_FETCH__',
              amTrackId: item.id || item.trackId,
              releaseDate: item.releaseDate || null,
              year: item.year || null,
              audioTraits: item.audioTraits || []
            });
          }
          setCurrentIndex(this.currentIndex);
        } catch (err) {
          console.warn('[PreviewPlayer] Failed to pre-seed full queue for player.html:', err);
        }
      }

      // Check if player-drawer exists in the parent page (index.html)
      const drawer = document.getElementById('player-drawer');
      const drawerIframe = document.getElementById('player-drawer-iframe');
      const drawerClose = document.getElementById('player-drawer-close');

      if (drawer && drawerIframe) {
        // Load player.html into iframe if not already loaded
        if (drawerIframe.src === 'about:blank' || !drawerIframe.src.includes('player.html')) {
          drawerIframe.src = 'player.html';
        }

        // Slide drawer up smoothly
        drawer.classList.add('open');
        if (this.container) {
          this.container.classList.add('drawer-hidden');
        }

        // Post target view message once drawer is open/ready
        const sendTargetView = () => {
          if (targetView && drawerIframe.contentWindow) {
            drawerIframe.contentWindow.postMessage({ action: 'switchView', view: targetView }, '*');
          }
        };
        sendTargetView();
        setTimeout(sendTargetView, 350);

        const closeDrawer = () => {
          drawer.classList.remove('open');
          if (this.container) {
            this.container.classList.remove('drawer-hidden');
          }
        };

        // Wire slide down button
        if (drawerClose) {
          drawerClose.onclick = (ev) => {
            ev.stopPropagation();
            closeDrawer();
          };
        }

        // Listen for messages from inside iframe (wired once — this function
        // runs on every drawer open, and duplicate listeners would double-fire
        // every player-state broadcast and pile up dialogs).
        if (!this._drawerMsgWired) {
          this._drawerMsgWired = true;
        window.addEventListener('message', (ev) => {
          // Validate origin to prevent cross-origin message spoofing
          if (ev.origin !== window.location.origin && ev.origin !== 'null' && window.location.origin !== 'null') {
            if (drawerIframe.contentWindow && ev.source !== drawerIframe.contentWindow) return;
          }
          if (ev.data === 'closePlayerDrawer' || ev.data?.action === 'closePlayerDrawer') {
            closeDrawer();
          } else if (ev.data?.type === 'player-state') {
            const { isPlaying, isBuffering, position, duration, songMetadata } = ev.data;
            if (typeof isBuffering === 'boolean') {
              this._setBuffering(isBuffering);
            }
            if (isPlaying !== this.isPlaying) {
              this.isPlaying = isPlaying;
              this._updatePlayButton(isPlaying);
            }
            if (duration && duration > 0) {
              this._setProgressUI(position, duration);
              if (this.container) {
                this.container.setAttribute('data-position', String(position));
                this.container.setAttribute('data-duration', String(duration));
              }
            }
            if (songMetadata) {
              // Same 4x/sec broadcast — only repaint metadata (especially the
              // artwork src, which reflashes on every reassign) when the track changed.
              const newTitle = songMetadata.title || '';
              const curTitle = this.titleEl ? this.titleEl.textContent : null;
              if (newTitle && newTitle !== curTitle) {
                if (this.titleEl) this.titleEl.textContent = newTitle;
                this._updateSubtitleLinks(songMetadata.artist, songMetadata.album, songMetadata.amTrackId || songMetadata.id);
                if (this.artEl && songMetadata.artUrl && this.artEl.getAttribute('src') !== songMetadata.artUrl) this.artEl.src = songMetadata.artUrl;
              }
            }
          } else if (ev.data?.action === 'showArtistOrAlbumDialog') {
            closeDrawer();
            const { artist, album, amTrackId } = ev.data;
            let modal = document.getElementById('am-artist-album-dialog');
            if (!modal) {
              modal = document.createElement('div');
              modal.id = 'am-artist-album-dialog';
              modal.className = 'am-mobile-modal-overlay';
              modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:999999;background:rgba(0,0,0,0.6);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);display:flex;align-items:center;justify-content:center;';
              document.body.appendChild(modal);
            }
            modal.innerHTML = `
              <div class="am-mobile-modal-sheet" style="text-align: center; padding: 28px 24px; background: rgba(30,30,32,0.92); border: 1px solid rgba(255,255,255,0.12); border-radius: 20px; max-width: 360px; width: 90%; box-shadow: 0 20px 40px rgba(0,0,0,0.6);">
                <h3 style="margin: 0 0 8px 0; font-size: 1.25rem; font-weight: 700; color: #fff;">View Details</h3>
                <p style="margin: 0 0 22px 0; font-size: 0.88rem; color: rgba(255,255,255,0.65);">Choose what you would like to explore</p>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                  ${album ? `<button class="premium-btn primary" id="dialog-view-album" style="height: 46px; border-radius: 14px; font-weight: 600; font-size: 0.95rem; cursor: pointer;">View Album (${escapeHTML(album)})</button>` : ''}
                  ${artist ? `<button class="premium-btn secondary" id="dialog-view-artist" style="height: 46px; border-radius: 14px; font-weight: 600; font-size: 0.95rem; cursor: pointer; background: rgba(255,255,255,0.12); color: #fff; border: none;">View Artist (${escapeHTML(artist)})</button>` : ''}
                  <button class="premium-btn secondary" id="dialog-view-cancel" style="height: 40px; border-radius: 12px; background: transparent; color: rgba(255,255,255,0.5); border: none; cursor: pointer;">Cancel</button>
                </div>
              </div>
            `;
            modal.classList.remove('hidden');
            modal.style.display = 'flex';

            const albBtn = modal.querySelector('#dialog-view-album');
            if (albBtn) {
              albBtn.onclick = () => {
                modal.classList.add('hidden');
                modal.style.display = 'none';
                if (window.lyricsflowShowAlbumByName) {
                  window.lyricsflowShowAlbumByName(album, amTrackId);
                }
              };
            }

            const artBtn = modal.querySelector('#dialog-view-artist');
            if (artBtn) {
              artBtn.onclick = () => {
                modal.classList.add('hidden');
                modal.style.display = 'none';
                if (window.lyricsflowShowArtistByName) {
                  window.lyricsflowShowArtistByName(artist);
                }
              };
            }

            const cancelBtn = modal.querySelector('#dialog-view-cancel');
            if (cancelBtn) {
              cancelBtn.onclick = () => {
                modal.classList.add('hidden');
                modal.style.display = 'none';
              };
            }
          }
        });
        } // end once-guarded drawer message listener
        return;
      }

      // Fallback if not inside index.html with drawer
      window.location.href = 'player.html';
    };

    if (this.infoCol) {
      this.infoCol.style.cursor = 'pointer';
      this.infoCol.onclick = (e) => triggerZoomToPlayer(e);
    }
    if (this.artEl) {
      this.artEl.style.cursor = 'pointer';
      this.artEl.onclick = (e) => triggerZoomToPlayer(e);
    }
    if (this.expandBtn) {
      this.expandBtn.onclick = (e) => triggerZoomToPlayer(e);
    }
    if (this.lyricsBtn) {
      this.lyricsBtn.onclick = (e) => triggerZoomToPlayer(e, 'lyrics');
    }
    if (this.queueBtn) {
      this.queueBtn.onclick = (e) => triggerZoomToPlayer(e, 'queue');
    }

    if (this.moreBtn) {
      this.moreBtn.onclick = (e) => {
        e.stopPropagation();
        const currentTrack = this.queue[this.currentIndex];
        if (currentTrack && window.showContextMenu) {
          window.showContextMenu(e, currentTrack);
        } else if (currentTrack) {
          showToast(`${currentTrack.title} — ${currentTrack.artist}`);
        }
      };
    }

    // Initialize AeroUI player-buttons and skip-labels for authentic animations
    if (this.playBtn) {
      try {
        initPlayerButton(this.playBtn);
        setPlayerIcon(this.playBtn, 'play');
      } catch (_) {}
      this.playBtn.addEventListener('pressend', (e) => {
        e.stopPropagation();
        this.togglePlay();
      });
    }

    if (this.prevBtn) {
      try {
        initPlayerButton(this.prevBtn);
        const skipBack = this.prevBtn.querySelector('.aero-skip');
        if (skipBack) initSkipLabel(skipBack);
      } catch (_) {}
      this.prevBtn.addEventListener('pressend', (e) => {
        e.stopPropagation();
        const skipBack = this.prevBtn.querySelector('.aero-skip');
        if (skipBack) playSkip(skipBack);
        this.prev();
      });
    }

    if (this.nextBtn) {
      try {
        initPlayerButton(this.nextBtn);
        const skipFwd = this.nextBtn.querySelector('.aero-skip');
        if (skipFwd) initSkipLabel(skipFwd);
      } catch (_) {}
      this.nextBtn.addEventListener('pressend', (e) => {
        e.stopPropagation();
        const skipFwd = this.nextBtn.querySelector('.aero-skip');
        if (skipFwd) playSkip(skipFwd);
        this.next();
      });
    }
    if (this.shuffleBtn) {
      this.shuffleBtn.onclick = (e) => {
        e.stopPropagation();
        this.isShuffled = !this.isShuffled;
        this.shuffleBtn.classList.toggle('active', this.isShuffled);
        if (this.isShuffled && this.queue.length > 1) {
          const cur = this.queue[this.currentIndex];
          const remaining = this.queue.filter((_, i) => i !== this.currentIndex);
          for (let i = remaining.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
          }
          this.queue = [cur, ...remaining];
          this.currentIndex = 0;
        }
      };
    }
    if (this.repeatBtn) {
      this.repeatBtn.onclick = (e) => {
        e.stopPropagation();
        this.isRepeat = !this.isRepeat;
        this.repeatBtn.classList.toggle('active', this.isRepeat);
        if (this.repeatIcon) {
          this.repeatIcon.src = this.isRepeat ? 'icons/being-repeat.svg' : 'icons/repeat.svg';
        }
      };
    }
    if (this.airplayBtn) {
      this.airplayBtn.onclick = (e) => {
        e.stopPropagation();
        if (window.WebKitPlaybackTargetAvailabilityEvent) {
          this.audio.webkitShowPlaybackTargetPicker();
        } else {
          showToast('AirPlay / Output selection');
        }
      };
    }
    if (this.volBtn) {
      this.volBtn.onclick = (e) => {
        e.stopPropagation();
        this.toggleMute();
      };
    }
    if (this.closeBtn) {
      this.closeBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      };
    }

    // Direct event listener on container to handle close delegation safely
    el.addEventListener('click', (e) => {
      const closeTarget = e.target.closest('#am-preview-close-btn') || e.target.closest('.am-preview-close-btn');
      if (closeTarget) {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });

    // Inset bottom progress scrub bar (draggable like player.html)
    if (this.progressTrack && !this._progressTrackWired) {
      this._progressTrackWired = true;

      const updateScrub = (clientX) => {
        const rect = this.progressTrack.getBoundingClientRect();
        if (!rect.width) return;
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        if (this.progressBar) {
          this.progressBar.style.width = `${ratio * 100}%`;
        }
        const durMs = parseFloat(this.container?.getAttribute('data-duration') || '0');
        const targetDur = durMs > 0 ? durMs : (this.audio.duration * 1000 || 30000);
        this.scrubPositionMs = ratio * targetDur;
      };

      this.progressTrack.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.isScrubbing = true;
        this.progressTrack.classList.add('scrubbing');
        this.progressTrack.setPointerCapture(e.pointerId);
        updateScrub(e.clientX);
      });

      this.progressTrack.addEventListener('pointermove', (e) => {
        if (!this.isScrubbing) return;
        e.stopPropagation();
        updateScrub(e.clientX);
      });

      const finishScrub = (e) => {
        if (!this.isScrubbing) return;
        e.stopPropagation();
        this.isScrubbing = false;
        this.progressTrack.classList.remove('scrubbing');
        try {
          this.progressTrack.releasePointerCapture(e.pointerId);
        } catch (_) {}
        updateScrub(e.clientX);
        this._seekTo(this.scrubPositionMs);
      };

      this.progressTrack.addEventListener('pointerup', finishScrub);
      this.progressTrack.addEventListener('pointercancel', finishScrub);
      this.progressTrack.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
      });
    }

    // Always show preview bar on startup, restoring last played track in paused state
    this._restoreLastPlayedTrack();
  }

  _restoreLastPlayedTrack() {
    try {
      const saved = localStorage.getItem('lyricsflow_last_played_track');
      if (saved) {
        const track = JSON.parse(saved);
        if (track && track.title) {
          this.queue = [track];
          this.currentIndex = 0;
          this.loadCurrentTrack(false);
          return;
        }
      }
    } catch (_) {}

    // If nothing has been played yet, render the preview player visible in idle state
    if (this.container) {
      this.container.style.display = 'block';
      this.container.classList.remove('hidden');
      this.container.classList.add('visible');
      if (this.titleEl) this.titleEl.textContent = 'Not Playing';
      if (this.subEl) this.subEl.textContent = 'Select a song or album';
      if (this.artEl) this.artEl.src = 'favicon.svg';
      this._updatePlayButton(false);
    }
  }

  _bindAudioEvents() {
    this.audio.addEventListener('play', () => {
      this.isPlaying = true;
      this._setBuffering(false);
      this._updatePlayButton(true);
      this._updateMediaSessionState('playing');
      this._requestWakeLock();
    });

    this.audio.addEventListener('playing', () => {
      this.isPlaying = true;
      this._setBuffering(false);
      this._updatePlayButton(true);
    });

    this.audio.addEventListener('pause', () => {
      this.isPlaying = false;
      this._setBuffering(false);
      this._updatePlayButton(false);
      this._updateMediaSessionState('paused');
      this._releaseWakeLock();
    });

    this.audio.addEventListener('waiting', () => {
      this._setBuffering(true);
    });

    this.audio.addEventListener('canplay', () => {
      this._setBuffering(false);
    });

    const onDurationAvailable = () => {
      const dur = this.audio.duration;
      if (dur && !Number.isNaN(dur) && Number.isFinite(dur) && dur > 0) {
        const durMs = Math.round(dur * 1000);
        if (this.container) this.container.setAttribute('data-duration', durMs.toString());
        if (this.durTimeEl) this.durTimeEl.textContent = this._formatTime(dur);
        if (this.progressElastic) {
          this.progressElastic.dataset.max = String(Math.max(1, durMs));
          this.progressElastic.dataset.step = '100';
        }
      }
    };
    this.audio.addEventListener('loadedmetadata', onDurationAvailable);
    this.audio.addEventListener('durationchange', onDurationAvailable);

    this.audio.addEventListener('loadstart', () => {
      if (this.audio.src) this._setBuffering(true);
    });

    this.audio.addEventListener('ended', () => {
      this._setBuffering(false);
      this.next(true);
    });

    this.audio.addEventListener('timeupdate', () => {
      // Don't fight the user while scrubbing (same as player.html)
      if (this.isScrubbing) return;
      const cur = this.audio.currentTime || 0;
      const dur = (this.audio.duration && !Number.isNaN(this.audio.duration) && Number.isFinite(this.audio.duration) && this.audio.duration > 0)
        ? this.audio.duration
        : (parseFloat(this.container?.getAttribute('data-duration') || '0') / 1000 || 30);

      this._setProgressUI(cur * 1000, dur * 1000);

      if (this.container) {
        this.container.setAttribute('data-position', (cur * 1000).toString());
        if (dur > 0) {
          this.container.setAttribute('data-duration', (dur * 1000).toString());
        }
      }
    });

    this.audio.addEventListener('error', (err) => {
      this._setBuffering(false);
      console.warn('[PreviewPlayer] Audio error on track, skipping to next:', err);
      setTimeout(() => this.next(true), 500);
    });
  }

  _setBuffering(isBuffering) {
    const btn = this.playBtn || document.getElementById('am-preview-play-btn');
    if (!btn) return;

    let spinner = btn.querySelector('.aero-spinner');
    const iconEl =
      btn.querySelector('.aero-player-label') ||
      btn.querySelector('svg:not(.aero-spinner-svg), .aero-player-icon, [data-icon]');

    if (isBuffering) {
      if (!spinner) {
        spinner = document.createElement('div');
        spinner.className = 'aero-spinner';
        spinner.innerHTML = `
          <svg class="aero-spinner-svg" viewBox="0 0 1080 1080" xmlns="http://www.w3.org/2000/svg">
            <rect x="487.50" y="176.00" width="105" height="230" rx="52.50" fill="currentColor" transform="rotate(0.0 540 540)" />
            <rect x="487.50" y="176.00" width="105" height="230" rx="52.50" fill="currentColor" transform="rotate(45.0 540 540)" />
            <rect x="487.50" y="176.00" width="105" height="230" rx="52.50" fill="currentColor" transform="rotate(90.0 540 540)" />
            <rect x="487.50" y="176.00" width="105" height="230" rx="52.50" fill="currentColor" transform="rotate(135.0 540 540)" />
            <rect x="487.50" y="176.00" width="105" height="230" rx="52.50" fill="currentColor" transform="rotate(180.0 540 540)" />
            <rect x="487.50" y="176.00" width="105" height="230" rx="52.50" fill="currentColor" transform="rotate(225.0 540 540)" />
            <rect x="487.50" y="176.00" width="105" height="230" rx="52.50" fill="currentColor" transform="rotate(270.0 540 540)" />
            <rect x="487.50" y="176.00" width="105" height="230" rx="52.50" fill="currentColor" transform="rotate(315.0 540 540)" />
          </svg>
        `;
        btn.appendChild(spinner);
      }
      spinner.style.display = 'inline-block';
      if (iconEl) iconEl.style.display = 'none';
    } else {
      if (spinner) spinner.style.display = 'none';
      if (iconEl) iconEl.style.display = '';
    }
  }

  _initMediaSession() {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.setActionHandler('play', () => this.play());
    navigator.mediaSession.setActionHandler('pause', () => this.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => this.prev());
    navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
    navigator.mediaSession.setActionHandler('stop', () => this.close());
  }

  _updateMediaSessionMetadata(track) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || 'Track',
      artist: track.artist || 'Artist',
      album: track.album || this.albumTitle || '',
      artwork: track.artUrl ? [
        { src: track.artUrl, sizes: '96x96', type: 'image/jpeg' },
        { src: track.artUrl, sizes: '128x128', type: 'image/jpeg' },
        { src: track.artUrl, sizes: '256x256', type: 'image/jpeg' },
        { src: track.artUrl, sizes: '512x512', type: 'image/jpeg' }
      ] : []
    });
  }

  _updateMediaSessionState(state) {
    if (!('mediaSession' in navigator)) return;
    if (['none', 'paused', 'playing'].includes(state)) {
      navigator.mediaSession.playbackState = state;
    }
  }

  async _requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) {}
  }

  _releaseWakeLock() {
    if (this.wakeLock) {
      this.wakeLock.release().catch(() => {});
      this.wakeLock = null;
    }
  }

  _updatePlayButton(isPlaying) {
    const btn = this.playBtn || document.getElementById('am-preview-play-btn');
    if (btn) {
      try {
        setPlayerIcon(btn, isPlaying ? 'pause' : 'play');
      } catch (_) {}
      btn.title = isPlaying ? 'Pause' : 'Play';
      btn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
    }
    const icon = this.playIcon || document.getElementById('am-preview-play-icon');
    if (icon) {
      icon.src = isPlaying ? 'icons/play.png' : 'icons/paused.png';
      icon.alt = isPlaying ? 'Pause' : 'Play';
    }
    if (this.container) {
      if (isPlaying) this.container.classList.add('playing');
      else this.container.classList.remove('playing');
    }
  }

  _formatTime(sec) {
    const s = Math.floor(sec || 0);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem < 10 ? '0' : ''}${rem}`;
  }

  /** Seek the full player (iframe) or local preview audio to positionMs. */
  _seekTo(positionMs) {
    const drawerIframe = document.getElementById('player-drawer-iframe');
    const durMs = parseFloat(this.container?.getAttribute('data-duration') || '0');
    if (drawerIframe?.contentWindow && durMs > 0) {
      drawerIframe.contentWindow.postMessage({ action: 'seek', time: positionMs }, '*');
    } else if (this.audio.duration && Number.isFinite(this.audio.duration)) {
      this.audio.currentTime = Math.max(0, Math.min(positionMs / 1000, this.audio.duration));
    }
    // Optimistically reflect the seek target so the UI feels instant
    const targetDur = durMs > 0 ? durMs : (this.audio.duration * 1000 || positionMs);
    if (targetDur > 0) this._setProgressUI(positionMs, targetDur);
  }

  /** Single place that paints position/duration to the inset progress bar. */
  _setProgressUI(positionMs, durationMs) {
    const pos = Math.max(0, positionMs || 0);
    const dur = Math.max(0, durationMs || 0);
    const pct = dur > 0 ? Math.min(100, Math.max(0, (pos / dur) * 100)) : 0;

    const bar = this.progressBar || document.getElementById('am-preview-progress-bar');
    if (bar) {
      bar.style.width = `${pct}%`;
    }
  }

  /**
   * Start preview playback of an entire album
   * @param {Object} albumData - Album response containing raw_data / parsed_tracks
   * @param {number} startIndex - Starting track index
   */
  playAlbum(albumData, startIndex = 0) {
    const albumObj = albumData?.raw_data?.data?.[0] || albumData?.data?.[0] || albumData?.results?.albums?.data?.[0] || albumData || {};
    const attr = albumObj.attributes || albumObj;
    this.albumTitle = attr.name || 'Album';
    this.albumArt = attr.artwork?.url ? attr.artwork.url.replace('{w}', '600').replace('{h}', '600').replace('{c}', '').replace('{f}', 'jpg') : 'favicon.svg';

    const relTracks = albumObj.relationships?.tracks?.data || [];
    const parsed = albumData.parsed_tracks || [];

    let queue = [];

    if (relTracks.length > 0) {
      queue = relTracks.map(t => {
        const tAttr = t.attributes || {};
        const previewUrl = tAttr.previews?.[0]?.url || tAttr.previewUrl || '';
        const art = tAttr.artwork?.url ? tAttr.artwork.url.replace('{w}', '300').replace('{h}', '300').replace('{c}', '').replace('{f}', 'jpg') : this.albumArt;
        return {
          id: t.id,
          title: tAttr.name || 'Unknown Track',
          artist: tAttr.artistName || attr.artistName || '',
          album: tAttr.albumName || this.albumTitle,
          artUrl: art,
          previewUrl: previewUrl,
          durationMs: tAttr.durationInMillis || 30000
        };
      });
    } else if (parsed.length > 0) {
      queue = parsed.map(t => {
        const art = t.artwork_url ? t.artwork_url.replace('{w}', '300').replace('{h}', '300').replace('{c}', '').replace('{f}', 'jpg') : this.albumArt;
        return {
          id: t.id,
          title: t.title || 'Unknown Track',
          artist: t.artist || attr.artistName || '',
          album: t.album || this.albumTitle,
          artUrl: art,
          previewUrl: t.preview_url || '',
          durationMs: t.duration_ms || 30000
        };
      });
    }

    if (queue.length === 0) return;

    this.queue = queue;
    this.currentIndex = Math.max(0, Math.min(startIndex, queue.length - 1));
    this.loadCurrentTrack(true);
  }

  /**
   * Play a specific track or custom track list
   */
  playTrack(track, queue = []) {
    if (queue && queue.length > 0) {
      this.queue = queue;
      const foundIdx = this.queue.findIndex(x => String(x.id) === String(track.id));
      this.currentIndex = foundIdx >= 0 ? foundIdx : 0;
    } else {
      this.queue = [track];
      this.currentIndex = 0;
    }
    this.loadCurrentTrack(true);
  }

  _updateSubtitleLinks(artist, album, trackId) {
    if (!this.subEl) return;
    const artText = artist || '';
    const albText = album || '';
    let html = '';
    if (artText) {
      html += `<span class="am-preview-link am-preview-artist-link">${escapeHTML(artText)}</span>`;
    }
    if (albText) {
      if (html) html += ' • ';
      html += `<span class="am-preview-link am-preview-album-link">${escapeHTML(albText)}</span>`;
    }
    this.subEl.innerHTML = html || 'Select a song or album';

    const artBtn = this.subEl.querySelector('.am-preview-artist-link');
    if (artBtn) {
      artBtn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (window.lyricsflowShowArtistByName && artText) {
          window.lyricsflowShowArtistByName(artText);
        }
      };
    }
    const albBtn = this.subEl.querySelector('.am-preview-album-link');
    if (albBtn) {
      albBtn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (window.lyricsflowShowAlbumByName && albText) {
          window.lyricsflowShowAlbumByName(albText, trackId);
        }
      };
    }
  }

  loadCurrentTrack(autoPlay = true) {
    if (!this.queue || this.queue.length === 0) return;
    const track = this.queue[this.currentIndex];
    if (!track) return;

    if (!this.container) this._initDOM();

    // Update UI elements
    if (this.artEl) this.artEl.src = track.artUrl || '';
    if (this.titleEl) this.titleEl.textContent = track.title || 'Track';
    this._updateSubtitleLinks(track.artist, track.album, track.id || track.amTrackId);

    // Highlight row in active album grid
    this._highlightTrackRow(track.id);

    // Update Dolby Atmos badge in preview player if track has spatial / dolby audio traits
    if (this.dolbyBadge) {
      const isDolby = track.audioTraits?.includes('spatial') || track.audioTraits?.includes('dolby-atmos') || track.audioTraits?.includes('atmos');
      this.dolbyBadge.style.display = isDolby ? 'inline-flex' : 'none';
    }

    // Update MediaSession with song metadata
    this._updateMediaSessionMetadata(track);

    // Show mini player and update data attributes for presence detection
    if (this.container) {
      this.container.style.display = 'block';
      this.container.classList.remove('hidden');
      this.container.classList.add('visible');
      this.container.setAttribute('data-preview-track-id', String(track.id || ''));
      this.container.setAttribute('data-preview-title', track.title || '');
      this.container.setAttribute('data-preview-artist', track.artist || '');
      this.container.setAttribute('data-preview-album', track.album || '');
      this.container.setAttribute('data-preview-art-url', track.artUrl || '');
      this.container.setAttribute('data-position', '0');
      if (track.durationMs && track.durationMs > 0) {
        this.container.setAttribute('data-duration', String(track.durationMs));
        if (this.durTimeEl) this.durTimeEl.textContent = this._formatTime(track.durationMs / 1000);
        if (this.currTimeEl) this.currTimeEl.textContent = '0:00';
      }
    }

    // Save to localStorage as last played track
    try {
      localStorage.setItem('lyricsflow_last_played_track', JSON.stringify({
        id: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album,
        artUrl: track.artUrl,
        previewUrl: track.previewUrl,
        durationMs: track.durationMs
      }));
    } catch (_) {}

    this.isPlaying = !!autoPlay;
    this._updatePlayButton(!!autoPlay);
    // Reset AeroUI progress to 0 with the new track duration
    this.isScrubbing = false;
    this.scrubPositionMs = 0;
    this._setProgressUI(0, track.durationMs || 30000);

    // Pass full queue to player.html in iframe so audio plays via the full audio graph
    (async () => {
      try {
        const { clearQueue, addTrackToQueue, setCurrentIndex } = await import('./router.js');
        await clearQueue();
        const fullQueue = (this.queue && this.queue.length > 0) ? this.queue : [track];
        for (let qi = 0; qi < fullQueue.length; qi++) {
          const item = fullQueue[qi];
          await addTrackToQueue(null, {
            name: item.title || item.name || 'Track',
            artist: item.artist || item.artistName || 'Artist',
            album: item.album || item.collectionName || '',
            albumId: item.albumId || null,
            artistId: item.artistId || null,
            artUrl: item.artUrl || item.artworkUrlLarge || item.artworkUrl100 || '',
            type: 'audio/mp4',
            ttml: item.ttml || '__AUTO_FETCH__',
            amTrackId: item.id || item.trackId,
            audioTraits: item.audioTraits || []
          });
        }
        setCurrentIndex(this.currentIndex);

        const drawerIframe = document.getElementById('player-drawer-iframe');
        if (drawerIframe?.contentWindow) {
          drawerIframe.contentWindow.postMessage({ action: 'loadTrack', index: this.currentIndex, autoPlay: autoPlay }, '*');
        }
      } catch (err) {
        console.warn('[PreviewPlayer] Failed to load track into player queue:', err);
      }
    })();
  }

  play() {
    const drawerIframe = document.getElementById('player-drawer-iframe');
    if (drawerIframe?.contentWindow) {
      drawerIframe.contentWindow.postMessage({ action: 'play' }, '*');
    }
    this.isPlaying = true;
    this._updatePlayButton(true);
  }

  pause() {
    const drawerIframe = document.getElementById('player-drawer-iframe');
    if (drawerIframe?.contentWindow) {
      drawerIframe.contentWindow.postMessage({ action: 'pause' }, '*');
    }
    this.isPlaying = false;
    this._updatePlayButton(false);
  }

  togglePlay() {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  next() {
    if (this.queue.length === 0) return;
    if (this.currentIndex < this.queue.length - 1) {
      this.currentIndex++;
    } else {
      this.currentIndex = 0; // loop around
    }
    this.loadCurrentTrack(true);
  }

  prev() {
    if (this.queue.length === 0) return;
    if (this.currentIndex > 0) {
      this.currentIndex--;
    } else {
      this.currentIndex = this.queue.length - 1;
    }
    this.loadCurrentTrack(true);
  }

  _highlightTrackRow(trackId) {
    document.querySelectorAll('.am-track-row').forEach(row => {
      if (String(row.dataset.id) === String(trackId)) {
        row.classList.add('preview-active');
      } else {
        row.classList.remove('preview-active');
      }
    });
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this.audio.muted = this.isMuted;
    if (this.volIcon) {
      this.volIcon.src = this.isMuted ? 'icons/volume_low.png' : 'icons/volume_full.png';
    }
  }

  /**
   * Play an audio ArrayBuffer directly (using metadata-parser)
   */
  async playBuffer(buffer, filename = 'Audio Track') {
    const meta = await parseAudioMetadata(buffer, filename);
    const blob = new Blob([buffer], { type: 'audio/mpeg' });
    const blobUrl = URL.createObjectURL(blob);
    const trackObj = {
      id: `local_${Date.now()}`,
      title: meta.title || filename,
      artist: meta.artist || 'Local Audio',
      album: meta.album || '',
      artUrl: meta.artUrl || 'favicon.svg',
      previewUrl: blobUrl,
      durationMs: 0
    };
    this.playTrack(trackObj);
  }

  close() {
    this.pause();
    this.audio.src = '';
    if (this.container) {
      this.container.classList.remove('visible');
      this.container.classList.add('hidden');
      this.container.style.display = 'none';
      this.container.removeAttribute('data-preview-track-id');
      this.container.removeAttribute('data-preview-title');
      this.container.removeAttribute('data-preview-artist');
      this.container.removeAttribute('data-preview-album');
      this.container.removeAttribute('data-preview-art-url');
    }
    this._highlightTrackRow(null);
    this._updateMediaSessionState('none');
    this._releaseWakeLock();
  }
}

// Global Singleton Instance
export const previewPlayer = new PreviewPlayer();
window.lyricsflowPreviewPlayer = previewPlayer;
