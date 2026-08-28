/**
 * The cache that holds decoded execute() calldata between the handlers of one EVM transaction.
 * Its ceiling is load-bearing: a preload pass adds an entry per decodable transaction in the
 * batch and evicts none, so eviction has to be FIFO and has to actually bound the size.
 */
import { describe, it, expect } from "vitest";

import { BoundedCache } from "../src/utils/BoundedCache.js";

describe("BoundedCache", () => {
  it("stores and reads back a value", () => {
    const cache = new BoundedCache<string, number>(2);
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("missing")).toBeUndefined();
  });

  it("never exceeds maxSize, dropping the oldest entry first", () => {
    const cache = new BoundedCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("treats overwriting a key as a fresh insertion", () => {
    const cache = new BoundedCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 10); // now the newest, so "b" is the one to go
    cache.set("c", 3);

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(10);
    expect(cache.get("c")).toBe(3);
  });

  it("frees room when an entry is deleted", () => {
    const cache = new BoundedCache<string, number>(1);
    cache.set("a", 1);
    expect(cache.delete("a")).toBe(true);
    expect(cache.delete("a")).toBe(false);

    cache.set("b", 2);
    expect(cache.get("b")).toBe(2);
  });

  it("rejects a capacity that cannot hold anything", () => {
    expect(() => new BoundedCache<string, number>(0)).toThrow("maxSize must be a positive integer");
    expect(() => new BoundedCache<string, number>(-1)).toThrow();
    expect(() => new BoundedCache<string, number>(1.5)).toThrow();
  });
});
