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
    if (maxSize <= 0) {
      throw new Error("maxSize must be positive");
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
   * Check if a key exists in the cache.
   */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * Set a value in the cache.
   * If the cache is full, the oldest entry will be evicted.
   */
  set(key: K, value: V): void {
    // If key already exists, update it (moves to end in insertion order)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict oldest entries if at capacity
    while (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value as K | undefined;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, value);
  }

  /**
   * Delete a key from the cache.
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries from the cache.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get the current size of the cache.
   */
  get size(): number {
    return this.cache.size;
  }
}
