/**
 * A simple bounded cache implementation that limits memory usage.
 *
 * When the cache exceeds maxSize, the oldest entries are evicted.
 * Uses insertion order for eviction (FIFO-like behavior).
 */
export class BoundedCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;

  constructor(maxSize: number) {
    if (!Number.isInteger(maxSize) || maxSize <= 0) {
      throw new Error("maxSize must be a positive integer");
    }
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  /**
   * Get a value from the cache.
   */
  get(key: K): V | undefined {
    return this.cache.get(key);
  }

  /**
   * Set a value in the cache.
   * If the cache is full, the oldest entry will be evicted.
   */
  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    while (this.cache.size >= this.maxSize) {
      const [oldestKey] = this.cache.keys();
      this.cache.delete(oldestKey);
    }

    this.cache.set(key, value);
  }

  /**
   * Delete a key from the cache.
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }
}
