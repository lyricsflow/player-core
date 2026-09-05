/**
 * security-utils.js
 * Provides functions for sanitizing and securing the application.
 */

/**
 * Escapes HTML special characters to prevent XSS.
 * @param {string} str - The string to escape.
 * @returns {string} The escaped string.
 */
export function escapeHTML(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Sanitizes and formats an artwork URL safely to prevent XSS / CSS injection.
 * @param {string} url - Artwork URL
 * @param {number} [w=300] - Desired width
 * @param {number} [h=300] - Desired height
 * @returns {string} Sanitized URL
 */
export function cleanArtworkUrl(url, w = 300, h = 300) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  // Disallow javascript:, vbscript:, and non-image data URIs
  if (/^(javascript|vbscript|data:(?!image\/))/i.test(trimmed)) {
    return '';
  }
  let cleaned = trimmed
    .replace('{w}', String(w))
    .replace('{h}', String(h))
    .replace('{c}', '')
    .replace('{f}', 'jpg');
  if (w > 100 && /\/\d+x\d+bb\./.test(cleaned)) {
    cleaned = cleaned.replace(/\/\d+x\d+bb\./, `/${w}x${h}bb.`);
  }
  if (!/^(https?:|data:image\/|blob:)/i.test(cleaned) && !cleaned.startsWith('/') && !cleaned.startsWith('favicon.') && !cleaned.startsWith('icons/')) {
    return '';
  }
  return cleaned.replace(/["'<>\s\\]/g, c => encodeURIComponent(c));
}

/**
 * Validates and sanitizes generic URLs to prevent javascript:/data: injection.
 * @param {string} url - Target URL
 * @param {string[]} [allowedSchemes=['http:', 'https:', 'blob:']]
 * @returns {string} Sanitized URL or empty string if invalid
 */
export function sanitizeUrl(url, allowedSchemes = ['http:', 'https:', 'blob:']) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (trimmed.startsWith('/') || trimmed.startsWith('./')) return trimmed;
  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (allowedSchemes.includes(parsed.protocol)) {
      return parsed.href;
    }
  } catch (_) {}
  return '';
}

