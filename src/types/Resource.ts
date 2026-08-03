/**
 * The public data carried per resource in an action.
 *
 * From PA-EVM Types.sol:
 * struct Consumed { bytes32 nullifier; bytes32 logicRef; bytes32 commitmentTreeRoot; Logic.AppData appData; }
 * struct Created  { bytes32 commitment; bytes32 logicRef; Logic.AppData appData; }
 *
 * A consumed resource additionally names the historical commitment tree root its inclusion was
 * proven against; a created one has no such root yet.
 */

import type { AppData } from "./Logic";

export interface Consumed {
  nullifier: `0x${string}`;
  logicRef: `0x${string}`;
  commitmentTreeRoot: `0x${string}`;
  appData: AppData;
}

export interface Created {
  commitment: `0x${string}`;
  logicRef: `0x${string}`;
  appData: AppData;
}
