/**
 * Lyricsflow — User Profile & Setup Wizard
 * Manages user profile, macOS styled Setup Assistant modal,
 * and Index.html Profile Settings modal with Player Settings iframe.
 */

import { SUPPORTED_LANGUAGES, getCurrentLang, setLanguage, t, detectBrowserLanguage } from './i18n.js';
import { settingsUI } from './settings-ui.js';
import { escapeHTML, cleanArtworkUrl } from './security-utils.js';

const SETTLE_EPSILON = 0.001;
function _clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function _resolveSpring({ stiffness = 170, damping = 26, mass = 1, bounce, duration } = {}) {
  if (duration !== undefined && bounce !== undefined) { const zeta = _clamp(1 - bounce, 0.0001, 1); const omega = Math.log(1 / SETTLE_EPSILON) / (zeta * duration); return { zeta, omega }; }
  const omega = Math.sqrt(stiffness / mass); const zeta = damping / (2 * Math.sqrt(stiffness * mass)); return { zeta, omega };
}
function _displacement(t, zeta, omega) {
  if (zeta < 1) { const wd = omega * Math.sqrt(1 - zeta * zeta); return Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t)); }
  if (zeta === 1) { return Math.exp(-omega * t) * (1 + omega * t); }
  const s = Math.sqrt(zeta * zeta - 1); const r1 = -omega * (zeta - s); const r2 = -omega * (zeta + s);
  return (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
}
function _settleTime(zeta, omega) { let t = 0.016; while (t < 10 && Math.abs(_displacement(t, zeta, omega)) > SETTLE_EPSILON) t *= 1.25; return t; }
function _springToEasing(config = {}) {
  const { zeta, omega } = _resolveSpring(config); const durationSec = config.duration !== undefined ? config.duration : _settleTime(zeta, omega);
  const steps = _clamp(Math.round((durationSec * 1000) / 8), 24, 480); const points = [];
  for (let i = 0; i <= steps; i++) { const t = (i / steps) * durationSec; points.push(Number((1 - _displacement(t, zeta, omega)).toFixed(5))); }
  points[0] = 0; points[points.length - 1] = 1;
  return { easing: `linear(${points.join(', ')})`, durationMs: Math.round(durationSec * 1000) };
}
function aeroAnimate(el, keyframes, options = {}) {
  const { easing, durationMs } = _springToEasing(options.spring ?? {});
  const anim = el.animate(keyframes, { duration: options.durationMs ?? durationMs, delay: options.delay ?? 0, easing, fill: 'both' });
  anim.finished.catch(() => {}); return anim;
}
const _DD_ENTER = { hidden: { opacity: 0, transform: 'scale(0.95) translateY(-8px)' }, shown: { opacity: 1, transform: 'scale(1) translateY(0)' } };
function _openMenu(menu) {
  const trigger = menu.closest('.aero-dropdown')?.querySelector('[data-aero-dropdown]');
  if (!menu || !trigger || menu.classList.contains('aero-menu--open')) return;
  document.querySelectorAll('.aero-menu.aero-menu--open').forEach(m => { if (m !== menu) _closeMenu(m); });
  menu.getAnimations().forEach(a => a.cancel()); delete menu._aeroClosing;
  menu.classList.add('aero-menu--open');
  aeroAnimate(menu, [_DD_ENTER.hidden, _DD_ENTER.shown], { spring: { duration: 0.3, bounce: 0.15 } });
  trigger.setAttribute('aria-expanded', 'true');
}
function _closeMenu(menu) {
  const trigger = menu.closest('.aero-dropdown')?.querySelector('[data-aero-dropdown]');
  if (!menu || !menu.classList.contains('aero-menu--open') || menu._aeroClosing) return;
  menu._aeroClosing = true;
  aeroAnimate(menu, [_DD_ENTER.shown, _DD_ENTER.hidden], { spring: { duration: 0.18, bounce: 0 } })
    .finished.then(() => { menu._aeroClosing = false; menu.classList.remove('aero-menu--open'); });
  trigger?.setAttribute('aria-expanded', 'false');
}
function initDropdowns(root = document) {
  root.querySelectorAll('.aero-dropdown').forEach(dropdown => {
    const trigger = dropdown.querySelector('[data-aero-dropdown]');
    const menu = dropdown.querySelector(':scope > .aero-menu');
    if (!trigger || !menu || trigger._aeroBound) return;
    trigger._aeroBound = true;
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.addEventListener('click', () => menu.classList.contains('aero-menu--open') ? _closeMenu(menu) : _openMenu(menu));
    trigger.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { e.preventDefault(); if (!menu.classList.contains('aero-menu--open')) _openMenu(menu); [...menu.querySelectorAll('.aero-menu-item:not(:disabled)')][0]?.focus(); } });
    menu.addEventListener('click', e => { const item = e.target.closest('.aero-menu-item'); if (!item || item.disabled) return; _closeMenu(menu); trigger.focus(); });
  });
  document.addEventListener('click', e => { document.querySelectorAll('.aero-menu.aero-menu--open').forEach(menu => { if (!menu.closest('.aero-dropdown')?.contains(e.target)) _closeMenu(menu); }); });
  document.addEventListener('keydown', e => { if (e.key !== 'Escape') return; document.querySelectorAll('.aero-menu.aero-menu--open').forEach(menu => { _closeMenu(menu); menu.closest('.aero-dropdown')?.querySelector('[data-aero-dropdown]')?.focus(); }); });
}

function langDropdownHTML(id, selectedCode) {
  const current = SUPPORTED_LANGUAGES.find(l => l.code === selectedCode) || SUPPORTED_LANGUAGES[0];
  return `
    <div class="aero-dropdown" id="${id}">
      <button class="am-macos-select" data-aero-dropdown="" data-selected="${current.code}">${current.name}</button>
      <div class="aero-menu">
        ${SUPPORTED_LANGUAGES.map(l => `
          <button class="aero-menu-item" data-value="${l.code}">${l.name}</button>
        `).join('')}
      </div>
    </div>`;
}

const PROFILE_KEY = 'lyricsflow_user_profile';
const SETUP_KEY = 'lyricsflow_user_setup_done';

const DEFAULT_PFP = 'icons/account_avatar.png';
const DEFAULT_NAME = 'Listener';

export const PRESET_AVATARS = [
  'icons/account_avatar.png',
  'favicon.svg',
  'icon.png'
];

export function getUserProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        name: p.name || DEFAULT_NAME,
        pfp: p.pfp || DEFAULT_PFP,
        lang: p.lang || getCurrentLang()
      };
    }
  } catch (e) {
    console.error('[Profile] Failed to read profile:', e);
  }
  return {
    name: DEFAULT_NAME,
    pfp: DEFAULT_PFP,
    lang: getCurrentLang()
  };
}

export function saveUserProfile(profile) {
  try {
    const curr = getUserProfile();
    const merged = { ...curr, ...profile };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(merged));
    if (profile.lang && profile.lang !== getCurrentLang()) {
      setLanguage(profile.lang);
    }
    updateProfileUI();
    window.dispatchEvent(new CustomEvent('lyricsflow-profile-updated', { detail: merged }));
  } catch (e) {
    console.error('[Profile] Failed to save profile:', e);
  }
}

export function updateProfileUI() {
  const profile = getUserProfile();
  // Update header profile button avatar
  const avatarImgs = document.querySelectorAll('.user-profile-avatar-img');
  avatarImgs.forEach(img => {
    img.src = profile.pfp || DEFAULT_PFP;
  });

  // Update greeting text if present
  const greetEls = document.querySelectorAll('.user-profile-name-text');
  greetEls.forEach(el => {
    el.textContent = profile.name || DEFAULT_NAME;
  });

  const homeGreetingHeading = document.getElementById('home-greeting-heading');
  if (homeGreetingHeading) {
    homeGreetingHeading.textContent = `${t('home_welcome', { name: profile.name || DEFAULT_NAME })} 👋`;
  }

  const homeRecommendedTitle = document.getElementById('home-recommended-title');
  if (homeRecommendedTitle) {
    homeRecommendedTitle.textContent = t('home_recommended_for', { name: profile.name || DEFAULT_NAME });
  }
}

/**
 * Checks if first-time setup is needed and displays macOS style modal.
 */
export function checkFirstTimeSetup() {
  const isDone = localStorage.getItem(SETUP_KEY);
  if (!isDone) {
    showSetupAssistant();
  } else {
    updateProfileUI();
  }
}

/**
 * macOS Window Style Setup Assistant
 */
export function showSetupAssistant() {
  // Check if existing modal is open
  const existing = document.getElementById('lyricsflow-setup-modal');
  if (existing) existing.remove();

  const detectedLang = detectBrowserLanguage();
  setLanguage(detectedLang);

  let currentStep = 1;
  let tempLang = detectedLang;
  let tempName = '';
  let tempPfp = DEFAULT_PFP;

  const overlay = document.createElement('div');
  overlay.className = 'am-macos-modal-overlay';
  overlay.id = 'lyricsflow-setup-modal';

  const windowBox = document.createElement('div');
  windowBox.className = 'am-macos-window';

  function renderStep() {
    windowBox.innerHTML = '';

    // macOS Titlebar with traffic lights
    const titleBar = document.createElement('div');
    titleBar.className = 'am-macos-titlebar';
    titleBar.innerHTML = `
      <div class="am-macos-traffic-lights">
        <span class="am-tl-btn am-tl-red" id="setup-tl-close" title="Close"></span>
        <span class="am-tl-btn am-tl-yellow" title="Minimize"></span>
        <span class="am-tl-btn am-tl-green" title="Maximize"></span>
      </div>
      <div class="am-macos-title">${t('setup_title')}</div>
      <div style="width: 52px;"></div>
    `;
    windowBox.appendChild(titleBar);

    // Step content container
    const content = document.createElement('div');
    content.className = 'am-macos-content';

    if (currentStep === 1) {
      // Step 1: Language
      content.innerHTML = `
        <div class="am-setup-step-icon">🌐</div>
        <h2 class="am-setup-step-title">${t('setup_welcome')}</h2>
        <p class="am-setup-step-desc">${t('setup_welcome_sub')}</p>
        
        <div class="am-setup-field">
          <label class="am-setup-label">${t('setup_lang_label')}</label>
          ${langDropdownHTML('setup-lang-select', tempLang)}
        </div>

        <div class="am-macos-actions">
          <button id="setup-step1-next" class="am-macos-btn primary">${t('setup_btn_next')}</button>
        </div>
      `;

      const langDropdown = content.querySelector('#setup-lang-select');
      initDropdowns(langDropdown);
      langDropdown.addEventListener('click', (e) => {
        const item = e.target.closest('.aero-menu-item');
        if (!item) return;
        tempLang = item.dataset.value;
        setLanguage(tempLang);
        langDropdown.querySelector('[data-aero-dropdown]').textContent = item.textContent;
        langDropdown.querySelector('[data-aero-dropdown]').setAttribute('data-selected', tempLang);
        renderStep();
      });

      const nextBtn = content.querySelector('#setup-step1-next');
      nextBtn.addEventListener('click', () => {
        currentStep = 2;
        renderStep();
      });

    } else if (currentStep === 2) {
      // Step 2: Name (Skippable)
      content.innerHTML = `
        <div class="am-setup-step-icon">👋</div>
        <h2 class="am-setup-step-title">${t('setup_name_label')}</h2>
        <p class="am-setup-step-desc">${t('setup_name_hint')}</p>
        
        <div class="am-setup-field">
          <input type="text" id="setup-name-input" class="am-macos-input" placeholder="${t('setup_name_placeholder')}" autofocus autocomplete="off">
        </div>

        <div class="am-macos-actions">
          <button id="setup-step2-skip" class="am-macos-btn secondary">${t('setup_btn_skip')}</button>
          <button id="setup-step2-next" class="am-macos-btn primary">${t('setup_btn_next')}</button>
        </div>
      `;

      const input = content.querySelector('#setup-name-input');
      if (input) input.value = tempName || '';

      const skipBtn = content.querySelector('#setup-step2-skip');
      const nextBtn = content.querySelector('#setup-step2-next');

      skipBtn.addEventListener('click', () => {
        tempName = DEFAULT_NAME;
        currentStep = 3;
        renderStep();
      });

      nextBtn.addEventListener('click', () => {
        const val = input.value.trim();
        tempName = val || DEFAULT_NAME;
        currentStep = 3;
        renderStep();
      });

      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          const val = input.value.trim();
          tempName = val || DEFAULT_NAME;
          currentStep = 3;
          renderStep();
        }
      });

    } else if (currentStep === 3) {
      // Step 3: Greeting & Profile Picture (Skippable)
      const safePfp = cleanArtworkUrl(tempPfp) || DEFAULT_PFP;
      const safeDisplayName = escapeHTML(tempName || DEFAULT_NAME);
      content.innerHTML = `
        <div class="am-setup-avatar-preview-wrap">
          <img id="setup-avatar-preview" src="${safePfp}" class="am-setup-avatar-preview" alt="Avatar">
        </div>
        <h2 class="am-setup-step-title">${t('setup_greet', { name: safeDisplayName })}</h2>
        <p class="am-setup-step-desc">${t('setup_greet_sub')}</p>

        <div class="am-avatar-picker-row">
          ${PRESET_AVATARS.map(av => `
            <div class="am-avatar-choice ${av === tempPfp ? 'active' : ''}" data-src="${cleanArtworkUrl(av)}">
              <img src="${cleanArtworkUrl(av)}" alt="">
            </div>
          `).join('')}
        </div>

        <div style="margin-top: 15px; display: flex; justify-content: center;">
          <label class="am-macos-btn secondary" style="cursor: pointer; font-size: 0.85rem; padding: 6px 14px;">
            ${t('setup_custom_pfp')}
            <input type="file" id="setup-pfp-file" accept="image/*" style="display: none;">
          </label>
        </div>

        <div class="am-macos-actions">
          <button id="setup-step3-skip" class="am-macos-btn secondary">${t('setup_btn_skip')}</button>
          <button id="setup-step3-finish" class="am-macos-btn primary">${t('setup_btn_finish')}</button>
        </div>
      `;

      const avatarPreview = content.querySelector('#setup-avatar-preview');
      const choices = content.querySelectorAll('.am-avatar-choice');
      choices.forEach(c => {
        c.addEventListener('click', () => {
          choices.forEach(x => x.classList.remove('active'));
          c.classList.add('active');
          tempPfp = c.dataset.src;
          avatarPreview.src = cleanArtworkUrl(tempPfp);
        });
      });

      const fileInput = content.querySelector('#setup-pfp-file');
      if (fileInput) {
        fileInput.addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (file) {
            // Check file size (max ~2MB) and MIME type
            if (file.size > 2 * 1024 * 1024) {
              alert('Image file size must be less than 2MB.');
              return;
            }
            if (file.type && !file.type.startsWith('image/')) {
              alert('Only image files are allowed.');
              return;
            }
            const reader = new FileReader();
            reader.onload = (evt) => {
              const resUrl = evt.target.result;
              if (typeof resUrl === 'string' && resUrl.startsWith('data:image/')) {
                tempPfp = resUrl;
                avatarPreview.src = tempPfp;
                choices.forEach(x => x.classList.remove('active'));
              }
            };
            reader.readAsDataURL(file);
          }
        });
      }

      const finishSetup = () => {
        saveUserProfile({
          name: tempName || DEFAULT_NAME,
          pfp: tempPfp || DEFAULT_PFP,
          lang: tempLang
        });
        localStorage.setItem(SETUP_KEY, 'true');
        overlay.remove();
      };

      const skipBtn = content.querySelector('#setup-step3-skip');
      skipBtn.addEventListener('click', () => {
        tempPfp = DEFAULT_PFP;
        finishSetup();
      });

      const finishBtn = content.querySelector('#setup-step3-finish');
      finishBtn.addEventListener('click', finishSetup);
    }

    windowBox.appendChild(content);

    // Red dot close button handler
    const closeDot = windowBox.querySelector('#setup-tl-close');
    if (closeDot) {
      closeDot.addEventListener('click', () => {
        saveUserProfile({
          name: tempName || DEFAULT_NAME,
          pfp: tempPfp || DEFAULT_PFP,
          lang: tempLang
        });
        localStorage.setItem(SETUP_KEY, 'true');
        overlay.remove();
      });
    }
  }

  renderStep();
  overlay.appendChild(windowBox);
  document.body.appendChild(overlay);
}

/**
 * Profile & Preferences Modal (for index.html)
 */
export function openProfileSettingsModal() {
  const existing = document.getElementById('lyricsflow-profile-modal');
  if (existing) existing.remove();

  const profile = getUserProfile();
  let tempName = profile.name;
  let tempPfp = profile.pfp;
  let tempLang = profile.lang;

  const overlay = document.createElement('div');
  overlay.className = 'am-macos-modal-overlay';
  overlay.id = 'lyricsflow-profile-modal';

  const modalBox = document.createElement('div');
  modalBox.className = 'am-macos-window am-profile-settings-window';

  modalBox.innerHTML = `
    <div class="am-macos-titlebar">
      <div class="am-macos-traffic-lights">
        <span class="am-tl-btn am-tl-red" id="profile-modal-close" title="Close"></span>
        <span class="am-tl-btn am-tl-yellow"></span>
        <span class="am-tl-btn am-tl-green"></span>
      </div>
      <div class="am-macos-title">${t('profile_settings_title')}</div>
      <div style="width: 52px;"></div>
    </div>

    <div class="am-macos-content">
      <!-- PFP Editor -->
      <div class="am-profile-edit-avatar-section">
        <img id="prof-modal-avatar-preview" src="${cleanArtworkUrl(tempPfp) || DEFAULT_PFP}" class="am-profile-modal-avatar" alt="Avatar">
        <div class="am-avatar-picker-row mini">
          ${PRESET_AVATARS.map(av => `
            <div class="am-avatar-choice ${av === tempPfp ? 'active' : ''}" data-src="${cleanArtworkUrl(av)}">
              <img src="${cleanArtworkUrl(av)}" alt="">
            </div>
          `).join('')}
        </div>
        <label class="am-macos-btn secondary" style="cursor: pointer; font-size: 0.8rem; margin-top: 10px;">
          ${t('setup_custom_pfp')}
          <input type="file" id="prof-modal-pfp-input" accept="image/*" style="display: none;">
        </label>
      </div>

      <!-- Name Editor -->
      <div class="am-setup-field" style="margin-top: 20px;">
        <label class="am-setup-label">${t('profile_name_label')}</label>
        <input type="text" id="prof-modal-name-input" class="am-macos-input" autocomplete="off">
      </div>

      <!-- Language Selector -->
      <div class="am-setup-field" style="margin-top: 14px;">
        <label class="am-setup-label">${t('profile_lang_label')}</label>
        ${langDropdownHTML('prof-modal-lang-select', tempLang)}
      </div>

      <!-- Actions -->
      <div class="am-macos-actions" style="margin-top: 24px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 18px;">
        <button id="prof-modal-player-settings-btn" class="am-macos-btn secondary" style="display: flex; align-items: center; gap: 6px;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
          ${t('profile_player_settings_btn')}
        </button>
        <button id="prof-modal-save-btn" class="am-macos-btn primary">${t('profile_save')}</button>
      </div>
    </div>
  `;

  overlay.appendChild(modalBox);
  document.body.appendChild(overlay);

  // Init language dropdown
  const langDrop = modalBox.querySelector('#prof-modal-lang-select');
  if (langDrop) {
    initDropdowns(langDrop);
    langDrop.addEventListener('click', (e) => {
      const item = e.target.closest('.aero-menu-item');
      if (!item) return;
      tempLang = item.dataset.value;
      setLanguage(tempLang);
      langDrop.querySelector('[data-aero-dropdown]').textContent = item.textContent;
      langDrop.querySelector('[data-aero-dropdown]').setAttribute('data-selected', tempLang);
    });
  }

  // Set input value securely via property
  const nameInput = modalBox.querySelector('#prof-modal-name-input');
  if (nameInput) nameInput.value = tempName || '';

  // Close handlers
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  modalBox.querySelector('#profile-modal-close').addEventListener('click', () => overlay.remove());

  // Avatar presets
  const preview = modalBox.querySelector('#prof-modal-avatar-preview');
  const choices = modalBox.querySelectorAll('.am-avatar-choice');
  choices.forEach(c => {
    c.addEventListener('click', () => {
      choices.forEach(x => x.classList.remove('active'));
      c.classList.add('active');
      tempPfp = c.dataset.src;
      preview.src = cleanArtworkUrl(tempPfp);
    });
  });

  // Custom PFP upload
  const fileInput = modalBox.querySelector('#prof-modal-pfp-input');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        if (file.size > 2 * 1024 * 1024) {
          alert('Image file size must be less than 2MB.');
          return;
        }
        if (file.type && !file.type.startsWith('image/')) {
          alert('Only image files are allowed.');
          return;
        }
        const reader = new FileReader();
        reader.onload = (evt) => {
          const resUrl = evt.target.result;
          if (typeof resUrl === 'string' && resUrl.startsWith('data:image/')) {
            tempPfp = resUrl;
            preview.src = tempPfp;
            choices.forEach(x => x.classList.remove('active'));
          }
        };
        reader.readAsDataURL(file);
      }
    });
  }

  // Save changes
  const langSelect = modalBox.querySelector('#prof-modal-lang-select');
  const saveBtn = modalBox.querySelector('#prof-modal-save-btn');

  saveBtn.addEventListener('click', () => {
    const newName = nameInput ? (nameInput.value.trim() || DEFAULT_NAME) : DEFAULT_NAME;
    const newLang = langSelect.value;
    saveUserProfile({
      name: newName,
      pfp: tempPfp,
      lang: newLang
    });
    overlay.remove();
  });

  // Open Player Settings directly
  const playerSettingsBtn = modalBox.querySelector('#prof-modal-player-settings-btn');
  playerSettingsBtn.addEventListener('click', () => {
    overlay.remove();
    settingsUI.show();
  });
}

/**
 * Open Player Settings directly using settingsUI
 */
export function openPlayerSettingsModal() {
  settingsUI.show();
}

