# envio V3 (3.2.1) migration — runtime infra playbook

Preserve doc for whoever resumes the V3 work (post-recording / when nf-demo hosting is back on).
This branch (`heindel/envio-v3`) is the **minimal, schema-preserving** port: it keeps the `Int` schema
so the explorer works unchanged, and it answers the two questions the migration existed for:

- **Q1 — does V3 work?** YES. Indexed all 3 testnet chains to head (Tag 8634: 97=98 · 421614=156 ·
  11155111=8380, tracking live+advancing head). `src/EventHandlers.ts` typechecks clean against the
  real V3 types.
- **Q2 — does it fit 512 MB?** Steady-state following **~224–251 MiB (fits, ~2× headroom, leaner than
  V2's ~648 MiB)**; one-time full backfill **~873 MiB (does NOT fit** — OOMKills under a hard 512m cap;
  the peak is buffering, not data — the whole backfill is ~24 s of events). NF stage-A path:
  backfill once with headroom (≥1 GB or host) → run steady-state on 512; re-index is ~24 s so cheap.

## The handler port (V2 → V3 API)
- `import { indexer } from "envio"` (was `from "generated"`); entity types via `import type { … } from "envio"`.
- `indexer.onEvent({ contract: "ProtocolAdapter", event: "X" }, async ({ event, context }) => …)` ×11
  (was `ProtocolAdapter.X.handler(fn)`).
- helper sigs `context: EvmOnEventContext` (was `handlerContext`).
- **Entity CRUD is UNCHANGED** — `context.<Entity>.get/set` still work in handler runtime (the migrate
  guide's `indexer.Entity.set` is TEST-mode only). `event.chainId/logIndex/srcAddress/params` unchanged.
- Config: `networks:` → `chains:`, drop `unordered_multichain_mode` (`config.demo.yaml`, testnet scope).

## THE 4 RUNTIME FIXES (needed to actually RUN V3 on this box — Node 22 / envio 3.2.1 / tsx 4.21)
The brief said "config is 2 lines, handler is the work." True, but the runtime layer was the real
time-sink. All four are needed for ANY base (my Int port OR the reference `feat/hyperindex-v3`):

1. **Node ≥ 22** — V3 hard-requires it (`ERR_PNPM_UNSUPPORTED_ENGINE` on Node 20). `.npmrc`:
   `use-node-version=22.11.0`.
2. **`"type": "module"`** in `package.json` — else tsx transpiles envio's deps to CJS and
   `yoga-layout`'s top-level await breaks (`Top-level await is not supported with the "cjs" output`).
3. **`NODE_OPTIONS="--import tsx"` + `tsx` as a DIRECT devDep** — this is the big one.
   envio's `HandlerLoader.res.mjs` registers tsx via the **deprecated** `module.register("tsx/esm", …)`,
   which **tsx 4.21 rejects on Node 22** (`"tsx must be loaded with --import instead of --loader"`) —
   and envio **swallows the throw in a bare `try/catch`**. tsx then never registers, the `.ts` handler
   is loaded as CJS, and its ESM `import` from `"envio"` (a require cycle) throws
   **`ERR_REQUIRE_CYCLE_MODULE`**. THAT — not the `generated` import — is the real cause of the error
   the earlier V3 test hit. Pre-registering tsx via `--import` fixes it. tsx must be a direct devDep so
   `--import tsx` resolves at top-level `node_modules` (no stray fallback in a container).
4. **Distinct `ENVIO_INDEXER_PORT`** — the default metrics port **9898** collides with the live
   follower. Use e.g. 9899/9900 for any parallel indexer.

Note: the reference `feat/hyperindex-v3` already encodes #1/#2 (its `package.json` has `type:module`,
`node>=22`) but NOT #3/#4 (its `start` is bare `envio start`). So a reference-based resume STILL needs
the tsx + metrics-port fixes.

## The 512 MB measurement rig (isolated)
- `Dockerfile.v3` — `node:22-bookworm-slim` + `ca-certificates` (slim ships none → HyperSync TLS fails
  without it) + baked testnet `config.demo.yaml` + `NODE_OPTIONS=--import tsx`.
- `docker-compose.v3-throwaway.yml` — isolated pg/hasura (distinct project `anoma-v3-throwaway`,
  network, volume, ports 5455/8181). Run: `docker run --memory=512m --memory-swap=512m` (no swap → true
  OOM-at-512) against the throwaway pg, `docker stats` for peak, `docker inspect …State.OOMKilled`.

## Port table (isolation — live stack is UNTOUCHABLE)
| | pg | hasura | metrics |
|---|---|---|---|
| LIVE 2.32.12 (do not touch) | 5433 | 8080 | 9898 |
| this V3 throwaway | 5455 | 8181 | 9899 |

**Never broad-`pkill` envio** — the live follower runs the identical `envio start --config
config.demo.yaml`, so `pkill -f` kills it too. Target by pid / cwd / metrics port. Liveness =
`:9898` `chain_block_height` gauge (advances with head), NOT newest Tag blockNumber (tag-sparse).

## Shelved (resume with nf-demo, post-recording)
Determinism was declared answered-by-cross-validation (this port + the reference agree structurally;
counts track live). The canonical-swap-base decision (this Int port vs the reference's BigInt schema)
and the BigInt→explorer-string impact test are deferred — they only matter if/when we swap the live
demo to V3.
