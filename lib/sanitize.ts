// Shared sanitization helpers to prevent stored XSS and validate common inputs
export function encodeHtmlEntities(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeText(value: unknown, maxLen = 100) {
  if (typeof value !== 'string') return null;
  let trimmed = value.trim();
  if (trimmed.length === 0) return null;
  // Remove HTML tags
  trimmed = trimmed.replace(/<[^>]*>/g, '');
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLen) trimmed = trimmed.slice(0, maxLen);
  return encodeHtmlEntities(trimmed);
}

export function validateUrl(value: unknown, maxLen = 200) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLen) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return trimmed;
  } catch {
    return null;
  }
}

export function validateDate(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function validateRoomId(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // allow short alphanum + - _ identifiers
  if (!/^[\w-]{1,64}$/.test(trimmed)) return null;
  return trimmed;
}

export function validateYouTubeId(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // YouTube video id is 11 chars of A-Za-z0-9-_ (approx)
  if (/^[A-Za-z0-9_-]{8,20}$/.test(trimmed)) return trimmed;
  return null;
}

export function validateEmail(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.length > 254) return null;
  // Basic email regex (not exhaustive)
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) return null;
  return trimmed;
}

// If limited HTML must be allowed, prefer DOMPurify (isomorphic-dompurify + jsdom)
// This function will try to use DOMPurify at runtime if available; otherwise
// it falls back to stripping tags and encoding entities.
export function sanitizeHtml(value: unknown, maxLen = 1000) {
  if (typeof value !== 'string') return null;
  let trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLen) trimmed = trimmed.slice(0, maxLen);

  try {
    // Use require at runtime to avoid adding a hard dependency during build
    // @ts-ignore
    const createDOMPurify = require('isomorphic-dompurify');
    // @ts-ignore
    const { JSDOM } = require('jsdom');
    const window = new JSDOM('').window;
    const DOMPurify = createDOMPurify(window as any);
    const clean = DOMPurify.sanitize(trimmed, {
      ALLOWED_TAGS: [
        'a', 'b', 'i', 'u', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li', 'span', 'div', 'img'
      ],
      ALLOWED_ATTR: ['href', 'title', 'alt', 'src', 'class', 'style'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick'],
    });
    if (!clean || typeof clean !== 'string') return null;
    return clean;
  } catch (e) {
    // fallback: strip tags and encode
    const noTags = trimmed.replace(/<[^>]*>/g, '');
    return encodeHtmlEntities(noTags.slice(0, maxLen));
  }
}
