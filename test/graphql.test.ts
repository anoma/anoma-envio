/**
 * GraphQL Endpoint Tests
 *
 * Verifies the Envio Hyperindex endpoint is working correctly
 * by running queries against indexed PA-EVM data.
 *
 * Usage:
 *   ENVIO_GRAPHQL_URL=https://your-endpoint/v1/graphql pnpm test
 */

import { describe, it, expect } from "vitest";

const GRAPHQL_URL: string | undefined = process.env.ENVIO_GRAPHQL_URL;

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function query<T>(queryString: string): Promise<T> {
  const response = await fetch(GRAPHQL_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: queryString }),
  });

  const result = (await response.json()) as GraphQLResponse<T>;

  if (result.errors) {
    throw new Error(result.errors.map((e) => e.message).join(", "));
  }

  return result.data as T;
}

describe.skipIf(!GRAPHQL_URL)("GraphQL Endpoint", () => {
  describe("Connection", () => {
    it("should connect to the endpoint", async () => {
      const data = await query<{ __typename: string }>(`{ __typename }`);
      expect(data).toHaveProperty("__typename");
    });
  });

  describe("Entity Counts", () => {
    it("should return entity samples (health check)", async () => {
      const data = await query<{
        Transaction: Array<{ id: string }>;
        Tag: Array<{ id: string }>;
        Action: Array<{ id: string }>;
        CommitmentTreeRoot: Array<{ id: string }>;
      }>(`
        query {
          Transaction(limit: 100) { id }
          Tag(limit: 100) { id }
          Action(limit: 100) { id }
          CommitmentTreeRoot(limit: 100) { id }
        }
      `);

      expect(Array.isArray(data.Transaction)).toBe(true);
      expect(Array.isArray(data.Tag)).toBe(true);
      expect(Array.isArray(data.Action)).toBe(true);
      expect(Array.isArray(data.CommitmentTreeRoot)).toBe(true);

      console.log("\n  Entity counts (sampled up to 100):");
      console.log(`    Transactions: ${data.Transaction.length}`);
      console.log(`    Tags: ${data.Tag.length}`);
      console.log(`    Actions: ${data.Action.length}`);
      console.log(`    CommitmentTreeRoots: ${data.CommitmentTreeRoot.length}`);
    });
  });

  describe("Transactions", () => {
    it("should fetch recent transactions", async () => {
      const data = await query<{
        Transaction: Array<{
          id: string;
          tagHashes: string[];
          logicRefs: string[];
          evmTransaction: { txHash: string; blockNumber: number; chainId: number };
        }>;
      }>(`
        query {
          Transaction(limit: 5, order_by: {evmTransaction: {blockNumber: desc}}) {
            id
            tagHashes
            logicRefs
            evmTransaction { txHash blockNumber chainId }
          }
        }
      `);

      expect(Array.isArray(data.Transaction)).toBe(true);

      if (data.Transaction.length > 0) {
        const tx = data.Transaction[0];
        expect(tx).toHaveProperty("evmTransaction");
        expect(tx.evmTransaction).toHaveProperty("txHash");
        expect(Array.isArray(tx.tagHashes)).toBe(true);
        expect(Array.isArray(tx.logicRefs)).toBe(true);
        console.log(
          `\n  Latest tx: ${tx.evmTransaction.txHash} (block ${tx.evmTransaction.blockNumber})`
        );
      }
    });
  });

  describe("Tags", () => {
    it("should fetch tags with transaction relationship", async () => {
      const data = await query<{
        Tag: Array<{
          id: string;
          tagHash: string;
          isConsumed: boolean;
          transaction: { evmTransaction: { txHash: string } };
        }>;
      }>(`
        query {
          Tag(limit: 5, order_by: {blockNumber: desc}) {
            id
            tagHash
            isConsumed
            transaction { evmTransaction { txHash } }
          }
        }
      `);

      expect(Array.isArray(data.Tag)).toBe(true);

      if (data.Tag.length > 0) {
        const tag = data.Tag[0];
        expect(tag).toHaveProperty("tagHash");
        expect(typeof tag.isConsumed).toBe("boolean");
        expect(tag).toHaveProperty("transaction");
        console.log(`\n  Latest tag: ${tag.tagHash.slice(0, 20)}... (consumed: ${tag.isConsumed})`);
      }
    });

    it("should filter consumed tags", async () => {
      const data = await query<{
        Tag: Array<{ tagHash: string; isConsumed: boolean }>;
      }>(`
        query {
          Tag(where: {isConsumed: {_eq: true}}, limit: 3) {
            tagHash
            isConsumed
          }
        }
      `);

      expect(Array.isArray(data.Tag)).toBe(true);
      data.Tag.forEach((t) => expect(t.isConsumed).toBe(true));
    });

    it("should filter created tags", async () => {
      const data = await query<{
        Tag: Array<{ tagHash: string; isConsumed: boolean }>;
      }>(`
        query {
          Tag(where: {isConsumed: {_eq: false}}, limit: 3) {
            tagHash
            isConsumed
          }
        }
      `);

      expect(Array.isArray(data.Tag)).toBe(true);
      data.Tag.forEach((t) => expect(t.isConsumed).toBe(false));
    });
  });

  describe("Actions", () => {
    it("should fetch actions with transaction", async () => {
      const data = await query<{
        Action: Array<{
          id: string;
          actionTreeRoot: string;
          actionTagCount: number;
          transaction: { evmTransaction: { txHash: string } };
        }>;
      }>(`
        query {
          Action(limit: 5, order_by: {blockNumber: desc}) {
            id
            actionTreeRoot
            actionTagCount
            transaction { evmTransaction { txHash } }
          }
        }
      `);

      expect(Array.isArray(data.Action)).toBe(true);

      if (data.Action.length > 0) {
        const action = data.Action[0];
        expect(action).toHaveProperty("actionTreeRoot");
        expect(typeof action.actionTagCount).toBe("number");
      }
    });
  });

  describe("CommitmentTreeRoots", () => {
    it("should fetch commitment tree roots", async () => {
      const data = await query<{
        CommitmentTreeRoot: Array<{
          root: string;
          blockNumber: number;
          txHash: string;
        }>;
      }>(`
        query {
          CommitmentTreeRoot(limit: 5, order_by: {blockNumber: desc}) {
            root
            blockNumber
            txHash
          }
        }
      `);

      expect(Array.isArray(data.CommitmentTreeRoot)).toBe(true);

      if (data.CommitmentTreeRoot.length > 0) {
        const root = data.CommitmentTreeRoot[0];
        expect(typeof root.root).toBe("string");
      }
    });
  });

  describe("Transaction-Tag Relationship", () => {
    it("should fetch transaction with all its tags", async () => {
      const data = await query<{
        Transaction: Array<{
          evmTransaction: { txHash: string };
          tagHashes: string[];
          tags: Array<{
            tagHash: string;
            isConsumed: boolean;
          }>;
        }>;
      }>(`
        query {
          Transaction(limit: 1) {
            evmTransaction { txHash }
            tagHashes
            tags {
              tagHash
              isConsumed
            }
          }
        }
      `);

      expect(Array.isArray(data.Transaction)).toBe(true);

      if (data.Transaction.length > 0) {
        const tx = data.Transaction[0];
        expect(Array.isArray(tx.tags)).toBe(true);

        console.log(`\n  Transaction ${tx.evmTransaction.txHash.slice(0, 20)}...`);
        console.log(`    TagHashes: ${tx.tagHashes.length}`);
        console.log(`    Tags: ${tx.tags.length}`);

        // Verify consumed/created pattern
        const consumed = tx.tags.filter((t) => t.isConsumed).length;
        const created = tx.tags.filter((t) => !t.isConsumed).length;
        console.log(`    Consumed: ${consumed}, Created: ${created}`);
      }
    });
  });

  describe("Commitment Tree Root Parity", () => {
    it("should have the latest CommitmentTreeRoot matching the latest Transaction per chain", async () => {
      // Get latest Transaction per chain (sorted by block desc, then logIndex desc)
      const txData = await query<{
        Transaction: Array<{
          id: string;
          logIndex: number;
          contractAddress: string;
          evmTransaction: { txHash: string; blockNumber: number; chainId: number };
        }>;
      }>(`
        query {
          Transaction(limit: 10, order_by: [
            { evmTransaction: { blockNumber: desc } },
            { logIndex: desc }
          ]) {
            id
            logIndex
            contractAddress
            evmTransaction { txHash blockNumber chainId }
          }
        }
      `);

      // Get latest CommitmentTreeRoot per chain (sorted by block desc, then logIndex desc)
      const rootData = await query<{
        CommitmentTreeRoot: Array<{
          id: string;
          root: string;
          blockNumber: number;
          logIndex: number;
          txHash: string;
          chainId: number;
        }>;
      }>(`
        query {
          CommitmentTreeRoot(limit: 10, order_by: [
            { blockNumber: desc },
            { logIndex: desc }
          ]) {
            id
            root
            blockNumber
            logIndex
            txHash
            chainId
          }
        }
      `);

      expect(Array.isArray(txData.Transaction)).toBe(true);
      expect(Array.isArray(rootData.CommitmentTreeRoot)).toBe(true);

      if (txData.Transaction.length === 0) {
        console.log("\n  No transactions indexed yet — skipping parity check");
        return;
      }

      if (rootData.CommitmentTreeRoot.length === 0) {
        console.log("\n  No commitment tree roots indexed yet — skipping parity check");
        return;
      }

      // Group by chainId: pick the latest Transaction and latest CommitmentTreeRoot per chain
      const latestTxByChain = new Map<number, (typeof txData.Transaction)[0]>();
      for (const tx of txData.Transaction) {
        const chainId = tx.evmTransaction.chainId;
        if (!latestTxByChain.has(chainId)) {
          latestTxByChain.set(chainId, tx);
        }
      }

      const latestRootByChain = new Map<number, (typeof rootData.CommitmentTreeRoot)[0]>();
      for (const root of rootData.CommitmentTreeRoot) {
        if (!latestRootByChain.has(root.chainId)) {
          latestRootByChain.set(root.chainId, root);
        }
      }

      console.log("\n  Commitment Tree Root vs Latest Transaction:");

      for (const [chainId, tx] of latestTxByChain) {
        const root = latestRootByChain.get(chainId);

        if (!root) {
          console.log(`    Chain ${chainId}: no CommitmentTreeRoot indexed — SKIPPED`);
          continue;
        }

        const txBlock = tx.evmTransaction.blockNumber;
        const txHash = tx.evmTransaction.txHash;

        console.log(`    Chain ${chainId}:`);
        console.log(
          `      Latest TX    : block=${txBlock} logIndex=${tx.logIndex} txHash=${txHash.slice(0, 18)}…`
        );
        console.log(
          `      Latest Root  : block=${root.blockNumber} logIndex=${root.logIndex} txHash=${root.txHash.slice(0, 18)}…`
        );
        console.log(`      Root value   : ${root.root.slice(0, 18)}…`);

        // The CommitmentTreeRootAdded event fires right before TransactionExecuted,
        // so they must share the same txHash and block number.
        expect(root.txHash.toLowerCase()).toBe(txHash.toLowerCase());
        expect(root.blockNumber).toBe(txBlock);

        // CommitmentTreeRootAdded fires before TransactionExecuted in the same tx,
        // so the root's logIndex must be less than the transaction's logIndex.
        expect(root.logIndex).toBeLessThan(tx.logIndex);

        console.log(`      MATCH ✓`);
      }
    });
  });

  describe("External Call Payloads", () => {
    it("should fetch externalCall payloads from decoded calldata", async () => {
      let data: {
        Payload: Array<{
          id: string;
          category: string;
          tagHash: string;
          blob: string;
          deletionCriterion: string | null;
        }>;
      };
      try {
        data = await query<typeof data>(`
          query {
            Payload(limit: 10, where: {category: {_eq: "externalCall"}}) {
              id
              category
              tagHash
              blob
              deletionCriterion
            }
          }
        `);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("does not exist")) {
          console.log("\n  Payload type not yet registered in Hasura (no payloads indexed yet)");
          return;
        }
        throw e;
      }

      expect(Array.isArray(data.Payload)).toBe(true);

      if (data.Payload.length > 0) {
        const p = data.Payload[0];
        expect(p.category).toBe("externalCall");
        expect(typeof p.tagHash).toBe("string");
        expect(typeof p.blob).toBe("string");

        console.log(`\n  External Call Payloads found: ${data.Payload.length}`);
        console.log(`    First: ${p.id}`);
        console.log(`    Tag: ${p.tagHash.slice(0, 20)}...`);
        console.log(`    DeletionCriterion: ${p.deletionCriterion ?? "null"}`);
      } else {
        console.log(
          "\n  No externalCall payloads indexed yet (expected if no external calls on-chain)"
        );
      }
    });
  });
});
