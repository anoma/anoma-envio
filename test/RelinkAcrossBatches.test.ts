/**
 * Actions and tags are written before TransactionExecuted arrives and relinked when it does.
 * The relink reads them back from the store, so it must find rows written by an earlier batch,
 * not only the ones set in memory by the current one.
 */
import { describe, it, expect } from "vitest";
import { createTestIndexer } from "envio";
import { b32, consumed, created, action, encodeExecute } from "./fixtures/encode-tx.js";

describe("Relink across batches", () => {
  const CHAIN = 84532;
  const TX_HASH = "0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd";
  const CONTRACT: `0x${string}` = "0xb5A5a52Af29dA0c8801D9caf4D75a4d6C3895f0A";
  const BLOCK = 45_511_361;
  const N0 = b32("n0");
  const C0 = b32("c0");
  const VK = b32("vk");
  const ROOT = b32("root");
  const tx = {
    hash: TX_HASH,
    input: encodeExecute([action([consumed(N0, VK)], [created(C0, VK)], ROOT)]),
    value: 0n,
  };

  it("relinks an action and its tags processed in an earlier batch", async () => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            {
              contract: "ProtocolAdapter",
              event: "ActionExecuted",
              params: {
                actionTreeRoot: ROOT,
                nullifiers: [N0],
                consumedLogicRefs: [VK],
                commitments: [C0],
                createdLogicRefs: [VK],
              },
              srcAddress: CONTRACT,
              block: { number: BLOCK, timestamp: 0 },
              transaction: tx,
              logIndex: 1,
            },
          ],
        },
      },
    });

    const evmTxId = `${CHAIN}_${TX_HASH}`;
    expect((await indexer.Action.getAll()).map((a) => a.transaction_id)).toEqual([evmTxId]);

    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            {
              contract: "ProtocolAdapter",
              event: "TransactionExecuted",
              params: { transactionId: b32("tx") },
              srcAddress: CONTRACT,
              block: { number: BLOCK + 1, timestamp: 0 },
              transaction: tx,
              logIndex: 2,
            },
          ],
        },
      },
    });

    const txId = `${evmTxId}_2`;
    expect((await indexer.Action.getAll()).map((a) => a.transaction_id)).toEqual([txId]);
    expect([...(await indexer.Tag.getAll())].map((t) => t.transaction_id)).toEqual([txId, txId]);
  });
});
