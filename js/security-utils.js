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
 * Supports custom width, height, and format tokens (e.g. 520x293sr.webp),
 * defaulting to 1200x1200bb.jpg for album/song artwork.
 * @param {string} url - Artwork URL
 * @param {number|string} [w=1200] - Desired width
 * @param {number|string} [h=1200] - Desired height / aspect ratio code (e.g. '293sr')
 * @param {string} [format='jpg'] - File extension (e.g. 'webp', 'jpg')
 * @returns {string} Sanitized formatted URL
 */
export function cleanArtworkUrl(url, w = 1200, h = 1200, format = null) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  // Disallow javascript:, vbscript:, and non-image data URIs
  if (/^(javascript|vbscript|data:(?!image\/))/i.test(trimmed)) {
    return '';
  }

  const isCustomSpec = typeof h === 'string' && (h.includes('sr') || h.includes('bb') || h.includes('bf'));
  const targetW = String(w || 1200);
  const targetH = isCustomSpec ? String(h) : String(h || 1200);
  const targetFormat = format || (isCustomSpec ? 'webp' : 'jpg');

  let cleaned = trimmed
    .replace('{w}', targetW)
    .replace('{h}', targetH)
    .replace('{c}', '')
    .replace('{f}', targetFormat);

  if (isCustomSpec) {
    if (/\/\d+x\d+(?:bb|sr|bf)\.[a-zA-Z0-9]+/.test(cleaned)) {
      cleaned = cleaned.replace(/\/\d+x\d+(?:bb|sr|bf)\.[a-zA-Z0-9]+/, `/${targetW}x${targetH}.${targetFormat}`);
    }
  } else if (/\/\d+x\d+bb\./.test(cleaned)) {
    cleaned = cleaned.replace(/\/\d+x\d+bb\./, `/${targetW}x${targetH}bb.`);
  }

  if (!/^(https?:|data:image\/|blob:)/i.test(cleaned) && !cleaned.startsWith('/') && !cleaned.startsWith('favicon.') && !cleaned.startsWith('icons/')) {
    return '';
  }
  return cleaned.replace(/["'<>\s\\]/g, c => encodeURIComponent(c));
}

/**
 * Sanitizes plain text content for safe DOM element insertion.
 * Neutralizes any script tags, HTML tags, or event handler attributes.
 * @param {*} val - Value to sanitize
 * @returns {string} Safe plain text
 */
export function sanitizeText(val) {
  if (val == null) return '';
  const str = String(val);
  return str.replace(/[&<>"']/g, c => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#039;';
      default: return c;
    }
  });
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

