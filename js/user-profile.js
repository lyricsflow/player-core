/**
 * LyricsFlow — User Profile & Setup Wizard
 * Manages user profile, macOS styled Setup Assistant modal,
 * and Index.html Profile Settings modal with Player Settings iframe.
 */

import { SUPPORTED_LANGUAGES, getCurrentLang, setLanguage, t, detectBrowserLanguage } from './i18n.js';
import { settingsUI } from './settings-ui.js';
import { escapeHTML, cleanArtworkUrl } from './security-utils.js';
import { initDropdowns, closeMenu } from "https://nurislamaibekuly.github.io/aeroui/src/components/dropdown/dropdown.js";
import { aeroAlert } from "./aero-dialog.js";

function getApiBase() {
  if (typeof window !== 'undefined' && window.API_BASE) return window.API_BASE;
  const isLocalEnv = typeof window !== 'undefined' && (
    ['localhost', '127.0.0.1'].includes(window.location.hostname) ||
    window.location.protocol === 'file:' ||
    (navigator.userAgent && navigator.userAgent.includes('Electron'))
  );
  return isLocalEnv ? 'https://api.trylyricsflow.com' : 'https://api.trylyricsflow.com';
}

export async function handleOAuthCallback() {
  if (typeof window === 'undefined') return false;
  const hash = window.location.hash;
  if (hash && (hash.includes('access_token=') || hash.includes('error='))) {
    try {
      const params = new URLSearchParams(hash.replace(/^#/, ''));
      const token = params.get('access_token');
      if (token) {
        let email = '';
        let userId = '';
        let name = '';
        let avatar = '';
        let provider = 'oauth';
        try {
          const parts = token.split('.');
          if (parts.length >= 2) {
            const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
            const decoded = JSON.parse(decodeURIComponent(escape(atob(padded))));
            email = decoded.email || decoded.user_metadata?.email || '';
            userId = decoded.sub || decoded.id || '';
            provider = decoded.app_metadata?.provider || (decoded.iss && decoded.iss.includes('discord') ? 'discord' : 'oauth');
            const meta = decoded.user_metadata || {};
            name = meta.full_name || meta.custom_claims?.global_name || meta.name || meta.user_name || (email ? email.split('@')[0] : '');
            avatar = meta.avatar_url || meta.picture || '';
          }
        } catch (_) { }

        if (!name) {
          name = email ? email.split('@')[0] : 'User';
        }

        const bearer = token.startsWith('Bearer ') ? token : `Bearer ${token}`;

        // Synchronize with server to link to existing user account or create new profile
        try {
          const syncResp = await fetch(`${getApiBase()}/v1/auth/oauth-sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              access_token: token,
              email: email,
              name: name,
              avatar: avatar,
              provider: provider
            })
          });
          if (syncResp.ok) {
            const syncData = await syncResp.json();
            if (syncData.name) name = syncData.name;
            if (syncData.user_id) userId = syncData.user_id;
            if (syncData.pfp) avatar = syncData.pfp;
          }
        } catch (syncErr) {
          console.warn('[Auth] OAuth sync notice:', syncErr);
        }

        if (provider === 'discord') {
          try {
            localStorage.setItem('lyricsflow_discord_rpc', 'true');
            if (window.wave?.setDiscordRpc) {
              window.wave.setDiscordRpc(true);
            }
          } catch (_) { }
        }

        setUserAuthSession(bearer, email, userId || (email ? email.split('@')[0] : 'user'));
        saveUserProfile({ name: name, pfp: avatar || DEFAULT_PFP, email: email, provider: provider });
        syncUserDataFromCloud();

        // Clean up URL: remove hash so user lands cleanly on home page
        try {
          const rootUrl = window.location.origin + '/';
          window.history.replaceState(null, '', rootUrl);
        } catch (_) {
          window.location.hash = '';
        }
        removeAuthLock();
        return true;
      }
    } catch (e) {
      console.error('[Auth] Failed to process OAuth callback:', e);
    }
  }
  return false;
}

try {
  handleOAuthCallback();
} catch (_) { }

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
const DEFAULT_NAME = 'Yaseen Mohamed';

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
      let name = p.name;
      let email = p.email || '';
      if (email.startsWith('lf_') && email.includes('_@')) {
        email = email.replace(/^lf_/, '').replace('_@', '@');
      }
      if (!name || name.toLowerCase() === 'listener' || name.toLowerCase() === 'user' || name.startsWith('lf_')) {
        if (email && !email.startsWith('lf_')) {
          name = email.split('@')[0];
        } else {
          name = 'Music Fan';
        }
      }
      return {
        name: name,
        pfp: p.pfp || DEFAULT_PFP,
        lang: p.lang || getCurrentLang(),
        theme: (p.theme === 'aero-dark' || p.theme === 'aero-glass-tint' || p.theme === 'dynamic-vibrant') ? 'dark-mode' : (p.theme || 'dark-mode'),
        enableAlac: p.enableAlac !== undefined ? Boolean(p.enableAlac) : true,
        enableDolby: p.enableDolby !== undefined ? Boolean(p.enableDolby) : true,
        audioQuality: p.audioQuality || 'alac',
        token: p.token || localStorage.getItem('lyricsflow_auth_token') || '',
        email: email,
        userId: p.userId || ''
      };
    }
  } catch (e) {
    console.error('[Profile] Failed to read profile from localStorage:', e);
  }
  return {
    name: 'Music Fan',
    pfp: DEFAULT_PFP,
    lang: getCurrentLang(),
    theme: 'dark-mode',
    enableAlac: true,
    enableDolby: true,
    audioQuality: 'alac',
    token: localStorage.getItem('lyricsflow_auth_token') || '',
    email: '',
    userId: ''
  };
}

export function getUserAuthToken() {
  return getUserProfile().token || '';
}

export function isUserAuthenticated() {
  // Allow Guest browsing: if user explicitly chose guest mode, or has an auth token
  if (localStorage.getItem('lyricsflow_guest_mode') === 'true') {
    return true;
  }
  const token = getUserAuthToken();
  return Boolean(token && token.trim().length > 0);
}

export function setUserAuthSession(token, email = '', userId = '') {
  if (token) {
    localStorage.setItem('lyricsflow_auth_token', token);
  } else {
    localStorage.removeItem('lyricsflow_auth_token');
    localStorage.removeItem(PROFILE_KEY);
    localStorage.removeItem(SETUP_KEY);
    // Clear other user-specific items
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('lyricsflow_') && !['lyricsflow_sound_check', 'lyricsflow_crossfade', 'lyricsflow_discord_rpc'].includes(key)) {
        localStorage.removeItem(key);
      }
    });
    // Notify server to clear cookie
    try {
      fetch(`${getApiBase()}/v1/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => { });
    } catch (_) { }
  }
  if (token) saveUserProfile({ token, email, userId });
  if (!token) {
    enforceAuthLock();
  } else {
    removeAuthLock();
  }
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

let _authLockObserver = null;
let _authEventsTrapped = false;

export function enforceAuthLock() {
  if (isUserAuthenticated()) {
    removeAuthLock();
    return;
  }

  // Cloak all player and UI contents in <body> to guarantee 100% anti-bypass
  let cloakStyle = document.getElementById('lf-auth-cloak-style');
  if (!cloakStyle) {
    cloakStyle = document.createElement('style');
    cloakStyle.id = 'lf-auth-cloak-style';
    cloakStyle.textContent = `
      body.lf-locked > *:not(#lyricsflow-auth-wall):not(#lf-auth-cloak-style) {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
      body.lf-locked {
        overflow: hidden !important;
        background: #0d0d0f !important;
      }
      .apple-btn-active:active {
        transform: scale(0.97) !important;
        transition: transform 90ms cubic-bezier(0.16, 1, 0.3, 1) !important;
      }
      .apple-input-focus:focus {
        border-color: #fa2d48 !important;
        box-shadow: 0 0 0 3.5px rgba(250, 45, 72, 0.28), inset 0 1px 2px rgba(0,0,0,0.3) !important;
      }
    `;
    document.head.appendChild(cloakStyle);
  }
  document.body.classList.add('lf-locked');

  // Trap all events (clicks, keydown, contextmenu) outside modal
  if (!_authEventsTrapped) {
    _authEventsTrapped = true;
    const trap = (e) => {
      if (!isUserAuthenticated()) {
        const wall = document.getElementById('lyricsflow-auth-wall');
        if (wall && !wall.contains(e.target)) {
          e.stopPropagation();
          e.stopImmediatePropagation();
          e.preventDefault();
        }
      }
    };
    window.addEventListener('click', trap, true);
    window.addEventListener('mousedown', trap, true);
    window.addEventListener('keydown', (e) => {
      if (!isUserAuthenticated()) {
        if (e.key === 'Escape' || (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C')) || e.key === 'F12') {
          e.stopPropagation();
          e.stopImmediatePropagation();
          e.preventDefault();
        }
      }
    }, true);
    window.addEventListener('contextmenu', (e) => {
      if (!isUserAuthenticated()) {
        e.preventDefault();
      }
    }, true);
  }

  renderAuthWall();

  // Watchdog MutationObserver: if anyone attempts to delete, hide or alter the wall in DevTools, resurrect immediately!
  if (!_authLockObserver) {
    _authLockObserver = new MutationObserver(() => {
      if (!isUserAuthenticated()) {
        const wall = document.getElementById('lyricsflow-auth-wall');
        if (!wall || wall.style.display === 'none' || wall.style.visibility === 'hidden' || wall.style.opacity === '0') {
          document.body.classList.add('lf-locked');
          renderAuthWall();
        }
      }
    });
    _authLockObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
  }
}

function renderAuthWall() {
  if (isUserAuthenticated()) return;
  let wall = document.getElementById('lyricsflow-auth-wall');
  if (wall) return;

  wall = document.createElement('div');
  wall.id = 'lyricsflow-auth-wall';
  wall.style.cssText = `
    position: fixed !important;
    inset: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    z-index: 2147483647 !important;
    background: #000000 !important;
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    justify-content: center !important;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Roboto, sans-serif !important;
    color: #ffffff !important;
    user-select: none !important;
    overflow-y: auto !important;
    padding: 24px 16px !important;
    box-sizing: border-box !important;
  `;

  wall.innerHTML = `
    <style>
      .apple-tab-btn {
        flex: 1;
        height: 34px;
        border: none;
        border-radius: 9px;
        font-size: 0.84rem;
        font-weight: 500;
        cursor: pointer;
        background: transparent;
        color: #86868b;
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .apple-tab-btn.active {
        background: rgba(255, 255, 255, 0.16);
        color: #ffffff;
        font-weight: 600;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
      }
      .apple-otp-box {
        width: 46px;
        height: 54px;
        text-align: center;
        font-size: 22px;
        font-weight: 700;
        background: #1a1a1e;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 12px;
        color: #ffffff;
        outline: none;
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .apple-otp-box:focus {
        border-color: #ffffff;
        box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.25);
      }
      .apple-verify-btn {
        width: 100%;
        height: 48px;
        background: #ffffff;
        color: #000000;
        font-size: 15px;
        font-weight: 600;
        border: none;
        border-radius: 14px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        box-shadow: 0 4px 20px rgba(255, 255, 255, 0.1);
      }
      .apple-verify-btn:hover {
        background: #f0f0f2;
      }
      .apple-verify-btn:active {
        transform: scale(0.98);
      }
      .apple-verify-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
        transform: none;
      }
      .apple-social-btn {
        width: 100%;
        height: 44px;
        border-radius: 12px;
        color: #ffffff;
        font-size: 0.88rem;
        font-weight: 500;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        cursor: pointer;
        transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .apple-social-btn:hover {
        filter: brightness(1.15);
      }
      .apple-social-btn:active {
        transform: scale(0.98);
      }
      @keyframes apple-shake {
        0%, 100% { transform: translateX(0); }
        20%, 60% { transform: translateX(-6px); }
        40%, 80% { transform: translateX(6px); }
      }
      .apple-shake {
        animation: apple-shake 0.35s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
      }
    </style>

    <!-- Ambient Glow behind Card -->
    <div style="position: absolute; width: 540px; height: 540px; background: radial-gradient(circle, rgba(99, 102, 241, 0.18) 0%, rgba(168, 85, 247, 0.10) 45%, transparent 70%); border-radius: 50%; filter: blur(70px); pointer-events: none;"></div>

    <div style="width: 440px; max-width: 92vw; background: rgba(17, 17, 19, 0.88); backdrop-filter: blur(40px) saturate(190%); -webkit-backdrop-filter: blur(40px) saturate(190%); border: 1px solid rgba(255, 255, 255, 0.12); box-shadow: 0 32px 80px rgba(0, 0, 0, 0.9), inset 0 1px 0 rgba(255, 255, 255, 0.15); border-radius: 28px; padding: 34px 30px; display: flex; flex-direction: column; align-items: center; text-align: center; position: relative; z-index: 10; box-sizing: border-box;">
      
      <!-- Icon -->
      <div style="width: 52px; height: 52px; border-radius: 16px; background: linear-gradient(135deg, rgba(255,255,255,0.14), rgba(255,255,255,0.04)); border: 1px solid rgba(255,255,255,0.16); display: flex; align-items: center; justify-content: center; margin-bottom: 18px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.2);">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="#fff"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
      </div>

      <h1 id="auth-wall-title" style="font-size: 1.55rem; font-weight: 600; margin: 0 0 6px 0; color: #fff; letter-spacing: -0.025em;">Welcome to LyricsFlow</h1>
      <p id="auth-wall-subtitle" style="font-size: 0.86rem; color: #86868b; margin: 0 0 18px 0; line-height: 1.4; letter-spacing: -0.01em;">
        Sign in to unlock personalized lyrics and cloud sync.
      </p>

      <!-- Inline Apple Error Banner -->
      <div id="auth-wall-error" style="display: none; width: 100%; box-sizing: border-box; background: rgba(255, 69, 58, 0.14); border: 1px solid rgba(255, 69, 58, 0.32); color: #ff453a; padding: 10px 14px; border-radius: 12px; font-size: 0.84rem; line-height: 1.4; margin-bottom: 16px; text-align: left; align-items: center; gap: 8px;">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
        <span id="auth-wall-error-text" style="flex: 1;"></span>
      </div>

      <!-- Segmented Method Switcher: Password / OTP -->
      <div style="display: flex; background: rgba(255,255,255,0.06); padding: 3px; border-radius: 12px; margin-bottom: 18px; width: 100%; box-sizing: border-box;">
        <button id="auth-tab-pass" class="apple-tab-btn active">Password</button>
        <button id="auth-tab-otp" class="apple-tab-btn">One-Time Code</button>
        <button id="auth-tab-magic" class="apple-tab-btn">Magic Link</button>
      </div>

      <!-- TAB 1: Password Sign In & Create Account Form -->
      <div id="auth-pass-form" style="width: 100%; display: flex; flex-direction: column; gap: 12px;">
        <input type="email" id="auth-pass-email" class="apple-input-focus" placeholder="Email address" autocomplete="email" style="width: 100%; box-sizing: border-box; height: 46px; border-radius: 13px; background: #1a1a1e; border: 1px solid rgba(255, 255, 255, 0.12); color: #fff; padding: 0 16px; font-size: 0.92rem; outline: none; transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);" />
        
        <input type="text" id="auth-pass-name" class="apple-input-focus" placeholder="Your Name (optional)" autocomplete="name" style="display: none; width: 100%; box-sizing: border-box; height: 46px; border-radius: 13px; background: #1a1a1e; border: 1px solid rgba(255, 255, 255, 0.12); color: #fff; padding: 0 16px; font-size: 0.92rem; outline: none; transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);" />
        
        <div style="position: relative; width: 100%;">
          <input type="password" id="auth-pass-input" class="apple-input-focus" placeholder="Password (min. 6 characters)" autocomplete="current-password" style="width: 100%; box-sizing: border-box; height: 46px; border-radius: 13px; background: #1a1a1e; border: 1px solid rgba(255, 255, 255, 0.12); color: #fff; padding: 0 42px 0 16px; font-size: 0.92rem; outline: none; transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);" />
          <button id="auth-pass-toggle-eye" type="button" style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); background: none; border: none; color: #86868b; cursor: pointer; padding: 4px; display: flex; align-items: center;">
            <svg id="auth-eye-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
          </button>
        </div>

        <button id="auth-pass-submit" class="apple-verify-btn">Sign In</button>

        <div style="display: flex; justify-content: center; margin-top: 4px; font-size: 0.82rem; color: #86868b;">
          <span id="auth-mode-label">Don't have an account?</span>
          <button id="auth-toggle-mode" type="button" style="background: none; border: none; color: #ffffff; font-weight: 600; cursor: pointer; text-decoration: underline; margin-left: 6px; padding: 0; font-size: 0.82rem;">Create Account</button>
        </div>
      </div>

      <!-- TAB 2: Email OTP Form -->
      <div id="auth-otp-wrapper" style="width: 100%; display: none; flex-direction: column;">
        <!-- Step 2A: Email Input -->
        <div id="auth-email-form" style="width: 100%; display: flex; flex-direction: column; gap: 14px;">
          <input type="email" id="auth-wall-email" class="apple-input-focus" placeholder="name@example.com" style="width: 100%; box-sizing: border-box; height: 46px; border-radius: 13px; background: #1a1a1e; border: 1px solid rgba(255, 255, 255, 0.12); color: #fff; padding: 0 16px; font-size: 0.92rem; outline: none; transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);" />
          <button id="auth-wall-send-code" class="apple-verify-btn">Continue with Email</button>
        </div>

        <!-- Step 2B: 6-Box OTP Inputs -->
        <div id="auth-otp-form" style="width: 100%; display: none; flex-direction: column; gap: 18px;">
          <div style="display: flex; justify-content: space-between; gap: 8px;">
            <input type="text" inputmode="numeric" maxlength="1" class="apple-otp-box" data-idx="0" placeholder="·" />
            <input type="text" inputmode="numeric" maxlength="1" class="apple-otp-box" data-idx="1" placeholder="·" />
            <input type="text" inputmode="numeric" maxlength="1" class="apple-otp-box" data-idx="2" placeholder="·" />
            <input type="text" inputmode="numeric" maxlength="1" class="apple-otp-box" data-idx="3" placeholder="·" />
            <input type="text" inputmode="numeric" maxlength="1" class="apple-otp-box" data-idx="4" placeholder="·" />
            <input type="text" inputmode="numeric" maxlength="1" class="apple-otp-box" data-idx="5" placeholder="·" />
          </div>

          <button id="auth-wall-verify-code" class="apple-verify-btn">
            <span>Verify & Continue</span>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </button>

          <div style="font-size: 0.82rem; color: #86868b;">
            <span>Didn't receive the code? </span>
            <button id="auth-resend-btn" style="background: none; border: none; color: #fff; font-weight: 500; cursor: pointer; text-decoration: underline; padding: 0; font-size: 0.82rem;">Resend Code</button>
          </div>
        </div>
      </div>

      <!-- TAB 3: Magic Link Form -->
      <div id="auth-magic-wrapper" style="width: 100%; display: none; flex-direction: column; gap: 14px;">
        <input type="email" id="auth-magic-email" class="apple-input-focus" placeholder="name@example.com" style="width: 100%; box-sizing: border-box; height: 46px; border-radius: 13px; background: #1a1a1e; border: 1px solid rgba(255, 255, 255, 0.12); color: #fff; padding: 0 16px; font-size: 0.92rem; outline: none; transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);" />
        <button id="auth-magic-send" class="apple-verify-btn">Send Magic Link</button>
        <div id="auth-magic-status" style="display: none; width: 100%; box-sizing: border-box; background: rgba(52, 199, 89, 0.14); border: 1px solid rgba(52, 199, 89, 0.32); color: #34c759; padding: 10px 14px; border-radius: 12px; font-size: 0.84rem; line-height: 1.4; text-align: left;">
        </div>
      </div>

      <!-- Social Logins Divider -->
      <div style="display: flex; align-items: center; width: 100%; margin: 18px 0 14px 0; gap: 12px;">
        <div style="flex: 1; height: 1px; background: rgba(255,255,255,0.09);"></div>
        <span style="font-size: 0.72rem; color: #86868b; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 500;">Or continue with</span>
        <div style="flex: 1; height: 1px; background: rgba(255,255,255,0.09);"></div>
      </div>

      <!-- Social Buttons: Google & Discord -->
      <div style="width: 100%; display: flex; flex-direction: column; gap: 10px;">
        <button id="auth-wall-google-btn" class="apple-social-btn" style="background: #1c1c1f; border: 1px solid rgba(255, 255, 255, 0.12);">
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.66v3.05h3.87c2.26-2.09 3.675-5.17 3.675-9.15z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.87-3.05c-1.08.72-2.45 1.16-4.06 1.16-3.13 0-5.78-2.11-6.73-4.96H1.28v3.15C3.26 21.36 7.36 24 12 24z"/><path fill="#FBBC05" d="M5.27 14.24c-.25-.72-.38-1.49-.38-2.24s.13-1.52.38-2.24V6.61H1.28C.46 8.23 0 10.06 0 12s.46 3.77 1.28 5.39l3.99-3.15z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.36 0 3.26 2.64 1.28 6.61l3.99 3.15c.95-2.85 3.6-4.96 6.73-4.96z"/></svg>
          <span>Continue with Google</span>
        </button>

        <button id="auth-wall-discord-btn" class="apple-social-btn" style="background: rgba(88, 101, 242, 0.16); border: 1px solid rgba(88, 101, 242, 0.35);">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#5865F2"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
          <span>Continue with Discord</span>
        </button>

        <button id="auth-wall-guest-btn" class="apple-social-btn" style="background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.15); margin-top: 4px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>
          <span>Continue as Guest</span>
        </button>
      </div>

    </div>

    <!-- Footer -->
    <footer style="margin-top: 22px; font-size: 0.72rem; color: #52525b; letter-spacing: 0.12em; text-transform: uppercase;">
      Protected by trylyricsflow.com
    </footer>
  `;

  document.body.appendChild(wall);

  const errorEl = wall.querySelector('#auth-wall-error');
  const errorText = wall.querySelector('#auth-wall-error-text');

  function showError(msg) {
    if (!errorEl || !errorText) return;
    errorText.textContent = msg;
    errorEl.style.display = 'flex';
    errorEl.classList.remove('apple-shake');
    void errorEl.offsetWidth;
    errorEl.classList.add('apple-shake');
  }

  function clearError() {
    if (errorEl) errorEl.style.display = 'none';
  }

  // Tabs
  const tabPass = wall.querySelector('#auth-tab-pass');
  const tabOtp = wall.querySelector('#auth-tab-otp');
  const tabMagic = wall.querySelector('#auth-tab-magic');
  const passForm = wall.querySelector('#auth-pass-form');
  const otpWrapper = wall.querySelector('#auth-otp-wrapper');
  const magicWrapper = wall.querySelector('#auth-magic-wrapper');

  tabPass?.addEventListener('click', () => {
    clearError();
    tabPass.classList.add('active');
    tabOtp.classList.remove('active');
    tabMagic?.classList.remove('active');
    passForm.style.display = 'flex';
    otpWrapper.style.display = 'none';
    if (magicWrapper) magicWrapper.style.display = 'none';
  });

  tabOtp?.addEventListener('click', () => {
    clearError();
    tabOtp.classList.add('active');
    tabPass.classList.remove('active');
    tabMagic?.classList.remove('active');
    passForm.style.display = 'none';
    otpWrapper.style.display = 'flex';
    if (magicWrapper) magicWrapper.style.display = 'none';
  });

  tabMagic?.addEventListener('click', () => {
    clearError();
    tabMagic.classList.add('active');
    tabPass.classList.remove('active');
    tabOtp.classList.remove('active');
    passForm.style.display = 'none';
    otpWrapper.style.display = 'none';
    if (magicWrapper) magicWrapper.style.display = 'flex';
  });

  // Password Sign In / Sign Up Mode toggle
  let isSignUpMode = false;
  const passEmail = wall.querySelector('#auth-pass-email');
  const passName = wall.querySelector('#auth-pass-name');
  const passInput = wall.querySelector('#auth-pass-input');
  const passSubmit = wall.querySelector('#auth-pass-submit');
  const toggleModeBtn = wall.querySelector('#auth-toggle-mode');
  const modeLabel = wall.querySelector('#auth-mode-label');
  const toggleEyeBtn = wall.querySelector('#auth-pass-toggle-eye');

  passEmail?.addEventListener('input', clearError);
  passInput?.addEventListener('input', clearError);
  passName?.addEventListener('input', clearError);

  toggleModeBtn?.addEventListener('click', () => {
    clearError();
    isSignUpMode = !isSignUpMode;
    if (isSignUpMode) {
      passName.style.display = 'block';
      passSubmit.textContent = 'Create Account';
      modeLabel.textContent = 'Already have an account?';
      toggleModeBtn.textContent = 'Sign In';
    } else {
      passName.style.display = 'none';
      passSubmit.textContent = 'Sign In';
      modeLabel.textContent = "Don't have an account?";
      toggleModeBtn.textContent = 'Create Account';
    }
  });

  toggleEyeBtn?.addEventListener('click', () => {
    if (passInput.type === 'password') {
      passInput.type = 'text';
      toggleEyeBtn.style.color = '#fff';
    } else {
      passInput.type = 'password';
      toggleEyeBtn.style.color = '#86868b';
    }
  });

  passSubmit?.addEventListener('click', async () => {
    clearError();
    const email = passEmail?.value.trim().toLowerCase();
    const password = passInput?.value;
    const name = passName?.value.trim();

    if (!email || !email.includes('@')) {
      showError('Please enter a valid email address.');
      return;
    }
    if (!password || password.length < 6) {
      showError('Password must be at least 6 characters long.');
      return;
    }

    passSubmit.disabled = true;
    passSubmit.textContent = isSignUpMode ? 'Creating account...' : 'Signing in...';

    try {
      let respData = null;
      const endpoint = isSignUpMode ? '/v1/auth/signup' : '/v1/auth/login';
      const localResp = await fetch(`${getApiBase()}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, name, force_new: isSignUpMode })
      });
      if (!localResp.ok) {
        const errData = await localResp.json().catch(() => ({}));
        throw new Error(errData.error || 'Invalid credentials');
      }
      respData = await localResp.json();

      const token = respData.access_token
        ? (respData.access_token.startsWith('Bearer ') ? respData.access_token : `Bearer ${respData.access_token}`)
        : `Bearer lf_usr_${btoa(email).replace(/=/g, '')}`;
      const uid = respData.user_id || respData.user?.id || email.split('@')[0];
      const displayName = respData.name || name || 'Yaseen Mohamed';
      setUserAuthSession(token, email, uid);
      saveUserProfile({ name: displayName, email });
      syncUserDataFromCloud();
      removeAuthLock();
    } catch (err) {
      showError(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      passSubmit.disabled = false;
      passSubmit.textContent = isSignUpMode ? 'Create Account' : 'Sign In';
    }
  });

  // OAuth Google & Discord with Electron Popup and Deep Link Bridge
  async function startOAuth(provider) {
    clearError();
    try {
      localStorage.setItem('lf_auth_origin', window.location.origin);
    } catch (_) { }
    const isElectronOrFile = window.location.protocol === 'file:' || (navigator.userAgent && navigator.userAgent.includes('Electron'));
    const redirectUri = isElectronOrFile
      ? 'https://trylyricsflow.com//auth/callback'
      : `${window.location.origin}/`;

    let oauthUrl = '';
    try {
      const res = await fetch(`${getApiBase()}/v1/auth/oauth-url/${provider}?redirect_to=${encodeURIComponent(redirectUri)}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        oauthUrl = data.url;
      }
    } catch (_) { }

    if (!oauthUrl) {
      showError('Unable to generate OAuth URL. Please check server connection.');
      return;
    }

    if (isElectronOrFile) {
      const popup = window.open(oauthUrl, 'LyricsFlow Auth', 'width=540,height=680,menubar=no,toolbar=no');
      const pollTimer = setInterval(() => {
        try {
          if (!popup || popup.closed) {
            clearInterval(pollTimer);
          } else if (popup.location && popup.location.hash && popup.location.hash.includes('access_token=')) {
            const hash = popup.location.hash;
            popup.close();
            clearInterval(pollTimer);
            window.location.hash = hash;
            handleOAuthCallback();
          }
        } catch (_) {
          // Cross-origin restriction until redirect back to 127.0.0.1
        }
      }, 500);
    } else {
      window.location.href = oauthUrl;
    }
  }

  // Listen for message from popup bridge
  window.addEventListener('message', (e) => {
    if (e.origin !== window.location.origin) return;
    if (e.data && e.data.type === 'oauth_complete' && e.data.hash) {
      window.location.hash = e.data.hash;
      handleOAuthCallback();
    }
  });



  wall.querySelector('#auth-wall-google-btn')?.addEventListener('click', () => startOAuth('google'));
  wall.querySelector('#auth-wall-discord-btn')?.addEventListener('click', () => startOAuth('discord'));
  wall.querySelector('#auth-wall-guest-btn')?.addEventListener('click', () => {
    localStorage.setItem('lyricsflow_guest_mode', 'true');
    saveUserProfile({ name: 'Guest Listener' });
    removeAuthLock();
  });

  // Magic Link Flow
  const magicEmailInput = wall.querySelector('#auth-magic-email');
  const magicSendBtn = wall.querySelector('#auth-magic-send');
  const magicStatus = wall.querySelector('#auth-magic-status');

  magicEmailInput?.addEventListener('input', clearError);

  magicSendBtn?.addEventListener('click', async () => {
    const email = magicEmailInput?.value.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      showError('Please enter a valid email address.');
      return;
    }
    clearError();
    magicSendBtn.disabled = true;
    magicSendBtn.textContent = 'Sending Magic Link...';
    magicStatus.style.display = 'block';
    magicStatus.textContent = 'Sending...';
    magicStatus.style.color = '#fff';
    magicStatus.style.background = 'rgba(255, 255, 255, 0.1)';
    magicStatus.style.borderColor = 'rgba(255, 255, 255, 0.2)';

    try {
      const resp = await fetch(`${getApiBase()}/v1/auth/send-magic-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      let data = {};
      try {
        data = await resp.json();
      } catch (_) { }

      if (!resp.ok) throw new Error(data.error || 'Failed to send Magic Link');

      magicStatus.textContent = 'Magic Link sent! Please check your inbox and click the link to sign in.';
      magicStatus.style.color = '#34c759';
      magicStatus.style.background = 'rgba(52, 199, 89, 0.14)';
      magicStatus.style.borderColor = 'rgba(52, 199, 89, 0.32)';
      magicEmailInput.value = '';
    } catch (err) {
      const msg = err.message || 'Failed to send Magic Link.';
      showError(msg);
      magicStatus.style.display = 'none';
      if (msg.includes('create an account')) {
        setTimeout(() => {
          tabPass?.click();
          if (!isSignUpMode) toggleModeBtn?.click();
          if (passEmail && magicEmailInput) passEmail.value = magicEmailInput.value;
        }, 1200);
      }
    } finally {
      magicSendBtn.disabled = false;
      magicSendBtn.textContent = 'Send Magic Link';
    }
  });

  // OTP Flow
  const emailInput = wall.querySelector('#auth-wall-email');
  const sendBtn = wall.querySelector('#auth-wall-send-code');
  const emailForm = wall.querySelector('#auth-email-form');
  const otpForm = wall.querySelector('#auth-otp-form');
  const otpBoxes = Array.from(wall.querySelectorAll('.apple-otp-box'));
  const verifyBtn = wall.querySelector('#auth-wall-verify-code');
  const resendBtn = wall.querySelector('#auth-resend-btn');
  const titleEl = wall.querySelector('#auth-wall-title');
  const subtitleEl = wall.querySelector('#auth-wall-subtitle');

  emailInput?.addEventListener('input', clearError);

  let currentEmail = '';
  let countdownTimer = null;
  let countdown = 60;

  function startCountdown() {
    countdown = 60;
    resendBtn.disabled = true;
    resendBtn.style.color = '#71717a';
    resendBtn.style.cursor = 'not-allowed';
    resendBtn.style.textDecoration = 'none';
    resendBtn.textContent = `Resend in ${countdown}s`;

    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      countdown--;
      if (countdown <= 0) {
        clearInterval(countdownTimer);
        resendBtn.disabled = false;
        resendBtn.style.color = '#ffffff';
        resendBtn.style.cursor = 'pointer';
        resendBtn.style.textDecoration = 'underline';
        resendBtn.textContent = 'Resend Code';
      } else {
        resendBtn.textContent = `Resend in ${countdown}s`;
      }
    }, 1000);
  }

  // 6-box OTP auto advance
  otpBoxes.forEach((box, idx) => {
    box.addEventListener('input', (e) => {
      clearError();
      const val = box.value.replace(/[^0-9]/g, '');
      box.value = val ? val.slice(-1) : '';
      if (val && idx < 5) {
        otpBoxes[idx + 1].focus();
      }
      const code = otpBoxes.map(b => b.value).join('');
      if (code.length === 6) {
        verifyCode(code);
      }
    });

    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && idx > 0) {
        otpBoxes[idx - 1].focus();
      }
    });

    box.addEventListener('paste', (e) => {
      e.preventDefault();
      clearError();
      const text = (e.clipboardData || window.clipboardData).getData('text').trim();
      const digits = text.replace(/[^0-9]/g, '').slice(0, 6);
      if (digits.length === 6) {
        digits.split('').forEach((d, i) => {
          if (otpBoxes[i]) otpBoxes[i].value = d;
        });
        otpBoxes[5].focus();
        verifyCode(digits);
      }
    });
  });

  async function sendOtp(email) {
    clearError();
    currentEmail = email;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending code...';
    try {
      const resp = await fetch(`${getApiBase()}/v1/auth/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      let data = {};
      try {
        data = await resp.json();
      } catch (_) {
        const text = await resp.text().catch(() => '');
        throw new Error(text || `Server error (${resp.status})`);
      }
      if (!resp.ok) throw new Error(data.error || data.message || `Server error (${resp.status})`);

      emailForm.style.display = 'none';
      otpForm.style.display = 'flex';
      titleEl.textContent = 'Check your inbox';
      subtitleEl.innerHTML = `We’ve sent a 6-digit verification code to <span style="color: #fff; font-weight: 500;">${email}</span>.`;
      startCountdown();
      setTimeout(() => otpBoxes[0].focus(), 100);
    } catch (err) {
      const msg = err.message || 'Failed to send verification code.';
      showError(msg);
      if (msg.includes('create an account')) {
        setTimeout(() => {
          tabPass?.click();
          if (!isSignUpMode) toggleModeBtn?.click();
          if (passEmail && emailInput) passEmail.value = emailInput.value;
        }, 1200);
      }
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Continue with Email';
    }
  }

  async function verifyCode(code) {
    clearError();
    if (code.length < 6) {
      showError('Please enter all 6 digits.');
      return;
    }
    verifyBtn.disabled = true;
    verifyBtn.innerHTML = `<span>Verifying...</span>`;
    try {
      const resp = await fetch(`${getApiBase()}/v1/auth/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentEmail, code })
      });
      let data = {};
      try {
        data = await resp.json();
      } catch (_) {
        const text = await resp.text().catch(() => '');
        throw new Error(text || `Server error (${resp.status})`);
      }
      if (!resp.ok) throw new Error(data.error || data.message || 'Invalid verification code');
      if (!data.access_token) throw new Error('No access token received from server');
      const token = `Bearer ${data.access_token}`;
      setUserAuthSession(token, currentEmail, data.user_id || currentEmail.split('@')[0]);
      syncUserDataFromCloud();
      removeAuthLock();
    } catch (err) {
      showError(err.message || 'Verification failed. Please check the code.');
      verifyBtn.disabled = false;
      verifyBtn.innerHTML = `<span>Verify & Continue</span>`;
    }
  }

  sendBtn?.addEventListener('click', () => {
    const email = emailInput?.value.trim();
    if (!email || !email.includes('@')) {
      showError('Please enter a valid email address.');
      return;
    }
    sendOtp(email);
  });

  verifyBtn?.addEventListener('click', () => {
    const code = otpBoxes.map(b => b.value).join('');
    verifyCode(code);
  });

  resendBtn?.addEventListener('click', () => {
    if (countdown > 0) return;
    if (currentEmail) sendOtp(currentEmail);
  });
}

/**
 * Automatically pull latest library, continue-listening track, and listening history
 * for the authenticated canonical user ID.
 */
export async function syncUserDataFromCloud() {
  const token = getUserAuthToken();
  const apiBase = getApiBase();
  const headers = {};
  if (token) {
    headers['Authorization'] = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  }

  try {
    // 1. Sync Continue Listening
    const contResp = await fetch(`${apiBase}/v1/me/continue-listening`, { headers, credentials: 'include' });
    if (contResp.ok) {
      const contData = await contResp.json();
      if (contData && contData.track && contData.track.song_id) {
        localStorage.setItem('lyricsflow_last_played_track', JSON.stringify({
          id: contData.track.song_id,
          name: contData.track.title,
          artist: contData.track.artist,
          artUrl: contData.track.artwork_url,
          currentTime: (contData.track.position_ms || 0) / 1000,
          duration: (contData.track.duration_ms || 0) / 1000
        }));
      }
    }
  } catch (_) { }

  try {
    // 2. Sync Library Songs
    const libResp = await fetch(`${apiBase}/v1/me/library/songs`, { headers, credentials: 'include' });
    if (libResp.ok) {
      const libData = await libResp.json();
      if (libData && Array.isArray(libData.songs)) {
        let currentLib = { songs: [], albums: [], artists: [] };
        try {
          const raw = localStorage.getItem('lyricsflow_user_library');
          if (raw) currentLib = JSON.parse(raw);
        } catch (_) { }
        const remoteSongs = libData.songs.map(s => ({
          id: String(s.song_id),
          type: 'song',
          name: s.title || 'Unknown Song',
          artist: s.artist || 'Unknown Artist',
          artUrl: s.artwork_url || 'favicon.svg',
          addedAt: s.added_at ? s.added_at * 1000 : Date.now()
        }));
        currentLib.songs = remoteSongs;
        localStorage.setItem('lyricsflow_user_library', JSON.stringify(currentLib));
        window.dispatchEvent(new CustomEvent('lyricsflow-library-changed', { detail: currentLib }));
      }
    }
  } catch (_) { }

  try {
    // 3. Sync Recently Played
    const recResp = await fetch(`${apiBase}/v1/me/recently-played?limit=50`, { headers, credentials: 'include' });
    if (recResp.ok) {
      const recData = await recResp.json();
      if (recData && Array.isArray(recData.recent)) {
        const formattedRecent = recData.recent.map(r => ({
          trackId: r.song_id,
          id: r.song_id,
          trackName: r.title,
          artistName: r.artist,
          artworkUrl100: r.artwork_url,
          playedAt: r.played_at
        }));
        localStorage.setItem('lyricsflow_recent_tracks', JSON.stringify(formattedRecent));
      }
    }
  } catch (_) { }
}

export function removeAuthLock() {
  document.body.classList.remove('lf-locked');
  const wall = document.getElementById('lyricsflow-auth-wall');
  if (wall) wall.remove();
  const cloak = document.getElementById('lf-auth-cloak-style');
  if (cloak) cloak.remove();

  // Trigger background cloud rehydration
  syncUserDataFromCloud();

  // Connected Onboarding: trigger Setup Assistant if first time!
  const isDone = localStorage.getItem(SETUP_KEY);
  if (!isDone) {
    showSetupAssistant();
  } else {
    updateProfileUI();
  }
}

/**
 * Checks if first-time setup is needed and displays macOS style modal.
 */
export async function checkFirstTimeSetup() {
  // Check server cookie session first with Authorization header
  try {
    const existingToken = getUserAuthToken();
    const headers = {};
    if (existingToken) {
      headers['Authorization'] = existingToken.startsWith('Bearer ') ? existingToken : `Bearer ${existingToken}`;
    }
    const res = await fetch(`${getApiBase()}/v1/auth/me`, { headers, credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      let cleanEmail = data.email || '';
      if (cleanEmail.startsWith('lf_') && cleanEmail.includes('_@')) {
        cleanEmail = cleanEmail.replace(/^lf_/, '').replace('_@', '@');
      }
      let serverName = data.name || (cleanEmail ? cleanEmail.split('@')[0] : 'Music Fan');
      if (serverName.startsWith('lf_')) {
        serverName = cleanEmail ? cleanEmail.split('@')[0] : 'Music Fan';
      }
      setUserAuthSession(data.token || existingToken, cleanEmail, data.user_id);
      saveUserProfile({
        name: serverName,
        pfp: data.pfp || DEFAULT_PFP,
        lang: data.lang || getCurrentLang(),
        theme: data.theme || 'dark-mode',
        enableAlac: data.enable_alac !== undefined ? Boolean(data.enable_alac) : true,
        enableDolby: data.enable_dolby !== undefined ? Boolean(data.enable_dolby) : true,
        audioQuality: data.audio_quality || 'alac',
        email: cleanEmail
      });
    } else {
      // If server responded with error (401/404), token is invalid — aggressively wipe session and lock
      setUserAuthSession('', '', '');
    }
  } catch (_) {
    // If server is unreachable/offline, prevent unauthorized access: do not auto-login or reveal profiles
    setUserAuthSession('', '', '');
  }

  enforceAuthLock();
  if (isUserAuthenticated()) {
    const isDone = localStorage.getItem(SETUP_KEY);
    if (!isDone) {
      showSetupAssistant();
    } else {
      updateProfileUI();
    }
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
        
        <label class="aero-field" style="margin-top: 14px;">
          <input type="text" id="setup-name-input" class="aero-input" placeholder="${t('setup_name_placeholder')}" autofocus autocomplete="off">
          <span class="aero-field-label">${t('setup_name_placeholder')}</span>
        </label>

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
              aeroAlert({ title: 'Invalid Image', message: 'Image file size must be less than 2MB.' });
              return;
            }
            if (file.type && !file.type.startsWith('image/')) {
              aeroAlert({ title: 'Invalid File', message: 'Only image files are allowed.' });
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
        <p class="am-setup-step-desc">Here are a few quick recommendations to make the most of LyricsFlow:</p>

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
 * Expansive Apple macOS System Settings dual-pane layout for landscape/fullscreen.
 */
export function openProfileSettingsModal() {
  const existing = document.getElementById('lyricsflow-profile-modal');
  if (existing) existing.remove();

  const profile = getUserProfile();
  let tempName = profile.name;
  let tempPfp = profile.pfp;
  let tempLang = profile.lang;
  let tempTheme = profile.theme || 'dark-mode';
  let tempAlac = profile.enableAlac !== undefined ? profile.enableAlac : true;
  let tempDolby = profile.enableDolby !== undefined ? profile.enableDolby : true;
  let tempSoundCheck = localStorage.getItem('lyricsflow_sound_check') === 'true';
  let tempCrossfade = localStorage.getItem('lyricsflow_crossfade') || '0';
  let tempDiscordRpc = localStorage.getItem('lyricsflow_discord_rpc') !== 'false';
  let activeTab = 'account';

  const overlay = document.createElement('div');
  overlay.className = 'am-macos-modal-overlay';
  overlay.id = 'lyricsflow-profile-modal';
  overlay.style.cssText = `
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    padding: 16px !important;
    box-sizing: border-box !important;
  `;

  const modalBox = document.createElement('div');
  modalBox.className = 'am-macos-window am-profile-settings-window';
  modalBox.style.cssText = `
    width: 95vw !important;
    max-width: 960px !important;
    height: 86vh !important;
    max-height: 740px !important;
    display: flex !important;
    flex-direction: column !important;
    border-radius: 20px !important;
    box-shadow: 0 40px 100px rgba(0, 0, 0, 0.88), inset 0 1px 0 rgba(255, 255, 255, 0.12) !important;
    background: #141416 !important;
    border: 1px solid rgba(255, 255, 255, 0.12) !important;
    overflow: hidden !important;
    position: relative !important;
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
  `;

  modalBox.innerHTML = `
    <!-- Top macOS Titlebar -->
    <div class="am-macos-titlebar" style="height: 44px; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; background: rgba(22, 22, 26, 0.95); border-bottom: 1px solid rgba(255, 255, 255, 0.08); user-select: none;">
      <div class="am-macos-traffic-lights" style="display: flex; gap: 8px;">
        <span class="am-tl-btn am-tl-red" id="prof-tl-close" title="Close" style="cursor: pointer;"></span>
        <span class="am-tl-btn am-tl-yellow" id="prof-tl-min" title="Minimize" style="cursor: pointer;"></span>
        <span class="am-tl-btn am-tl-green" id="prof-tl-max" title="Full Screen" style="cursor: pointer;"></span>
      </div>
      <div class="am-macos-title" style="font-size: 0.86rem; font-weight: 600; color: rgba(255, 255, 255, 0.9);">System Settings</div>
      <button id="prof-save-top-btn" style="background: #ffffff; color: #000; border: none; border-radius: 980px; padding: 4px 14px; font-size: 0.78rem; font-weight: 600; cursor: pointer; transition: all 0.2s;">Done</button>
    </div>

    <!-- Main Dual-Pane Body -->
    <div style="display: flex; flex: 1; min-height: 0; overflow: hidden;">
      
      <!-- Left Sidebar (macOS System Settings Style) -->
      <div style="width: 250px; background: rgba(20, 20, 24, 0.96); border-right: 1px solid rgba(255, 255, 255, 0.08); display: flex; flex-direction: column; padding: 14px 10px; gap: 4px; overflow-y: auto; flex-shrink: 0;">
        
        <!-- User Pill Header -->
        <div style="display: flex; align-items: center; gap: 10px; padding: 8px 10px; margin-bottom: 8px; border-radius: 12px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.06);">
          <img id="prof-side-avatar" src="${cleanArtworkUrl(tempPfp) || DEFAULT_PFP}" style="width: 38px; height: 38px; border-radius: 50%; object-fit: cover; border: 1px solid rgba(255,255,255,0.15);" alt="Avatar">
          <div style="flex: 1; min-width: 0; text-align: left;">
            <div id="prof-side-name" style="font-size: 0.86rem; font-weight: 600; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(tempName || DEFAULT_NAME)}</div>
            <div style="font-size: 0.72rem; color: #34c759; display: flex; align-items: center; gap: 4px;">
              <span style="width: 6px; height: 6px; border-radius: 50%; background: #34c759; display: inline-block;"></span>
              <span>Online</span>
            </div>
          </div>
        </div>

        <!-- Sidebar Navigation Buttons -->
        <button class="am-settings-nav-btn active" data-tab="account" style="display: flex; align-items: center; gap: 10px; width: 100%; height: 36px; padding: 0 12px; border: none; border-radius: 10px; background: rgba(255, 255, 255, 0.14); color: #fff; font-size: 0.84rem; font-weight: 500; cursor: pointer; text-align: left;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
          <span>Account & Sync</span>
        </button>

        <button class="am-settings-nav-btn" data-tab="appearance" style="display: flex; align-items: center; gap: 10px; width: 100%; height: 36px; padding: 0 12px; border: none; border-radius: 10px; background: transparent; color: rgba(255, 255, 255, 0.7); font-size: 0.84rem; font-weight: 500; cursor: pointer; text-align: left;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>
          <span>Appearance & Theme</span>
        </button>

        <button class="am-settings-nav-btn" data-tab="audio" style="display: flex; align-items: center; gap: 10px; width: 100%; height: 36px; padding: 0 12px; border: none; border-radius: 10px; background: transparent; color: rgba(255, 255, 255, 0.7); font-size: 0.84rem; font-weight: 500; cursor: pointer; text-align: left;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
          <span>Audio Quality</span>
        </button>

        <button class="am-settings-nav-btn" data-tab="discord" style="display: flex; align-items: center; gap: 10px; width: 100%; height: 36px; padding: 0 12px; border: none; border-radius: 10px; background: transparent; color: rgba(255, 255, 255, 0.7); font-size: 0.84rem; font-weight: 500; cursor: pointer; text-align: left;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="#5865F2"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
          <span>Discord Presence</span>
        </button>

        <button class="am-settings-nav-btn" data-tab="player" style="display: flex; align-items: center; gap: 10px; width: 100%; height: 36px; padding: 0 12px; border: none; border-radius: 10px; background: transparent; color: rgba(255, 255, 255, 0.7); font-size: 0.84rem; font-weight: 500; cursor: pointer; text-align: left;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
          <span>Player & Lyrics Engine</span>
        </button>

        <button class="am-settings-nav-btn" data-tab="storage" style="display: flex; align-items: center; gap: 10px; width: 100%; height: 36px; padding: 0 12px; border: none; border-radius: 10px; background: transparent; color: rgba(255, 255, 255, 0.7); font-size: 0.84rem; font-weight: 500; cursor: pointer; text-align: left;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 2H5c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 18c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm6-12H6V4h12v4z"/></svg>
          <span>Storage & Cache</span>
        </button>

        <button class="am-settings-nav-btn" data-tab="about" style="display: flex; align-items: center; gap: 10px; width: 100%; height: 36px; padding: 0 12px; border: none; border-radius: 10px; background: transparent; color: rgba(255, 255, 255, 0.7); font-size: 0.84rem; font-weight: 500; cursor: pointer; text-align: left;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
          <span>About LyricsFlow</span>
        </button>
      </div>

      <!-- Right Content Area -->
      <div id="prof-pane-content" style="flex: 1; padding: 26px 32px; overflow-y: auto; background: #0e0e10; text-align: left; box-sizing: border-box;">
        <!-- Dynamically injected via renderTabContent -->
      </div>
    </div>
  `;

  overlay.appendChild(modalBox);
  document.body.appendChild(overlay);

  // Traffic lights
  modalBox.querySelector('#prof-tl-close').addEventListener('click', () => overlay.remove());
  modalBox.querySelector('#prof-tl-min').addEventListener('click', () => overlay.remove());
  modalBox.querySelector('#prof-save-top-btn').addEventListener('click', () => saveAndClose());

  let isMax = false;
  const maxBtn = modalBox.querySelector('#prof-tl-max');
  maxBtn.addEventListener('click', () => {
    isMax = !isMax;
    if (isMax) {
      modalBox.style.width = '100vw';
      modalBox.style.height = '100vh';
      modalBox.style.maxWidth = '100vw';
      modalBox.style.maxHeight = '100vh';
      modalBox.style.borderRadius = '0';
    } else {
      modalBox.style.width = '95vw';
      modalBox.style.height = '86vh';
      modalBox.style.maxWidth = '960px';
      modalBox.style.maxHeight = '740px';
      modalBox.style.borderRadius = '20px';
    }
  });

  const paneContent = modalBox.querySelector('#prof-pane-content');
  const navBtns = modalBox.querySelectorAll('.am-settings-nav-btn');

  function renderTabContent() {
    if (!paneContent) return;

    if (activeTab === 'account') {
      const currToken = getUserAuthToken();
      const currProf = getUserProfile();
      paneContent.innerHTML = `
        <h2 style="font-size: 1.35rem; font-weight: 600; color: #fff; margin: 0 0 6px 0;">Account & Cloud Sync</h2>
        <p style="font-size: 0.84rem; color: #86868b; margin: 0 0 22px 0;">Manage your profile identity, avatar, and cloud library synchronization.</p>

        <!-- Profile Card -->
        <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 20px; display: flex; align-items: center; gap: 20px; margin-bottom: 20px;">
          <img id="prof-modal-avatar-preview" src="${cleanArtworkUrl(tempPfp) || DEFAULT_PFP}" style="width: 72px; height: 72px; border-radius: 50%; object-fit: cover; border: 2px solid rgba(255,255,255,0.2);" alt="Avatar">
          <div style="flex: 1;">
            <div style="display: flex; gap: 8px; margin-bottom: 12px;">
              ${PRESET_AVATARS.map(av => `
                <div class="am-avatar-choice ${av === tempPfp ? 'active' : ''}" data-src="${cleanArtworkUrl(av)}" style="width: 32px; height: 32px; border-radius: 50%; cursor: pointer; border: 2px solid ${av === tempPfp ? '#fa2d48' : 'rgba(255,255,255,0.2)'}; overflow: hidden;">
                  <img src="${cleanArtworkUrl(av)}" style="width: 100%; height: 100%; object-fit: cover;" alt="">
                </div>
              `).join('')}
            </div>
            <label class="am-macos-btn secondary" style="cursor: pointer; font-size: 0.78rem; padding: 4px 12px; display: inline-block;">
              Upload Custom Image
              <input type="file" id="prof-modal-pfp-input" accept="image/*" style="display: none;">
            </label>
          </div>
        </div>

        <!-- Name Field -->
        <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 18px; margin-bottom: 20px;">
          <label style="font-size: 0.84rem; font-weight: 600; color: #fff; display: block; margin-bottom: 8px;">Display Name</label>
          <input type="text" id="prof-modal-name-input" value="${escapeHTML(tempName || '')}" placeholder="Your display name" style="width: 100%; box-sizing: border-box; height: 42px; border-radius: 10px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: #fff; padding: 0 14px; font-size: 0.9rem; outline: none;" />
        </div>

        <!-- Session Status & Social Switch -->
        <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 18px;">
          <label style="font-size: 0.84rem; font-weight: 600; color: #fff; display: block; margin-bottom: 8px;">LyricsFlow Cloud Authentication</label>
          <div style="display: flex; align-items: center; justify-content: space-between; padding-bottom: 14px; border-bottom: 1px solid rgba(255,255,255,0.06);">
            <div>
              <div style="font-size: 0.9rem; font-weight: 600; color: #fff; display: flex; align-items: center; gap: 8px;">
                <span style="width: 8px; height: 8px; border-radius: 50%; background: ${currToken ? '#34c759' : '#ff9f0a'};"></span>
                <span>${escapeHTML(currProf.email || 'Local Dev Session')}</span>
              </div>
              <div style="font-size: 0.76rem; color: #86868b; margin-top: 2px;">Syncs playlists, loved tracks, and listening history with /v1/me/</div>
            </div>
            <div style="display: flex; gap: 8px;">
              <button id="prof-account-new" class="am-macos-btn secondary" style="color: #34c759; font-size: 0.8rem; padding: 4px 12px;">Create New Account</button>
              <button id="prof-account-signout" class="am-macos-btn secondary" style="color: #ff453a; font-size: 0.8rem; padding: 4px 12px;">Sign Out</button>
            </div>
          </div>

          <!-- Social link alternatives -->
          <div style="margin-top: 14px; display: flex; gap: 10px;">
            <button id="prof-link-google" class="apple-social-btn" style="flex: 1; height: 38px; background: #1a1a1e; border: 1px solid rgba(255,255,255,0.12); font-size: 0.82rem;">
              <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.66v3.05h3.87c2.26-2.09 3.675-5.17 3.675-9.15z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.87-3.05c-1.08.72-2.45 1.16-4.06 1.16-3.13 0-5.78-2.11-6.73-4.96H1.28v3.15C3.26 21.36 7.36 24 12 24z"/><path fill="#FBBC05" d="M5.27 14.24c-.25-.72-.38-1.49-.38-2.24s.13-1.52.38-2.24V6.61H1.28C.46 8.23 0 10.06 0 12s.46 3.77 1.28 5.39l3.99-3.15z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.36 0 3.26 2.64 1.28 6.61l3.99 3.15c.95-2.85 3.6-4.96 6.73-4.96z"/></svg>
              <span>Connect Google</span>
            </button>
            <button id="prof-link-discord" class="apple-social-btn" style="flex: 1; height: 38px; background: rgba(88,101,242,0.16); border: 1px solid rgba(88,101,242,0.35); font-size: 0.82rem;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#5865F2"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
              <span>Connect Discord</span>
            </button>
          </div>
        </div>
      `;

      // Preset avatar choice
      paneContent.querySelectorAll('.am-avatar-choice').forEach(choice => {
        choice.addEventListener('click', () => {
          paneContent.querySelectorAll('.am-avatar-choice').forEach(x => x.style.borderColor = 'rgba(255,255,255,0.2)');
          choice.style.borderColor = '#fa2d48';
          tempPfp = choice.dataset.src;
          paneContent.querySelector('#prof-modal-avatar-preview').src = cleanArtworkUrl(tempPfp);
          modalBox.querySelector('#prof-side-avatar').src = cleanArtworkUrl(tempPfp);
        });
      });

      // Name live sync
      paneContent.querySelector('#prof-modal-name-input')?.addEventListener('input', (e) => {
        tempName = e.target.value.trim() || DEFAULT_NAME;
        modalBox.querySelector('#prof-side-name').textContent = tempName;
      });

      // File upload
      paneContent.querySelector('#prof-modal-pfp-input')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            tempPfp = evt.target.result;
            paneContent.querySelector('#prof-modal-avatar-preview').src = tempPfp;
            modalBox.querySelector('#prof-side-avatar').src = tempPfp;
          };
          reader.readAsDataURL(file);
        }
      });

      // Create new account
      paneContent.querySelector('#prof-account-new')?.addEventListener('click', () => {
        setUserAuthSession('', '', '');
        overlay.remove();
        showAuthWall();
        setTimeout(() => {
          const toggleBtn = document.getElementById('auth-toggle-mode');
          const passName = document.getElementById('auth-pass-name');
          const passSubmit = document.getElementById('auth-pass-submit');
          const modeLabel = document.getElementById('auth-mode-label');
          if (toggleBtn && passName && passSubmit) {
            passName.style.display = 'block';
            passSubmit.textContent = 'Create Account';
            if (modeLabel) modeLabel.textContent = 'Already have an account?';
            toggleBtn.textContent = 'Sign In';
          }
        }, 50);
      });

      // Sign out
      paneContent.querySelector('#prof-account-signout')?.addEventListener('click', () => {
        setUserAuthSession('', '', '');
        overlay.remove();
        enforceAuthLock();
      });

      paneContent.querySelector('#prof-link-google')?.addEventListener('click', async () => {
        const isElectronOrFile = window.location.protocol === 'file:' || (navigator.userAgent && navigator.userAgent.includes('Electron'));
        const redirectUri = isElectronOrFile ? 'https://trylyricsflow.com//auth/callback' : `${window.location.origin}/`;
        try {
          const res = await fetch(`${getApiBase()}/v1/auth/oauth-url/google?redirect_to=${encodeURIComponent(redirectUri)}`, { credentials: 'include' });
          if (res.ok) {
            const d = await res.json();
            if (d.url) window.location.href = d.url;
          }
        } catch (_) { }
      });
      paneContent.querySelector('#prof-link-discord')?.addEventListener('click', async () => {
        const isElectronOrFile = window.location.protocol === 'file:' || (navigator.userAgent && navigator.userAgent.includes('Electron'));
        const redirectUri = isElectronOrFile ? 'https://trylyricsflow.com//auth/callback' : `${window.location.origin}/`;
        try {
          const res = await fetch(`${getApiBase()}/v1/auth/oauth-url/discord?redirect_to=${encodeURIComponent(redirectUri)}`, { credentials: 'include' });
          if (res.ok) {
            const d = await res.json();
            if (d.url) window.location.href = d.url;
          }
        } catch (_) { }
      });

    } else if (activeTab === 'appearance') {
      paneContent.innerHTML = `
        <h2 style="font-size: 1.35rem; font-weight: 600; color: #fff; margin: 0 0 6px 0;">Appearance & Theme</h2>
        <p style="font-size: 0.84rem; color: #86868b; margin: 0 0 22px 0;">Customize the visual presentation and system theming of LyricsFlow.</p>

        <!-- Theme Cards -->
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 22px;">
          <div class="am-theme-card ${tempTheme === 'dark-mode' ? 'active' : ''}" data-theme="dark-mode" style="background: #1c1c1e; border: 2px solid ${tempTheme === 'dark-mode' ? '#fa2d48' : 'rgba(255,255,255,0.1)'}; border-radius: 14px; padding: 16px; cursor: pointer; text-align: center;">
            <div style="width: 100%; height: 50px; background: #2c2c2e; border-radius: 8px; margin-bottom: 10px;"></div>
            <div style="font-size: 0.88rem; font-weight: 600; color: #fff;">Dark Mode</div>
          </div>
          <div class="am-theme-card ${tempTheme === 'oled-black' ? 'active' : ''}" data-theme="oled-black" style="background: #000000; border: 2px solid ${tempTheme === 'oled-black' ? '#fa2d48' : 'rgba(255,255,255,0.1)'}; border-radius: 14px; padding: 16px; cursor: pointer; text-align: center;">
            <div style="width: 100%; height: 50px; background: #000000; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; margin-bottom: 10px;"></div>
            <div style="font-size: 0.88rem; font-weight: 600; color: #fff;">OLED Black</div>
          </div>
          <div class="am-theme-card ${tempTheme === 'light-mode' ? 'active' : ''}" data-theme="light-mode" style="background: #f2f2f7; border: 2px solid ${tempTheme === 'light-mode' ? '#fa2d48' : 'rgba(255,255,255,0.1)'}; border-radius: 14px; padding: 16px; cursor: pointer; text-align: center;">
            <div style="width: 100%; height: 50px; background: #ffffff; border-radius: 8px; margin-bottom: 10px;"></div>
            <div style="font-size: 0.88rem; font-weight: 600; color: #000;">Light Mode</div>
          </div>
        </div>

        <!-- Language Selector -->
        <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 18px;">
          <label style="font-size: 0.84rem; font-weight: 600; color: #fff; display: block; margin-bottom: 8px;">Interface Language</label>
          ${langDropdownHTML('prof-modal-lang-select', tempLang)}
        </div>
      `;

      paneContent.querySelectorAll('.am-theme-card').forEach(card => {
        card.addEventListener('click', () => {
          paneContent.querySelectorAll('.am-theme-card').forEach(c => c.style.borderColor = 'rgba(255,255,255,0.1)');
          card.style.borderColor = '#fa2d48';
          tempTheme = card.dataset.theme;
          applyMainTheme(tempTheme);
        });
      });

      const langDrop = paneContent.querySelector('#prof-modal-lang-select');
      if (langDrop) {
        initDropdowns(langDrop.parentElement);
        langDrop.addEventListener('click', (e) => {
          const item = e.target.closest('.aero-menu-item');
          if (!item) return;
          tempLang = item.dataset.value;
          setLanguage(tempLang);
          langDrop.querySelector('[data-aero-dropdown]').textContent = item.textContent;
        });
      }

    } else if (activeTab === 'audio') {
      paneContent.innerHTML = `
        <h2 style="font-size: 1.35rem; font-weight: 600; color: #fff; margin: 0 0 6px 0;">Audio Quality & Playback</h2>
        <p style="font-size: 0.84rem; color: #86868b; margin: 0 0 22px 0;">Configure lossless streaming resolutions, spatial surround audio, and sound normalization.</p>

        <div style="display: flex; flex-direction: column; gap: 12px;">
          <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 16px 20px;">
            <div>
              <div style="font-size: 0.92rem; font-weight: 600; color: #fff;">Lossless Audio (ALAC)</div>
              <div style="font-size: 0.78rem; color: #86868b;">Stream uncompressed bit-perfect audio up to 24-bit/192kHz resolution.</div>
            </div>
            <label class="am-macos-switch" style="cursor: pointer;">
              <input type="checkbox" id="prof-audio-alac" ${tempAlac ? 'checked' : ''}>
              <span class="am-macos-slider" style="background-color: ${tempAlac ? '#fa2d48' : 'rgba(255,255,255,0.2)'};"></span>
            </label>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 16px 20px;">
            <div>
              <div style="font-size: 0.92rem; font-weight: 600; color: #fff;">Dolby Atmos / Spatial Audio</div>
              <div style="font-size: 0.78rem; color: #86868b;">Multi-dimensional spatial acoustic rendering.</div>
            </div>
            <label class="am-macos-switch" style="cursor: pointer;">
              <input type="checkbox" id="prof-audio-dolby" ${tempDolby ? 'checked' : ''}>
              <span class="am-macos-slider" style="background-color: ${tempDolby ? '#fa2d48' : 'rgba(255,255,255,0.2)'};"></span>
            </label>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 16px 20px;">
            <div>
              <div style="font-size: 0.92rem; font-weight: 600; color: #fff;">Sound Check (Normalization)</div>
              <div style="font-size: 0.78rem; color: #86868b;">Maintains consistent volume levels between loud and quiet tracks.</div>
            </div>
            <label class="am-macos-switch" style="cursor: pointer;">
              <input type="checkbox" id="prof-audio-norm" ${tempSoundCheck ? 'checked' : ''}>
              <span class="am-macos-slider" style="background-color: ${tempSoundCheck ? '#fa2d48' : 'rgba(255,255,255,0.2)'};"></span>
            </label>
          </div>
        </div>
      `;

      paneContent.querySelector('#prof-audio-alac')?.addEventListener('change', (e) => {
        tempAlac = e.target.checked;
        e.target.nextElementSibling.style.backgroundColor = tempAlac ? '#fa2d48' : 'rgba(255,255,255,0.2)';
      });
      paneContent.querySelector('#prof-audio-dolby')?.addEventListener('change', (e) => {
        tempDolby = e.target.checked;
        e.target.nextElementSibling.style.backgroundColor = tempDolby ? '#fa2d48' : 'rgba(255,255,255,0.2)';
      });
      paneContent.querySelector('#prof-audio-norm')?.addEventListener('change', (e) => {
        tempSoundCheck = e.target.checked;
        localStorage.setItem('lyricsflow_sound_check', tempSoundCheck ? 'true' : 'false');
        e.target.nextElementSibling.style.backgroundColor = tempSoundCheck ? '#fa2d48' : 'rgba(255,255,255,0.2)';
      });

    } else if (activeTab === 'discord') {
      paneContent.innerHTML = `
        <h2 style="font-size: 1.35rem; font-weight: 600; color: #fff; margin: 0 0 6px 0;">Discord Rich Presence</h2>
        <p style="font-size: 0.84rem; color: #86868b; margin: 0 0 22px 0;">Broadcast your current song and real-time lyric line directly to your Discord profile.</p>

        <div style="display: flex; flex-direction: column; gap: 14px;">
          <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 16px 20px;">
            <div>
              <div style="font-size: 0.92rem; font-weight: 600; color: #fff;">Enable Discord Rich Presence</div>
              <div style="font-size: 0.78rem; color: #86868b;">Shows song title, artist, album artwork, and time elapsed.</div>
            </div>
            <label class="am-macos-switch" style="cursor: pointer;">
              <input type="checkbox" id="prof-discord-toggle" ${tempDiscordRpc ? 'checked' : ''}>
              <span class="am-macos-slider" style="background-color: ${tempDiscordRpc ? '#5865F2' : 'rgba(255,255,255,0.2)'};"></span>
            </label>
          </div>

          <div style="background: rgba(88, 101, 242, 0.12); border: 1px solid rgba(88, 101, 242, 0.3); border-radius: 14px; padding: 20px; display: flex; align-items: center; justify-content: space-between;">
            <div>
              <div style="font-size: 0.95rem; font-weight: 600; color: #fff;">Join the LyricsFlow Community</div>
              <div style="font-size: 0.78rem; color: rgba(255,255,255,0.7); margin-top: 2px;">Share lyric syncs, request song TTMLs, and get instant support.</div>
            </div>
            <a href="https://discord.gg/VBU2BuqsC" target="_blank" rel="noopener noreferrer" style="background: #5865F2; color: #fff; text-decoration: none; padding: 8px 16px; border-radius: 10px; font-size: 0.84rem; font-weight: 600; white-space: nowrap;">Join Server</a>
          </div>
        </div>
      `;

      paneContent.querySelector('#prof-discord-toggle')?.addEventListener('change', (e) => {
        tempDiscordRpc = e.target.checked;
        localStorage.setItem('lyricsflow_discord_rpc', tempDiscordRpc ? 'true' : 'false');
        try {
          if (window.lyricsflowSettingsManager) {
            window.lyricsflowSettingsManager.set('discordRpc', tempDiscordRpc);
          }
          if (!tempDiscordRpc) {
            const api = window.wave || window.lyricsflow;
            if (api?.clearDiscordPresence) api.clearDiscordPresence();
          }
        } catch (_) { }
        e.target.nextElementSibling.style.backgroundColor = tempDiscordRpc ? '#5865F2' : 'rgba(255,255,255,0.2)';
      });

    } else if (activeTab === 'player') {
      paneContent.innerHTML = `
        <h2 style="font-size: 1.35rem; font-weight: 600; color: #fff; margin: 0 0 6px 0;">Player & Lyrics Engine</h2>
        <p style="font-size: 0.84rem; color: #86868b; margin: 0 0 22px 0;">AMLL Syllable karaoke animation settings, furigana rendering, and TTML parameters.</p>

        <div style="display: flex; flex-direction: column; gap: 14px;">
          <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 20px; display: flex; align-items: center; justify-content: space-between;">
            <div>
              <div style="font-size: 0.95rem; font-weight: 600; color: #fff;">Advanced AMLL Player Settings</div>
              <div style="font-size: 0.78rem; color: #86868b; margin-top: 2px;">Font families, romanization, karaoke spring physics, and background shaders.</div>
            </div>
            <button id="prof-launch-player-settings" class="am-macos-btn primary" style="font-size: 0.84rem; padding: 8px 16px;">Open Player Config</button>
          </div>
        </div>
      `;

      paneContent.querySelector('#prof-launch-player-settings')?.addEventListener('click', () => {
        overlay.remove();
        settingsUI.show();
      });

    } else if (activeTab === 'storage') {
      paneContent.innerHTML = `
        <h2 style="font-size: 1.35rem; font-weight: 600; color: #fff; margin: 0 0 6px 0;">Storage & Cache</h2>
        <p style="font-size: 0.84rem; color: #86868b; margin: 0 0 22px 0;">Manage local storage, offline artwork caches, and downloaded lyric files.</p>

        <div style="display: flex; flex-direction: column; gap: 12px;">
          <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 18px; display: flex; align-items: center; justify-content: space-between;">
            <div>
              <div style="font-size: 0.92rem; font-weight: 600; color: #fff;">Clear Cached Artworks & Previews</div>
              <div style="font-size: 0.78rem; color: #86868b;">Frees up browser memory and temporary artwork caches.</div>
            </div>
            <button id="prof-clear-art-cache" class="am-macos-btn secondary" style="font-size: 0.8rem; padding: 6px 14px;">Clear Cache</button>
          </div>

          <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 18px; display: flex; align-items: center; justify-content: space-between;">
            <div>
              <div style="font-size: 0.92rem; font-weight: 600; color: #fff;">Reset Local Configuration</div>
              <div style="font-size: 0.78rem; color: #86868b;">Resets UI preferences back to defaults.</div>
            </div>
            <button id="prof-reset-prefs" class="am-macos-btn secondary" style="color: #ff453a; font-size: 0.8rem; padding: 6px 14px;">Reset Defaults</button>
          </div>
        </div>
      `;

      paneContent.querySelector('#prof-clear-art-cache')?.addEventListener('click', () => {
        aeroAlert({ title: 'Cache Cleared', message: 'Artwork and preview caches have been cleared.' });
      });

      paneContent.querySelector('#prof-reset-prefs')?.addEventListener('click', () => {
        localStorage.removeItem(PROFILE_KEY);
        aeroAlert({ title: 'Preferences Reset', message: 'Preferences reset to defaults.' });
      });

    } else if (activeTab === 'about') {
      paneContent.innerHTML = `
        <h2 style="font-size: 1.35rem; font-weight: 600; color: #fff; margin: 0 0 6px 0;">About LyricsFlow</h2>
        <p style="font-size: 0.84rem; color: #86868b; margin: 0 0 22px 0;">Next-generation synchronized Apple Music lyrics client.</p>

        <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 24px; text-align: center; margin-bottom: 18px;">
          <div style="width: 58px; height: 58px; border-radius: 18px; background: linear-gradient(135deg, #fa2d48, #af52de); display: inline-flex; align-items: center; justify-content: center; margin-bottom: 12px; box-shadow: 0 8px 24px rgba(250, 45, 72, 0.35);">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="#fff"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
          </div>
          <div style="font-size: 1.25rem; font-weight: 700; color: #fff;">LyricsFlow</div>
          <div style="font-size: 0.8rem; color: #86868b; margin-top: 2px;">Version 2.6.0 (Build 2026.10)</div>
          <div style="font-size: 0.78rem; color: rgba(255,255,255,0.6); margin-top: 10px;">
            Built with fluid Apple WWDC interface design, AMLL Syllable TTML engine, and Supabase Auth.
          </div>
        </div>

        <div style="display: flex; gap: 12px;">
          <a href="https://trylyricsflow.com" target="_blank" rel="noopener noreferrer" class="am-macos-btn secondary" style="flex: 1; text-align: center; text-decoration: none; font-size: 0.84rem; padding: 8px 0;">Official Website</a>
          <a href="https://github.com/trylyricsflow" target="_blank" rel="noopener noreferrer" class="am-macos-btn secondary" style="flex: 1; text-align: center; text-decoration: none; font-size: 0.84rem; padding: 8px 0;">GitHub Repository</a>
        </div>
      `;
    }
  }

  renderTabContent();

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      navBtns.forEach(b => {
        b.classList.remove('active');
        b.style.background = 'transparent';
        b.style.color = 'rgba(255,255,255,0.7)';
      });
      btn.classList.add('active');
      btn.style.background = 'rgba(255, 255, 255, 0.14)';
      btn.style.color = '#ffffff';
      activeTab = btn.dataset.tab;
      renderTabContent();
    });
  });

  function saveAndClose() {
    const newProfile = {
      name: tempName || DEFAULT_NAME,
      pfp: tempPfp,
      lang: tempLang,
      theme: tempTheme,
      enableAlac: tempAlac,
      enableDolby: tempDolby,
      audioQuality: tempAlac ? 'alac' : (tempDolby ? 'dolby' : 'aac')
    };
    saveUserProfile(newProfile);
    try {
      fetch(`${getApiBase()}/v1/me/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(newProfile)
      }).catch(() => { });
    } catch (_) { }
    overlay.remove();
  }
}

/**
 * Open Player Settings directly using settingsUI
 */
export function openPlayerSettingsModal() {
  settingsUI.show();
}

