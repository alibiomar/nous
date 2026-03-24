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
  if (typeof window === 'undefined') return;

  // ✅ prevent undefined from ever being cached
  if (value === undefined) return;
  if (key.includes('undefined')) return;
  try {
    const payload: CacheEnvelope<T> = {
      value,
      expiresAt: Date.now() + ttlMs,
    };

    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function removeDeviceCache(key: string) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function clearAllDeviceCache() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    // Find all keys that belong to our app cache (starting with 'nous:')
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith('nous:')) {
        keysToRemove.push(key);
      }
    }

    // Remove them securely
    keysToRemove.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // ignore
  }
}