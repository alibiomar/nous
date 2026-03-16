'use client';

type CacheEnvelope<T> = {
  value: T;
  expiresAt: number;
};

function readEnvelope<T>(key: string): CacheEnvelope<T> | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (!parsed || typeof parsed.expiresAt !== 'number') {
      return null;
    }

    if (Date.now() > parsed.expiresAt) {
      window.localStorage.removeItem(key);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function readDeviceCache<T>(key: string): T | null {
  return readEnvelope<T>(key)?.value ?? null;
}

export function writeDeviceCache<T>(key: string, value: T, ttlMs: number) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const payload: CacheEnvelope<T> = {
      value,
      expiresAt: Date.now() + ttlMs,
    };
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Ignore storage quota and serialization issues.
  }
}

export function removeDeviceCache(key: string) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage access errors.
  }
}
