/**
 * Lyricsflow — User Profile & Setup Wizard
 * Manages user profile, macOS styled Setup Assistant modal,
 * and Index.html Profile Settings modal with Player Settings iframe.
 */

import { SUPPORTED_LANGUAGES, getCurrentLang, setLanguage, t, detectBrowserLanguage } from './i18n.js';
import { settingsUI } from './settings-ui.js';
import { escapeHTML, cleanArtworkUrl } from './security-utils.js';
import { initDropdowns, closeMenu } from "https://nurislamaibekuly.github.io/aeroui/src/components/dropdown/dropdown.js";

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

export const THEME_OPTIONS = [
  { value: 'dark-mode', label: 'Dark Mode' },
  { value: 'light-mode', label: 'Light Mode' },
  { value: 'oled-black', label: 'OLED Dark' }
];

const AUDIO_QUALITY_OPTIONS = [
  { value: 'alac', label: 'Lossless (ALAC)' },
  { value: 'dolby', label: 'Dolby Atmos / Spatial' },
  { value: 'aac', label: 'High Quality (AAC 256k)' }
];

function themeDropdownHTML(id, selectedTheme) {
  const current = THEME_OPTIONS.find(t => t.value === selectedTheme) || THEME_OPTIONS[0];
  return `
    <div class="aero-dropdown" id="${id}">
      <button class="am-macos-select" data-aero-dropdown="" data-selected="${current.value}">${current.label}</button>
      <div class="aero-menu">
        ${THEME_OPTIONS.map(opt => `
          <button class="aero-menu-item" data-value="${opt.value}">${opt.label}</button>
        `).join('')}
      </div>
    </div>`;
}

function audioQualityDropdownHTML(id, selectedQuality) {
  const current = AUDIO_QUALITY_OPTIONS.find(q => q.value === selectedQuality) || AUDIO_QUALITY_OPTIONS[0];
  return `
    <div class="aero-dropdown" id="${id}">
      <button class="am-macos-select" data-aero-dropdown="" data-selected="${current.value}">${current.label}</button>
      <div class="aero-menu">
        ${AUDIO_QUALITY_OPTIONS.map(opt => `
          <button class="aero-menu-item" data-value="${opt.value}">${opt.label}</button>
        `).join('')}
      </div>
    </div>`;
}

export function getUserProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        name: p.name || DEFAULT_NAME,
        pfp: p.pfp || DEFAULT_PFP,
        lang: p.lang || getCurrentLang(),
        theme: (p.theme === 'aero-dark' || p.theme === 'aero-glass-tint' || p.theme === 'dynamic-vibrant') ? 'dark-mode' : (p.theme || 'dark-mode'),
        enableAlac: p.enableAlac !== undefined ? Boolean(p.enableAlac) : true,
        enableDolby: p.enableDolby !== undefined ? Boolean(p.enableDolby) : true,
        audioQuality: p.audioQuality || 'alac'
      };
    }
  } catch (e) {
    console.error('[Profile] Failed to read profile from localStorage:', e);
  }
  return {
    name: DEFAULT_NAME,
    pfp: DEFAULT_PFP,
    lang: getCurrentLang(),
    theme: 'dark-mode',
    enableAlac: true,
    enableDolby: true,
    audioQuality: 'alac'
  };
}


export function applyMainTheme(theme) {
  let targetTheme = theme || 'dark-mode';
  if (targetTheme === 'aero-dark' || targetTheme === 'aero-glass-tint' || targetTheme === 'dynamic-vibrant') {
    targetTheme = 'dark-mode';
  }
  document.documentElement.setAttribute('data-theme', targetTheme);
  document.body.setAttribute('data-theme', targetTheme);
}

export function saveUserProfile(profile) {
  try {
    const curr = getUserProfile();
    const merged = { ...curr, ...profile };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(merged));
    if (profile.lang && profile.lang !== getCurrentLang()) {
      setLanguage(profile.lang);
    }
    if (merged.theme) {
      applyMainTheme(merged.theme);
    }
    if (merged.audioQuality) {
      document.documentElement.setAttribute('data-audio-quality', merged.audioQuality);
    }
    updateProfileUI();
    window.dispatchEvent(new CustomEvent('lyricsflow-profile-updated', { detail: merged }));
  } catch (e) {
    console.error('[Profile] Failed to save profile:', e);
  }
}

export function updateProfileUI() {
  const profile = getUserProfile();
  if (profile.theme) {
    applyMainTheme(profile.theme);
  }
  if (profile.audioQuality) {
    document.documentElement.setAttribute('data-audio-quality', profile.audioQuality);
  }
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
      initDropdowns(langDropdown.parentElement);
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
          <button id="setup-step3-finish" class="am-macos-btn primary">${t('setup_btn_next')}</button>
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

      const goToStep4 = () => {
        currentStep = 4;
        renderStep();
      };

      const skipBtn = content.querySelector('#setup-step3-skip');
      skipBtn.addEventListener('click', () => {
        tempPfp = DEFAULT_PFP;
        goToStep4();
      });

      const finishBtn = content.querySelector('#setup-step3-finish');
      finishBtn.addEventListener('click', goToStep4);
    } else if (currentStep === 4) {
      // Step 4: Recommendations & Welcome Launch
      content.innerHTML = `
        <div class="am-setup-step-icon">✨</div>
        <h2 class="am-setup-step-title">You're All Set!</h2>
        <p class="am-setup-step-desc">Here are a few quick recommendations to make the most of Lyricsflow:</p>

        <div style="display: flex; flex-direction: column; gap: 10px; margin: 16px 0; text-align: left;">
          <div style="display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 12px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);">
            <span style="font-size: 1.4rem;">🔍</span>
            <div>
              <div style="font-weight: 600; font-size: 0.92rem; color: #fff;">Search Any Track</div>
              <div style="font-size: 0.78rem; color: rgba(255,255,255,0.65);">Explore artists, albums, or tracks with live synced Apple Music lyrics.</div>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 12px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);">
            <span style="font-size: 1.4rem;">🎙️</span>
            <div>
              <div style="font-weight: 600; font-size: 0.92rem; color: #fff;">Dynamic Syllable Lyrics</div>
              <div style="font-size: 0.78rem; color: rgba(255,255,255,0.65);">Sing along with karaoke word-sync animations and background effects.</div>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 12px; background: rgba(88,101,242,0.12); border: 1px solid rgba(88,101,242,0.3);">
            <span style="font-size: 1.4rem;">💬</span>
            <div style="flex: 1; min-width: 0;">
              <div style="font-weight: 600; font-size: 0.92rem; color: #fff;">Join Our Discord Community</div>
              <div style="font-size: 0.78rem; color: rgba(255,255,255,0.7);">Share lyrics, request songs, and connect with other listeners.</div>
            </div>
            <a href="https://discord.gg/VBU2BuqsC" target="_blank" rel="noopener noreferrer" class="am-macos-btn primary" style="font-size: 0.75rem; padding: 4px 10px; background: #5865F2; text-decoration: none;">Join</a>
          </div>
        </div>

        <div class="am-macos-actions">
          <button id="setup-step4-finish" class="am-macos-btn primary">${t('setup_btn_finish')}</button>
        </div>
      `;

      const finishSetup = () => {
        saveUserProfile({
          name: tempName || DEFAULT_NAME,
          pfp: tempPfp || DEFAULT_PFP,
          lang: tempLang
        });
        localStorage.setItem(SETUP_KEY, 'true');
        overlay.remove();
      };

      const finishBtn = content.querySelector('#setup-step4-finish');
      if (finishBtn) finishBtn.addEventListener('click', finishSetup);
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
  let tempTheme = profile.theme || 'aero-dark';
  let tempAlac = profile.enableAlac !== undefined ? profile.enableAlac : true;
  let tempDolby = profile.enableDolby !== undefined ? profile.enableDolby : true;
  let tempQuality = profile.audioQuality || 'alac';

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

      <!-- Appearance Theme Selector (Main UI) -->
      <div class="am-setup-field" style="margin-top: 14px;">
        <label class="am-setup-label">Appearance Theme</label>
        ${themeDropdownHTML('prof-modal-theme-select', tempTheme)}
      </div>

      <!-- Audio Quality Toggles: Lossless (ALAC) & Dolby Atmos -->
      <div class="am-setup-field" style="margin-top: 16px;">
        <label class="am-setup-label" style="margin-bottom: 8px;">Audio Quality</label>
        <div style="display: flex; flex-direction: column; gap: 10px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); padding: 12px 14px; border-radius: 12px;">
          
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div>
              <div style="font-size: 0.9rem; font-weight: 600; color: #fff;">Lossless Audio (ALAC)</div>
              <div style="font-size: 0.76rem; color: rgba(255,255,255,0.6);">Up to 24-bit/192kHz uncompressed Apple Lossless audio.</div>
            </div>
            <label class="am-macos-switch" style="position: relative; display: inline-block; width: 44px; height: 24px; flex-shrink: 0; cursor: pointer;">
              <input type="checkbox" id="prof-toggle-alac" ${tempAlac ? 'checked' : ''} style="opacity: 0; width: 0; height: 0;">
              <span class="am-macos-slider" style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: ${tempAlac ? '#fa586a' : 'rgba(255,255,255,0.2)'}; transition: .2s; border-radius: 24px;"></span>
            </label>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 10px;">
            <div>
              <div style="font-size: 0.9rem; font-weight: 600; color: #fff;">Dolby Atmos / Spatial Audio</div>
              <div style="font-size: 0.76rem; color: rgba(255,255,255,0.6);">Immersive multi-channel surround sound experience.</div>
            </div>
            <label class="am-macos-switch" style="position: relative; display: inline-block; width: 44px; height: 24px; flex-shrink: 0; cursor: pointer;">
              <input type="checkbox" id="prof-toggle-dolby" ${tempDolby ? 'checked' : ''} style="opacity: 0; width: 0; height: 0;">
              <span class="am-macos-slider" style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: ${tempDolby ? '#fa586a' : 'rgba(255,255,255,0.2)'}; transition: .2s; border-radius: 24px;"></span>
            </label>
          </div>

        </div>
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

  // Init dropdowns
  const langDrop = modalBox.querySelector('#prof-modal-lang-select');
  if (langDrop) {
    initDropdowns(langDrop.parentElement);
    const menu = langDrop.querySelector('.aero-menu');
    const trg = langDrop.querySelector('[data-aero-dropdown]');
    const handleLangSelect = (item) => {
      tempLang = item.dataset.value;
      setLanguage(tempLang);
      if (trg) {
        trg.textContent = item.textContent.trim();
        trg.setAttribute('data-selected', tempLang);
      }
      if (menu) {
        menu.querySelectorAll('.aero-menu-item').forEach(i => i.removeAttribute('aria-current'));
        item.setAttribute('aria-current', 'true');
        try { closeMenu(menu); } catch (_) {}
      }
    };
    if (menu) {
      menu.addEventListener('click', (e) => {
        const item = e.target.closest('.aero-menu-item');
        if (!item) return;
        e.stopPropagation();
        handleLangSelect(item);
      });
    }
  }

  const themeDrop = modalBox.querySelector('#prof-modal-theme-select');
  if (themeDrop) {
    initDropdowns(themeDrop.parentElement);
    const menu = themeDrop.querySelector('.aero-menu');
    const trg = themeDrop.querySelector('[data-aero-dropdown]');
    const handleThemeSelect = (item) => {
      tempTheme = item.dataset.value;
      applyMainTheme(tempTheme);
      if (trg) {
        trg.textContent = item.textContent.trim();
        trg.setAttribute('data-selected', tempTheme);
      }
      if (menu) {
        menu.querySelectorAll('.aero-menu-item').forEach(i => i.removeAttribute('aria-current'));
        item.setAttribute('aria-current', 'true');
        try { closeMenu(menu); } catch (_) {}
      }
    };
    if (menu) {
      menu.addEventListener('click', (e) => {
        const item = e.target.closest('.aero-menu-item');
        if (!item) return;
        e.stopPropagation();
        handleThemeSelect(item);
      });
    }
  }

  const alacCheckbox = modalBox.querySelector('#prof-toggle-alac');
  if (alacCheckbox) {
    alacCheckbox.addEventListener('change', (e) => {
      tempAlac = e.target.checked;
      const slider = alacCheckbox.nextElementSibling;
      if (slider) slider.style.backgroundColor = tempAlac ? '#fa586a' : 'rgba(255,255,255,0.2)';
    });
  }

  const dolbyCheckbox = modalBox.querySelector('#prof-toggle-dolby');
  if (dolbyCheckbox) {
    dolbyCheckbox.addEventListener('change', (e) => {
      tempDolby = e.target.checked;
      const slider = dolbyCheckbox.nextElementSibling;
      if (slider) slider.style.backgroundColor = tempDolby ? '#fa586a' : 'rgba(255,255,255,0.2)';
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
  const saveBtn = modalBox.querySelector('#prof-modal-save-btn');
  saveBtn.addEventListener('click', () => {
    const newName = nameInput ? (nameInput.value.trim() || DEFAULT_NAME) : DEFAULT_NAME;
    saveUserProfile({
      name: newName,
      pfp: tempPfp,
      lang: tempLang,
      theme: tempTheme,
      enableAlac: tempAlac,
      enableDolby: tempDolby,
      audioQuality: tempAlac ? 'alac' : (tempDolby ? 'dolby' : 'aac')
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

