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
        Resource: Array<{ id: string }>;
        Action: Array<{ id: string }>;
        CommitmentTreeRoot: Array<{ id: string }>;
      }>(`
        query {
          Transaction(limit: 100) { id }
          Resource(limit: 100) { id }
          Action(limit: 100) { id }
          CommitmentTreeRoot(limit: 100) { id }
        }
      `);

      expect(data.Transaction).to.be.an("array");
      expect(data.Resource).to.be.an("array");
      expect(data.Action).to.be.an("array");
      expect(data.CommitmentTreeRoot).to.be.an("array");

      console.log("\n  Entity counts (sampled up to 100):");
      console.log(`    Transactions: ${data.Transaction.length}`);
      console.log(`    Resources: ${data.Resource.length}`);
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
          tags: string[];
          logicRefs: string[];
        }>;
      }>(`
        query {
          Transaction(limit: 5, order_by: {blockNumber: desc}) {
            id
            txHash
            blockNumber
            chainId
            tags
            logicRefs
          }
        }
      `);

      expect(data.Transaction).to.be.an("array");

      if (data.Transaction.length > 0) {
        const tx = data.Transaction[0];
        expect(tx).to.have.property("txHash");
        expect(tx).to.have.property("tags").that.is.an("array");
        expect(tx).to.have.property("logicRefs").that.is.an("array");
        console.log(`\n  Latest tx: ${tx.txHash} (block ${tx.blockNumber})`);
      }
    });
  });

  describe("Resources", () => {
    it("should fetch resources with transaction relationship", async () => {
      const data = await query<{
        Resource: Array<{
          id: string;
          tag: string;
          isConsumed: boolean;
          decodingStatus: string;
          transaction: { txHash: string };
        }>;
      }>(`
        query {
          Resource(limit: 5, order_by: {blockNumber: desc}) {
            id
            tag
            isConsumed
            decodingStatus
            transaction { txHash }
          }
        }
      `);

      expect(data.Resource).to.be.an("array");

      if (data.Resource.length > 0) {
        const resource = data.Resource[0];
        expect(resource).to.have.property("tag");
        expect(resource).to.have.property("isConsumed").that.is.a("boolean");
        expect(resource).to.have.property("decodingStatus");
        expect(resource).to.have.property("transaction");
        console.log(
          `\n  Latest resource: ${resource.tag.slice(0, 20)}... (consumed: ${resource.isConsumed})`
        );
      }
    });

    it("should filter consumed resources", async () => {
      const data = await query<{
        Resource: Array<{ tag: string; isConsumed: boolean }>;
      }>(`
        query {
          Resource(where: {isConsumed: {_eq: true}}, limit: 3) {
            tag
            isConsumed
          }
        }
      `);

      expect(data.Resource).to.be.an("array");
      data.Resource.forEach((r) => expect(r.isConsumed).to.be.true);
    });

    it("should filter created resources", async () => {
      const data = await query<{
        Resource: Array<{ tag: string; isConsumed: boolean }>;
      }>(`
        query {
          Resource(where: {isConsumed: {_eq: false}}, limit: 3) {
            tag
            isConsumed
          }
        }
      `);

      expect(data.Resource).to.be.an("array");
      data.Resource.forEach((r) => expect(r.isConsumed).to.be.false);
    });
  });

  describe("Actions", () => {
    it("should fetch actions with transaction", async () => {
      const data = await query<{
        Action: Array<{
          id: string;
          actionTreeRoot: string;
          tagCount: number;
          transaction: { txHash: string };
        }>;
      }>(`
        query {
          Action(limit: 5, order_by: {blockNumber: desc}) {
            id
            actionTreeRoot
            tagCount
            transaction { txHash }
          }
        }
      `);

      expect(data.Action).to.be.an("array");

      if (data.Action.length > 0) {
        const action = data.Action[0];
        expect(action).to.have.property("actionTreeRoot");
        expect(action).to.have.property("tagCount").that.is.a("number");
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

  describe("Transaction-Resource Relationship", () => {
    it("should fetch transaction with all its resources", async () => {
      const data = await query<{
        Transaction: Array<{
          txHash: string;
          tags: string[];
          resources: Array<{
            tag: string;
            isConsumed: boolean;
          }>;
        }>;
      }>(`
        query {
          Transaction(limit: 1) {
            txHash
            tags
            resources {
              tag
              isConsumed
            }
          }
        }
      `);

      expect(data.Transaction).to.be.an("array");

      if (data.Transaction.length > 0) {
        const tx = data.Transaction[0];
        expect(tx.resources).to.be.an("array");

        console.log(`\n  Transaction ${tx.txHash.slice(0, 20)}...`);
        console.log(`    Tags: ${tx.tags.length}`);
        console.log(`    Resources: ${tx.resources.length}`);

        // Verify consumed/created pattern
        const consumed = tx.resources.filter((r) => r.isConsumed).length;
        const created = tx.resources.filter((r) => !r.isConsumed).length;
        console.log(`    Consumed: ${consumed}, Created: ${created}`);
      }
    });
  });
});
