/**
 * Unit tests for the getUTCDay helper.
 *
 * Verifies correct UTC day bucketing for known timestamps,
 * mid-day values, and boundary conditions.
 *
 * Refs #7
 */

import { describe, it, expect } from "vitest";
import { getUTCDay, SECONDS_PER_DAY } from "../src/constants.js";

describe("getUTCDay", () => {
  it("should return 1970-01-01 for timestamp 0 (Unix epoch)", () => {
    const result = getUTCDay(0);
    expect(result.dateKey).toBe("1970-01-01");
    expect(result.dayTimestamp).toBe(0n);
  });

  it("should floor mid-day timestamps to start of day", () => {
    // 2024-01-15 12:30:00 UTC = 1705318200
    const ts = 1705318200;
    const result = getUTCDay(ts);
    expect(result.dateKey).toBe("2024-01-15");
    // Start of 2024-01-15 = 1705276800
    expect(result.dayTimestamp).toBe(1705276800n);
  });

  it("should return the same day for midnight UTC", () => {
    // 2024-01-15 00:00:00 UTC = 1705276800
    const ts = 1705276800;
    const result = getUTCDay(ts);
    expect(result.dateKey).toBe("2024-01-15");
    expect(result.dayTimestamp).toBe(BigInt(ts));
  });

  it("should return the same day for 23:59:59 UTC", () => {
    // 2024-01-15 23:59:59 UTC = 1705276800 + 86399
    const ts = 1705276800 + SECONDS_PER_DAY - 1;
    const result = getUTCDay(ts);
    expect(result.dateKey).toBe("2024-01-15");
    expect(result.dayTimestamp).toBe(1705276800n);
  });

  it("should advance to next day at midnight boundary", () => {
    // 2024-01-16 00:00:00 UTC = 1705276800 + 86400
    const ts = 1705276800 + SECONDS_PER_DAY;
    const result = getUTCDay(ts);
    expect(result.dateKey).toBe("2024-01-16");
    expect(result.dayTimestamp).toBe(BigInt(ts));
  });

  it("should zero-pad single-digit months and days", () => {
    // 2024-03-05 10:00:00 UTC = 1709632800
    const ts = 1709632800;
    const result = getUTCDay(ts);
    expect(result.dateKey).toBe("2024-03-05");
  });

  it("should produce lexicographically sortable date keys", () => {
    const day1 = getUTCDay(1705276800); // 2024-01-15
    const day2 = getUTCDay(1705276800 + SECONDS_PER_DAY); // 2024-01-16
    expect(day1.dateKey < day2.dateKey).toBe(true);
  });

  it("should produce dayTimestamp that is always a multiple of SECONDS_PER_DAY", () => {
    const timestamps = [0, 12345, 1705318200, 1709632800, 999999999];
    for (const ts of timestamps) {
      const result = getUTCDay(ts);
      expect(result.dayTimestamp % BigInt(SECONDS_PER_DAY)).toBe(0n);
    }
  });
});
