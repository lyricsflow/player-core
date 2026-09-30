/**
 * LyricsFlow - Electron Desktop Bridge
 * Injects macOS-style traffic lights on Windows and sets up window dragging.
 */

(function () {
  const isElectron = !!(window.wave || window.lyricsflow);
  if (!isElectron) return;

  const api = window.wave || window.lyricsflow;
  const platform = api.platform || (navigator.userAgent.includes('Windows') ? 'win32' : 'darwin');

  document.documentElement.classList.add('is-electron');
  document.body.classList.add(`platform-${platform}`);
  if (api.win10) {
    document.body.classList.add('platform-win10');
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

  // Handle deep link route events from main process (spicyamll.online and lyricsflow://)
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
