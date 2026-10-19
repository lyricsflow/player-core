/**
 * LyricsFlow - Electron Desktop Bridge
 * Injects macOS-style traffic lights on Windows and sets up window dragging.
 */

(function () {
  const isElectron = !!(window.wave || window.lyricsflow);

  if (!isElectron) {
    // Web & Mobile fallback bridge for window.wave and window.lyricsflow
    const getApiBase = () => {
      if (typeof window !== 'undefined' && window.API_BASE) return window.API_BASE;
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('lyricsflow_api_base');
        if (stored) return stored;
      }
      return 'https://api.trylyricsflow.com';
    };

    let lastSentPresence = 0;
    let lastSentState = {
      trackId: null,
      isPlaying: null,
      posSec: 0,
      durSec: 0,
      timestamp: 0
    };

    // In-browser arRPC bridge (talks directly to Discord Desktop on ws://127.0.0.1:6463/rpc)
    let arRpcWs = null;
    let arRpcConnected = false;
    let arRpcReconnectTimer = null;

    function initArRpc() {
      if (typeof WebSocket === 'undefined') return;
      try {
        if (arRpcWs) {
          try { arRpcWs.close(); } catch (_) { }
        }
        arRpcWs = new WebSocket('ws://127.0.0.1:6463/rpc?v=1&client_id=1505997500341944380');
        arRpcWs.onopen = () => {
          arRpcConnected = true;
          console.log('[Web Discord RPC] Connected to local Discord desktop via arRPC');
        };
        arRpcWs.onclose = () => {
          arRpcConnected = false;
          clearTimeout(arRpcReconnectTimer);
          arRpcReconnectTimer = setTimeout(initArRpc, 15000);
        };
        arRpcWs.onerror = () => {
          arRpcConnected = false;
        };
      } catch (_) { }
    }
    initArRpc();

    function sendArRpcActivity(activity) {
      if (!arRpcConnected || !arRpcWs || arRpcWs.readyState !== WebSocket.OPEN) return;
      try {
        arRpcWs.send(JSON.stringify({
          cmd: 'SET_ACTIVITY',
          args: {
            pid: 1000,
            activity: activity
          },
          nonce: crypto.randomUUID?.() || String(Math.random())
        }));
      } catch (_) { }
    }

    const webBridge = {
      platform: 'web',
      isWeb: true,
      windowControls(action) {
        if (action === 'maximize') {
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen?.().catch(() => { });
          } else {
            document.exitFullscreen?.().catch(() => { });
          }
        } else if (action === 'minimize' || action === 'close') {
          const drawer = document.getElementById('player-drawer');
          if (drawer) {
            drawer.classList.remove('open');
            document.body.classList.remove('player-drawer-open');
          }
        }
      },
      onMaximizeChange(callback) {
        document.addEventListener('fullscreenchange', () => {
          callback(!!document.fullscreenElement);
        });
      },
      async updateDiscordPresence(data) {
        if (!data || !data.title) return;
        // 1. Expose standard DOM attributes for PreMiD and browser extensions
        try {
          if (data.title) document.body.setAttribute('data-track-title', data.title);
          if (data.artist) document.body.setAttribute('data-track-artist', data.artist);
          if (data.album) document.body.setAttribute('data-track-album', data.album);
          if (data.artUrl) document.body.setAttribute('data-track-art', data.artUrl);
          document.body.setAttribute('data-is-playing', data.isPlaying ? 'true' : 'false');
          if (data.duration) document.body.setAttribute('data-track-duration', String(data.duration));
          if (data.position !== undefined) document.body.setAttribute('data-track-position', String(data.position));
        } catch (_) { }

        // 2. Intelligent rate limiting and drift detection (7-second heartbeat, immediate on drag/play/pause/track change)
        const now = Date.now();
        const posSec = Math.max(0, Math.floor(data.position || 0));
        const durSec = Math.max(0, Math.floor(data.duration || 0));
        const isPlaying = Boolean(data.isPlaying);
        const trackId = String(data.songId || data.title || '').trim();

        const isTrackChange = lastSentState.trackId !== trackId;
        const isPlayStateChange = lastSentState.isPlaying !== isPlaying;

        let isSeekOrDrift = false;
        if (!isTrackChange && !isPlayStateChange && lastSentState.timestamp > 0) {
          const elapsedSec = (now - lastSentState.timestamp) / 1000;
          const expectedPosSec = lastSentState.isPlaying ? (lastSentState.posSec + elapsedSec) : lastSentState.posSec;
          // Trigger immediate update if user dragged slider or playback drifted by more than 2 seconds
          if (Math.abs(posSec - expectedPosSec) > 2.0) {
            isSeekOrDrift = true;
          }
        }

        const isHeartbeatDue = (now - lastSentPresence) >= 7000;
        const isForced = Boolean(data._force);

        // Immediate dispatch if track changed, play/pause toggled, dragged slider, or explicit force
        const shouldSend = isForced || isTrackChange || isPlayStateChange || isSeekOrDrift || (isPlaying && isHeartbeatDue);

        // If paused and already sent paused state, prevent duplicate network spam
        if (!isPlaying && !isPlayStateChange && !isTrackChange && !isForced) {
          return;
        }

        if (!shouldSend) {
          return;
        }

        lastSentPresence = now;
        lastSentState = {
          trackId,
          isPlaying,
          posSec,
          durSec,
          timestamp: now
        };

        // 3. Dispatch to local Discord Desktop via in-browser arRPC WebSocket
        const cleanTitle = (data.title || '').slice(0, 128);
        const cleanArtist = (data.artist || 'Unknown Artist').slice(0, 128);
        const songId = data.songId ? String(data.songId).trim() : '';
        const largeImg = songId && songId.match(/^\d+$/)
          ? `https://api.trylyricsflow.com/animatedart/gif?song=${songId}`
          : (data.artUrl || 'https://spicyamll.online/images/icon.png');

        const buttons = [];
        if (songId && songId.match(/^\d+$/)) {
          buttons.push({ label: 'Listen on LyricsFlow', url: `https://spicyamll.online/song/${songId}` });
          buttons.push({ label: 'Play on Apple Music', url: `https://music.apple.com/song/${songId}` });
        } else {
          buttons.push({ label: 'Get LyricsFlow', url: 'https://spicyamll.online' });
        }

        const localActivity = isPlaying ? {
          type: 2,
          details: cleanTitle,
          state: cleanArtist,
          assets: {
            large_image: largeImg,
            large_text: (data.album || cleanTitle).slice(0, 128),
            small_image: 'https://spicyamll.online/images/icon.png',
            small_text: 'LyricsFlow'
          },
          buttons: buttons.slice(0, 2),
          timestamps: durSec > 0 ? {
            start: Math.floor(now - (posSec * 1000)),
            end: Math.floor(now - (posSec * 1000) + (durSec * 1000))
          } : undefined
        } : null;

        sendArRpcActivity(localActivity);

        // 4. Dispatch to Cloud Gateway API
        try {
          const discordToken = localStorage.getItem('discord_rpc_token') || localStorage.getItem('lyricsflow_discord_token') || '';
          await fetch(`${getApiBase()}/v1/rpc/presence`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              title: data.title,
              artist: data.artist || 'Unknown Artist',
              album: data.album || '',
              artUrl: data.artUrl || '',
              songId: data.songId || null,
              audioQuality: data.audioQuality || '',
              position: posSec,
              duration: durSec,
              isPlaying: isPlaying,
              discord_token: discordToken
            })
          });
        } catch (_) { }
      },
      async clearDiscordPresence() {
        lastSentPresence = 0;
        lastSentState = {
          trackId: null,
          isPlaying: null,
          posSec: 0,
          durSec: 0,
          timestamp: 0
        };
        sendArRpcActivity(null);
        try {
          document.body.removeAttribute('data-track-title');
          document.body.removeAttribute('data-track-artist');
          document.body.setAttribute('data-is-playing', 'false');
          const discordToken = localStorage.getItem('discord_rpc_token') || localStorage.getItem('lyricsflow_discord_token') || '';
          await fetch(`${getApiBase()}/v1/rpc/clear`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ discord_token: discordToken })
          });
        } catch (_) { }
      },
      openMiniPlayer() {
        const drawer = document.getElementById('player-drawer');
        if (drawer) drawer.classList.add('mini-mode');
      },
      closeMiniPlayer() {
        const drawer = document.getElementById('player-drawer');
        if (drawer) drawer.classList.remove('mini-mode');
      },
      sendMiniState(state) {
        window.dispatchEvent(new CustomEvent('lyricsflow-web-ministate', { detail: state }));
      },
      onMiniState(callback) {
        window.addEventListener('lyricsflow-web-ministate', (e) => callback(e.detail));
      },
      sendMiniAction(command, data) {
        const drawerIframe = document.getElementById('player-drawer-iframe');
        if (drawerIframe && drawerIframe.contentWindow) {
          drawerIframe.contentWindow.postMessage({ action: command, ...(data || {}) }, '*');
        }
      },
      onMiniAction(callback) {
        window.addEventListener('message', (e) => {
          const drawerIframe = document.getElementById('player-drawer-iframe');
          if (drawerIframe?.contentWindow && e.source !== drawerIframe.contentWindow && e.origin !== window.location.origin) {
            return;
          }
          if (e.data && e.data.action) {
            callback({ command: e.data.action, data: e.data });
          }
        });
      },
      onNavigate(callback) {
        window.addEventListener('popstate', () => callback(window.location.pathname));
      },
      onOpenAudioFile(callback) {
        window.addEventListener('lyricsflow-open-audio-file', (e) => callback(e.detail));
      }
    };

    window.wave = webBridge;
    window.lyricsflow = webBridge;
    try {
      const syncToDrawer = () => {
        const drawerIframe = document.getElementById('player-drawer-iframe');
        if (drawerIframe?.contentWindow) {
          try {
            drawerIframe.contentWindow.wave = webBridge;
            drawerIframe.contentWindow.lyricsflow = webBridge;
          } catch (_) { }
        }
      };
      syncToDrawer();
      window.addEventListener('DOMContentLoaded', syncToDrawer);
    } catch (_) { }
  }

  const api = window.wave || window.lyricsflow;
  const platform = api.platform || (navigator.userAgent.includes('Windows') ? 'win32' : 'darwin');

  if (isElectron) {
    document.documentElement.classList.add('is-electron');
    document.body.classList.add(`platform-${platform}`);
    if (api.win10) {
      document.body.classList.add('platform-win10');
    }
  } else {
    document.documentElement.classList.add('is-web-platform');
  }

  function setupControls() {
    const sidebar = document.getElementById('app-sidebar');
    if (!sidebar) {
      setTimeout(setupControls, 50);
      return;
    }

    if (sidebar.querySelector('.electron-drag-bar')) return;

    const dragBar = document.createElement('div');
    dragBar.className = 'electron-drag-bar';

    if (platform === 'win32') {
      const controls = document.createElement('div');
      controls.className = 'electron-window-controls';

      const createBtn = (action, title, svgContent, customClass) => {
        const btn = document.createElement('button');
        btn.className = `electron-window-control ${customClass || ''}`;
        btn.title = title;
        btn.innerHTML = `
          <svg class="electron-window-control-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            ${svgContent}
          </svg>
        `;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          api.windowControls(action);
        });
        return btn;
      };

      const closeBtn = createBtn('close', 'Close', '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>', 'electron-window-control--close');
      const minBtn = createBtn('minimize', 'Minimize', '<line x1="5" y1="12" x2="19" y2="12"></line>', 'electron-window-control--minimize');
      const maxBtn = createBtn('maximize', 'Maximize', '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>', 'electron-window-control--maximize');

      controls.append(closeBtn, minBtn, maxBtn);
      dragBar.appendChild(controls);

      api.onMaximizeChange?.((isMaximized) => {
        const iconSvg = maxBtn.querySelector('svg');
        if (iconSvg) {
          iconSvg.innerHTML = isMaximized
            ? '<rect x="8" y="8" width="13" height="13" rx="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>'
            : '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>';
        }
        maxBtn.title = isMaximized ? 'Restore' : 'Maximize';
      });
    }

    // Insert drag bar at the top of the sidebar
    sidebar.insertBefore(dragBar, sidebar.firstChild);
  }

  // Handle deep link route events from main process (trylyricsflow.com and lyricsflow://)
  if (api.onNavigate) {
    api.onNavigate((targetPath) => {
      if (targetPath) {
        window.history.pushState(null, '', targetPath);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    });
  }

  // Handle opening local audio files via OS double-click or CLI (VLC style)
  if (api.onOpenAudioFile) {
    api.onOpenAudioFile(async (filePath) => {
      if (!filePath) return;
      try {
        const drawerIframe = document.getElementById('player-drawer-iframe');
        const drawer = document.getElementById('player-drawer');
        if (drawer && drawerIframe) {
          drawer.classList.add('open');
          document.body.classList.add('player-drawer-open');
          drawerIframe.contentWindow?.postMessage({
            action: 'playLocalFilePath',
            filePath: filePath
          }, '*');
        }
      } catch (e) {
        console.warn('[Electron Bridge] Failed to play local audio file:', e);
      }
    });
  }

  // Handle windowControl and mini player messages from child iframe (e.g. player.html drawer)
  window.addEventListener('message', (e) => {
    if (!e.data) return;
    const drawerIframe = document.getElementById('player-drawer-iframe');
    if (drawerIframe?.contentWindow && e.source !== drawerIframe.contentWindow && e.origin !== window.location.origin) {
      return;
    }
    if (e.data.action === 'windowControl' && e.data.control) {
      if (api.windowControls) {
        api.windowControls(e.data.control);
      }
    } else if (e.data.action === 'openMiniPlayer') {
      if (api.openMiniPlayer) {
        api.openMiniPlayer();
      }
    } else if (e.data.type === 'player-state') {
      if (api.sendMiniState) {
        api.sendMiniState(e.data);
      }
    }
  });

  // Relay actions from mini player back to iframe
  if (api.onMiniAction) {
    api.onMiniAction((payload) => {
      const drawerIframe = document.getElementById('player-drawer-iframe');
      if (drawerIframe && drawerIframe.contentWindow) {
        drawerIframe.contentWindow.postMessage({
          action: payload.command,
          ...(payload.data || {})
        }, '*');
      }
    });
  }

  // Setup folder scanning and local song upload in Library Hub
  function setupLocalLibraryScanning() {
    const scanFolderBtn = document.getElementById('btn-scan-folder');
    const uploadFilesBtn = document.getElementById('btn-upload-music-files');
    const folderInput = document.getElementById('local-folder-input');
    const filesInput = document.getElementById('local-files-input');

    if (scanFolderBtn && folderInput) {
      scanFolderBtn.onclick = () => folderInput.click();
      folderInput.onchange = async (e) => {
        const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('audio/') || /\.(mp3|m4a|flac|wav|aac|ogg|opus)$/i.test(f.name));
        if (files.length > 0 && window.handleLocalAudioFiles) {
          await window.handleLocalAudioFiles(files);
        }
      };
    }

    if (uploadFilesBtn && filesInput) {
      uploadFilesBtn.onclick = () => filesInput.click();
      filesInput.onchange = async (e) => {
        const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('audio/') || /\.(mp3|m4a|flac|wav|aac|ogg|opus)$/i.test(f.name));
        if (files.length > 0 && window.handleLocalAudioFiles) {
          await window.handleLocalAudioFiles(files);
        }
      };
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setupControls();
      setupLocalLibraryScanning();
    });
  } else {
    setupControls();
    setupLocalLibraryScanning();
  }
})();
