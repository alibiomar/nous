type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type CacheStore = Map<string, CacheEntry<unknown>>;

declare global {
  // eslint-disable-next-line no-var
  var __NOUS_SERVER_CACHE__: CacheStore | undefined;
}

const cacheStore: CacheStore = globalThis.__NOUS_SERVER_CACHE__ ?? new Map();
if (!globalThis.__NOUS_SERVER_CACHE__) {
  globalThis.__NOUS_SERVER_CACHE__ = cacheStore;
}

function cleanupExpiredEntries() {
  const now = Date.now();

  for (const [key, entry] of cacheStore.entries()) {
    if (entry.expiresAt <= now) {
      cacheStore.delete(key);
    }
  }
}

export async function getOrSetCache<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const existing = cacheStore.get(key);

  if (existing && existing.expiresAt > now) {
    return existing.value as T;
  }

  const value = await loader();

  cacheStore.set(key, {
    value,
    expiresAt: now + ttlMs,
  });

  // Lightweight opportunistic cleanup keeps memory bounded.
  if (Math.random() < 0.02) {
    cleanupExpiredEntries();
  }

  return value;
}

export function invalidateCacheByPrefix(prefix: string) {
  for (const key of cacheStore.keys()) {
    if (key.startsWith(prefix)) {
      cacheStore.delete(key);
    }
  }
}

export function buildCacheKey(parts: Array<string | number | boolean | null | undefined>) {
  return parts
    .map((part) => (part === undefined || part === null ? '-' : String(part)))
    .join(':');
}
