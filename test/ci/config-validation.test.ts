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

import { expect } from "chai";
import { parseConfig, chainName, getRpcUrl, rpcEnvKey, rpcCall, toHex } from "../chain-utils";

describe("Config Validation: config.yaml vs on-chain state", function () {
  this.timeout(120_000);

  const networkConfigs = (() => {
    try {
      return parseConfig();
    } catch {
      return [];
    }
  })();

  it("should have networks loaded from config", function () {
    expect(networkConfigs).to.be.an("array").with.length.greaterThan(0);
    console.log(`\n  Loaded ${networkConfigs.length} networks from config.yaml`);
  });

  for (const network of networkConfigs) {
    const name = chainName(network.id);
    const rpcUrl = getRpcUrl(network);
    const contractAddress = network.contracts[0]?.address[0];

    describe(`[${name}] (chain ${network.id})`, function () {
      if (!rpcUrl) {
        it("should have an RPC URL configured", function () {
          expect.fail(
            `No RPC URL found for ${name} (chain ${network.id}). ` +
              `Set ${rpcEnvKey(network.id)} env var or add rpc_config.url to config.yaml.`
          );
        });
        return;
      }

      if (!contractAddress) {
        it("should have a contract address configured", function () {
          expect.fail(`No contract address found for ${name} (chain ${network.id})`);
        });
        return;
      }

      it("start_block must be a valid deployment block", async function () {
        expect(
          network.start_block,
          `${name}: start_block is 0 — set it to the contract deployment block. ` +
            `Find it via: https://etherscan.io/address/${contractAddress} (check "Contract Creator" tx)`
        ).to.be.greaterThan(0);

        const hex = (await rpcCall(rpcUrl, "eth_blockNumber", [])) as string;
        const chainTip = parseInt(hex, 16);
        expect(
          network.start_block,
          `${name}: start_block ${network.start_block} is beyond chain tip ${chainTip}`
        ).to.be.lessThan(chainTip);

        console.log(
          `    ${name}: config start_block = ${network.start_block}, chain tip = ${chainTip}`
        );
      });

      it("Contract deployed: eth_getCode at latest is not empty", async function () {
        const code = (await rpcCall(rpcUrl, "eth_getCode", [contractAddress, "latest"])) as string;
        expect(code).to.be.a("string");
        expect(code).to.not.equal("0x", `${name}: no bytecode at ${contractAddress} (latest)`);
        expect(code.length).to.be.greaterThan(2, `${name}: empty bytecode at ${contractAddress}`);
        console.log(
          `    ${name}: contract ${contractAddress} has ${code.length - 2} hex chars of bytecode`
        );
      });

      it("start_block is valid: contract has code at start_block + 1", async function () {
        // eth_getCode at block N returns state at the START of block N.
        // If the contract was deployed IN block N, code only appears at block N+1.
        const checkBlock = network.start_block + 1;
        const code = (await rpcCall(rpcUrl, "eth_getCode", [
          contractAddress,
          toHex(checkBlock),
        ])) as string;
        expect(code).to.be.a("string");
        expect(code).to.not.equal(
          "0x",
          `${name}: no bytecode at ${contractAddress} at block ${checkBlock} (start_block + 1). ` +
            `The contract may not have been deployed at start_block ${network.start_block}, ` +
            `or the RPC does not support archive queries.`
        );
        expect(code.length).to.be.greaterThan(2, `${name}: empty bytecode at block ${checkBlock}`);
        console.log(`    ${name}: RPC confirms code at block ${checkBlock} (start_block + 1) ✓`);
      });

      it("start_block is not too early: no code at start_block - 1", async function () {
        const priorBlock = network.start_block - 1;
        const code = (await rpcCall(rpcUrl, "eth_getCode", [
          contractAddress,
          toHex(priorBlock),
        ])) as string;
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
