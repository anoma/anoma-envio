/**
 * The public data carried per resource in an action.
 *
 * From PA-EVM interfaces/IProtocolAdapter.sol:
 * struct Consumed { bytes32 nullifier; bytes32 logicRef; bytes32 commitmentTreeRoot; AppData appData; }
 * struct Created  { bytes32 commitment; bytes32 logicRef; AppData appData; }
 *
 * A consumed resource additionally names the historical commitment tree root its inclusion was
 * proven against; a created one has no such root yet.
 */

import type { Hex } from "viem";

import type { AppData } from "./Logic.js";

export interface Consumed {
  nullifier: Hex;
  logicRef: Hex;
  commitmentTreeRoot: Hex;
  appData: AppData;
}

export interface Created {
  commitment: Hex;
  logicRef: Hex;
  appData: AppData;
}
