/**
 * Action type definitions following Anoma specification.
 *
 * An Action provides context separation between non-intersecting sets of resources.
 * It contains logic verifier inputs for each resource consumed or created,
 * and compliance units comprising one consumed and one created resource, each.
 *
 * From PA-EVM Types.sol:
 * struct Action {
 *     Logic.VerifierInput[] logicVerifierInputs;
 *     Compliance.VerifierInput[] complianceVerifierInputs;
 * }
 */

import type { LogicVerifierInput } from "./Logic";
import type { ComplianceVerifierInput } from "./Compliance";

export interface Action {
  logicVerifierInputs: LogicVerifierInput[];
  complianceVerifierInputs: ComplianceVerifierInput[];
}
