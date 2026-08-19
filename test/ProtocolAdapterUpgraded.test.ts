/**
 * ProtocolAdapterUpgraded Tests
 *
 * The v2 protocol adapters are ERC-1967 proxies, so the implementation behind a fixed address can
 * change. Each Upgraded event gets its own row, keyed by createEventId()'s
 * {chainId}_{blockNumber}_{logIndex}_{srcAddress}, so the implementation in force at any block is
 * recoverable by taking the latest row at or before it.
 */

import { describe, it, expect } from "vitest";
import { createTestIndexer } from "envio";

describe("ProtocolAdapterUpgraded", () => {
  const CHAIN = 84532;
  const CONTRACT: `0x${string}` = "0xED41cB03feaFB2159182b385873BFa858C577e96";
  const TX_HASH = "0xabababababababababababababababababababababababababababababababababab";
  const IMPL_1: `0x${string}` = "0x1111111111111111111111111111111111111111";
  const IMPL_2: `0x${string}` = "0x2222222222222222222222222222222222222222";

  it("should record one row per Upgraded event, preserving order", async () => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            {
              contract: "ProtocolAdapter",
              event: "Upgraded",
              params: { implementation: IMPL_1 },
              srcAddress: CONTRACT,
              block: { number: 100, timestamp: 1700000000 },
              transaction: { hash: TX_HASH },
              logIndex: 3,
            },
            {
              contract: "ProtocolAdapter",
              event: "Upgraded",
              params: { implementation: IMPL_2 },
              srcAddress: CONTRACT,
              block: { number: 200, timestamp: 1700000600 },
              transaction: { hash: TX_HASH },
              logIndex: 7,
            },
          ],
        },
      },
    });

    const all = await indexer.ProtocolAdapterUpgraded.getAll();
    expect(all).toHaveLength(2);

    const sorted = [...all].sort((a, b) => Number(a.blockNumber - b.blockNumber));
    expect(sorted[0].implementation).toBe(IMPL_1);
    expect(sorted[0].blockNumber).toBe(100n);
    expect(sorted[0].chainId).toBe(BigInt(CHAIN));
    expect(sorted[1].implementation).toBe(IMPL_2);
    expect(sorted[1].blockNumber).toBe(200n);
  });

  it("should not collide across chains upgrading in the same tx and log position", async () => {
    const indexer = createTestIndexer();

    const upgraded = {
      contract: "ProtocolAdapter" as const,
      event: "Upgraded" as const,
      params: { implementation: IMPL_1 },
      srcAddress: CONTRACT,
      block: { number: 100, timestamp: 1700000000 },
      transaction: { hash: TX_HASH },
      logIndex: 3,
    };

    await indexer.process({
      chains: {
        [CHAIN]: { simulate: [upgraded] },
        1: { simulate: [upgraded] },
      },
    });

    const all = await indexer.ProtocolAdapterUpgraded.getAll();
    expect(all).toHaveLength(2);
    expect([...all].map((u) => u.chainId).sort()).toEqual([BigInt(CHAIN), 1n].sort());
  });
});
