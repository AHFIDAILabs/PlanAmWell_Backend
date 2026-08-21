// util/memoryCache.ts
//
// Lightweight in-process TTL cache — no Redis, no external dependency.
// This works well specifically because the backend runs as a single Node
// process (confirmed single-instance on Render): one process means one
// cache, so there's no cross-instance staleness/consistency problem a
// distributed cache would otherwise need to solve. If this app ever scales
// to multiple instances, this cache stops being shared across them and a
// real distributed cache (Redis) becomes necessary — this is not a
// replacement for that, just the free, correct option for today's
// single-instance deployment.
//
// Usage:
//   const categories = await memoryCache.getOrSet("categories:all", 30 * 60_000, async () => {
//     const res = await axios.get(...);
//     return res.data;
//   });
//
//   // On a write that invalidates cached reads:
//   memoryCache.invalidate("categories:all");

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class MemoryCache {
  private store = new Map<string, CacheEntry<any>>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlMs: number): void {
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  /**
   * Returns the cached value if present and fresh; otherwise calls `fetcher`,
   * caches its result for `ttlMs`, and returns it. If `fetcher` throws,
   * nothing is cached — the next call will retry rather than being stuck
   * serving (or repeating) a failure for the TTL window.
   */
  async getOrSet<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;

    const data = await fetcher();
    this.set(key, data, ttlMs);
    return data;
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  /** Invalidate every cached entry whose key starts with `prefix`. */
  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  clear(): void {
    this.store.clear();
  }
}

export const memoryCache = new MemoryCache();
