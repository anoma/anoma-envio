/**
 * GraphQL Endpoint Tests
 *
 * Verifies the Envio Hyperindex endpoint is working correctly
 * by running queries against indexed PA-EVM data.
 *
 * Usage:
 *   ENVIO_GRAPHQL_URL=https://your-endpoint/v1/graphql pnpm test
 */

import { expect } from "chai";

const GRAPHQL_URL: string = (() => {
  const url = process.env.ENVIO_GRAPHQL_URL;
  if (!url) {
    throw new Error(
      "ENVIO_GRAPHQL_URL environment variable is required. " +
        "Set it to your Envio Hyperindex GraphQL endpoint."
    );
  }
  return url;
})();

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function query<T>(queryString: string): Promise<T> {
  const response = await fetch(GRAPHQL_URL, {
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

describe("GraphQL Endpoint", () => {
  describe("Connection", () => {
    it("should connect to the endpoint", async () => {
      const data = await query<{ __typename: string }>(`{ __typename }`);
      expect(data).to.have.property("__typename");
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

      expect(data.Transaction).to.be.an("array");
      expect(data.Tag).to.be.an("array");
      expect(data.Action).to.be.an("array");
      expect(data.CommitmentTreeRoot).to.be.an("array");

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
          txHash: string;
          blockNumber: number;
          chainId: number;
          tagHashes: string[];
          logicRefs: string[];
        }>;
      }>(`
        query {
          Transaction(limit: 5, order_by: {blockNumber: desc}) {
            id
            txHash
            blockNumber
            chainId
            tagHashes
            logicRefs
          }
        }
      `);

      expect(data.Transaction).to.be.an("array");

      if (data.Transaction.length > 0) {
        const tx = data.Transaction[0];
        expect(tx).to.have.property("txHash");
        expect(tx).to.have.property("tagHashes").that.is.an("array");
        expect(tx).to.have.property("logicRefs").that.is.an("array");
        console.log(`\n  Latest tx: ${tx.txHash} (block ${tx.blockNumber})`);
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
          transaction: { txHash: string };
        }>;
      }>(`
        query {
          Tag(limit: 5, order_by: {blockNumber: desc}) {
            id
            tagHash
            isConsumed
            transaction { txHash }
          }
        }
      `);

      expect(data.Tag).to.be.an("array");

      if (data.Tag.length > 0) {
        const tag = data.Tag[0];
        expect(tag).to.have.property("tagHash");
        expect(tag).to.have.property("isConsumed").that.is.a("boolean");
        expect(tag).to.have.property("transaction");
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

      expect(data.Tag).to.be.an("array");
      data.Tag.forEach((t) => expect(t.isConsumed).to.be.true);
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

      expect(data.Tag).to.be.an("array");
      data.Tag.forEach((t) => expect(t.isConsumed).to.be.false);
    });
  });

  describe("Actions", () => {
    it("should fetch actions with transaction", async () => {
      const data = await query<{
        Action: Array<{
          id: string;
          actionTreeRoot: string;
          actionTagCount: number;
          transaction: { txHash: string };
        }>;
      }>(`
        query {
          Action(limit: 5, order_by: {blockNumber: desc}) {
            id
            actionTreeRoot
            actionTagCount
            transaction { txHash }
          }
        }
      `);

      expect(data.Action).to.be.an("array");

      if (data.Action.length > 0) {
        const action = data.Action[0];
        expect(action).to.have.property("actionTreeRoot");
        expect(action).to.have.property("actionTagCount").that.is.a("number");
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

      expect(data.CommitmentTreeRoot).to.be.an("array");

      if (data.CommitmentTreeRoot.length > 0) {
        const root = data.CommitmentTreeRoot[0];
        expect(root).to.have.property("root").that.is.a("string");
      }
    });
  });

  describe("Transaction-Tag Relationship", () => {
    it("should fetch transaction with all its tags", async () => {
      const data = await query<{
        Transaction: Array<{
          txHash: string;
          tagHashes: string[];
          tags: Array<{
            tagHash: string;
            isConsumed: boolean;
          }>;
        }>;
      }>(`
        query {
          Transaction(limit: 1) {
            txHash
            tagHashes
            tags {
              tagHash
              isConsumed
            }
          }
        }
      `);

      expect(data.Transaction).to.be.an("array");

      if (data.Transaction.length > 0) {
        const tx = data.Transaction[0];
        expect(tx.tags).to.be.an("array");

        console.log(`\n  Transaction ${tx.txHash.slice(0, 20)}...`);
        console.log(`    TagHashes: ${tx.tagHashes.length}`);
        console.log(`    Tags: ${tx.tags.length}`);

        // Verify consumed/created pattern
        const consumed = tx.tags.filter((t) => t.isConsumed).length;
        const created = tx.tags.filter((t) => !t.isConsumed).length;
        console.log(`    Consumed: ${consumed}, Created: ${created}`);
      }
    });
  });

  describe("External Call Payloads", () => {
    it("should fetch externalCall payloads from decoded calldata", async () => {
      const data = await query<{
        Payload: Array<{
          id: string;
          category: string;
          tagHash: string;
          blob: string;
          deletionCriterion: string | null;
        }>;
      }>(`
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

      expect(data.Payload).to.be.an("array");

      if (data.Payload.length > 0) {
        const p = data.Payload[0];
        expect(p.category).to.equal("externalCall");
        expect(p).to.have.property("tagHash").that.is.a("string");
        expect(p).to.have.property("blob").that.is.a("string");

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
