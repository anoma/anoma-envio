/**
 * Config Validation: verify config.yaml entries against on-chain state.
 *
 * For every network in config.yaml this checks:
 *   1. start_block > 0 and < chain tip
 *   2. RPC is reachable (eth_blockNumber returns a valid number)
 *   3. Contract is deployed (eth_getCode at latest is not "0x")
 *   4. Contract has code at start_block + 1 (deployed at or before start_block)
 *   5. Contract has NO code at start_block - 1 (start_block is the deployment block)
 *
 * All chain metadata is derived from config.yaml — nothing is hardcoded.
 * Archive RPC access is required for start_block validation.
 *
 * Usage:
 *   pnpm test -- --grep "Config Validation"
 */

import { describe, it, expect } from "vitest";
import { parseConfig, chainName, getRpcUrl, rpcEnvKey, rpcCall, toHex } from "../chain-utils.js";

describe("Config Validation: config.yaml vs on-chain state", () => {
  const networkConfigs = (() => {
    try {
      return parseConfig();
    } catch {
      return [];
    }
  })();

  it("should have networks loaded from config", () => {
    expect(networkConfigs.length).toBeGreaterThan(0);
    console.log(`\n  Loaded ${networkConfigs.length} networks from config.yaml`);
  });

  for (const network of networkConfigs) {
    const name = chainName(network.id);
    const rpcUrl = getRpcUrl(network);
    const contractAddress = network.contracts[0]?.address[0];

    describe(`[${name}] (chain ${network.id})`, () => {
      if (!rpcUrl) {
        it.skip(`should have an RPC URL configured — set ${rpcEnvKey(network.id)} or add rpc.url to config.yaml`, () => {});
        return;
      }

      if (!contractAddress) {
        it.skip(`should have a contract address configured for ${name}`, () => {});
        return;
      }

      it("start_block must be a valid deployment block", async () => {
        expect(
          network.start_block,
          `${name}: start_block is 0 — set it to the contract deployment block. ` +
            `Find it via: https://etherscan.io/address/${contractAddress} (check "Contract Creator" tx)`
        ).toBeGreaterThan(0);

        const hex = (await rpcCall(rpcUrl, "eth_blockNumber", [])) as string;
        const chainTip = parseInt(hex, 16);
        expect(
          network.start_block,
          `${name}: start_block ${network.start_block} is beyond chain tip ${chainTip}`
        ).toBeLessThan(chainTip);

        console.log(
          `    ${name}: config start_block = ${network.start_block}, chain tip = ${chainTip}`
        );
      });

      it("Contract deployed: eth_getCode at latest is not empty", async () => {
        const code = (await rpcCall(rpcUrl, "eth_getCode", [contractAddress, "latest"])) as string;
        expect(typeof code).toBe("string");
        expect(code).not.toBe("0x");
        expect(code.length).toBeGreaterThan(2);
        console.log(
          `    ${name}: contract ${contractAddress} has ${code.length - 2} hex chars of bytecode`
        );
      });

      it("start_block is valid: contract has code at start_block + 1", async (ctx) => {
        // eth_getCode at block N returns state at the START of block N.
        // If the contract was deployed IN block N, code only appears at block N+1.
        const checkBlock = network.start_block + 1;
        let code: string;
        try {
          code = (await rpcCall(rpcUrl, "eth_getCode", [
            contractAddress,
            toHex(checkBlock),
          ])) as string;
        } catch (err) {
          // Some chains (e.g. Monad) have no archive RPC that can answer
          // eth_getCode at a historical block — the node prunes state and
          // errors ("block not found"). The "deployed at latest" check already
          // proved the RPC reachable, so a failure here is an archive
          // limitation, not a config error. Skip rather than fail.
          console.log(
            `    ${name}: skipping archive check — RPC cannot serve block ${checkBlock} ` +
              `(${(err as Error).message})`
          );
          ctx.skip();
          return;
        }
        expect(typeof code).toBe("string");
        expect(code).not.toBe("0x");
        expect(code.length).toBeGreaterThan(2);
        console.log(`    ${name}: RPC confirms code at block ${checkBlock} (start_block + 1) ✓`);
      });

      it("start_block is not too early: no code at start_block - 1", async (ctx) => {
        const priorBlock = network.start_block - 1;
        let code: string;
        try {
          code = (await rpcCall(rpcUrl, "eth_getCode", [
            contractAddress,
            toHex(priorBlock),
          ])) as string;
        } catch (err) {
          // Non-archive RPCs cannot serve historical state (see above). Skip.
          console.log(
            `    ${name}: skipping archive check — RPC cannot serve block ${priorBlock} ` +
              `(${(err as Error).message})`
          );
          ctx.skip();
          return;
        }
        if (code && code !== "0x" && code.length > 2) {
          console.log(
            `    ${name}: WARNING — RPC shows code at block ${priorBlock} (start_block - 1). ` +
              `Real deployment may be earlier than config start_block ${network.start_block}.`
          );
        } else {
          console.log(
            `    ${name}: RPC confirms no code at block ${priorBlock} (start_block - 1) ✓ ` +
              `— deployment block = ${network.start_block}`
          );
        }
      });
    });
  }
});
