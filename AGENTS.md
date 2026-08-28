# AGENTS.md

Envio HyperIndex v3 indexer for [pa-evm](https://github.com/anoma/pa-evm) `ProtocolAdapter`
events. Human-facing setup, architecture, and release docs live in [README.md](README.md),
and the hosted deployments are documented in [DEPLOYMENTS.md](DEPLOYMENTS.md). This file
only covers what an agent needs that neither of those makes obvious.

## Run codegen first, always

`envio-env.d.ts` references `.envio/types.d.ts`, which is generated and gitignored. On a
fresh clone `pnpm typecheck` and `pnpm build` fail with a wall of "has no exported member"
errors until codegen has run.

`pnpm test` is the exception: vitest strips types through esbuild without checking them, so
the suite passes on a fresh clone and tells you nothing about whether the types are sound.
Do not read a green test run as "codegen is fine".

```bash
npm install -g pnpm   # corepack is gone from the Node images at 25
pnpm install
pnpm codegen          # required before typecheck / build / test
```

Re-run `pnpm codegen` after every edit to `config.yaml` or `schema.graphql`.

If the first `pnpm envio ...` command fails with `ERR_PNPM_IGNORED_BUILDS` for `esbuild`,
the install is incomplete rather than the command being wrong. pnpm runs a dependency check
before executing and aborts on unapproved build scripts. `pnpm approve-builds`, or
`pnpm install --ignore-scripts` if you only need the CLI, clears it.

## Verification loop

```bash
pnpm test           # vitest
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint
pnpm format:check   # prettier
```

Run all four before claiming work is done. They are the part of CI you can reproduce
locally, not all of it: CI also runs `pnpm build`, a per-chain config validation, a
per-chain integration job against live RPCs, and the skills drift check. Those can fail on
a branch that is green locally, so watch the run rather than assuming.

`test/graphql.test.ts` and `test/parity.test.ts` are integration suites gated on
`describe.skipIf`. Without `ENVIO_GRAPHQL_URL` (and `RPC_<CHAIN_NAME>` for parity) both
files skip and `pnpm test` still exits 0. The skip is reported, but only as a count in the
summary line, which is **easy to read as a pass when it is not one**. Check that line and
say which suites actually executed rather than reporting the exit code.

The reverse trap is worth knowing too: if `ENVIO_GRAPHQL_URL` is set in your shell but
points somewhere stale, those suites run and fail on unrelated parse errors that look like
indexer bugs. Resolve a live endpoint rather than trusting the exported one; it changes on
every redeploy:

```bash
npx envio-cloud indexer get anoma-envio-v2-dev --org anoma -o json   # read gql_endpoint
```

Pick the indexer whose branch matches the code under test (see below). `pnpm dev` serves a
local endpoint too, which is the better target when no hosted indexer has your branch yet.

## The three files that carry the behavior

| File                   | Holds                                                 |
| ---------------------- | ----------------------------------------------------- |
| `config.yaml`          | chains, contract addresses, `start_block`, event ABIs |
| `schema.graphql`       | entities and relationships                            |
| `src/handlers/`        | per-event logic, auto-loaded by Envio                 |

Work test-first: add a failing test under `test/`, implement the handler, `pnpm test`,
iterate. `test/fixtures/encode-tx.ts` builds synthetic `execute()` calldata so handler
tests need no live chain.

## config.yaml gotchas

- The `# Name` comment is load-bearing. `scripts/generate-ci-matrix.sh` regex-parses
  `- id: <number> # <Name>` to build the CI matrix. Drop or reword that comment and the
  chain silently vanishes from CI.
- Indexing and CI want different things from a chain. Indexing goes through HyperSync,
  which v3 auto-resolves from the chain id given `ENVIO_API_TOKEN`, and most chains here carry
  no `rpc.url` at all. Add `rpc.url` only for a chain HyperSync does not cover; `config.yaml`
  carries an inline comment on each such chain saying why. CI is the separate constraint:
  `start_block` validation needs an archive RPC, so a new chain also needs `rpc.url`, an
  `ALCHEMY_SLUGS` entry, or a `PUBLIC_RPCS` entry in `scripts/generate-ci-matrix.sh`. That is
  why some chains appear in `PUBLIC_RPCS` despite indexing fine over HyperSync: the entry is
  for CI, not for the indexer. Missing all three fails the matrix build by design; that is
  the check working, not a flake.
- `${VAR:-default}` would be resolved by CI, not by Envio. Every CI job rewrites the file
  with `perl` before codegen. No chain uses that syntax today, so the step is currently a
  no-op, but if you add one remember that nothing expands it locally and codegen will see
  the literal string.
- Addresses must match the pa-evm release the indexer targets; cross-check against
  [pa-evm](https://github.com/anoma/pa-evm) rather than editing them from memory.

## Handler invariants

`src/handlers/transaction.ts` documents pa-evm's intra-transaction event order and the
canonical tag order (consumed nullifiers first, then created commitments). Both come from
`ProtocolAdapter._execute` on the contract side. Read that header comment before touching
ordering or tag logic. Reordering the handlers silently corrupts entity linkage rather
than throwing.

`src/utils/BoundedCache.ts` is a FIFO cache with a fixed ceiling; it exists to stop
unbounded memory growth across a long sync. Do not swap it for an unbounded map.

## Envio docs, for agents

Envio ships agent-facing tooling. Prefer it over guessing at the API surface.

```bash
pnpm envio tools search-docs "<query>"   # titles, URLs and snippets for each hit
pnpm envio tools fetch-docs "<url>"      # full markdown of one page
```

Both work from any harness and always reflect the pinned CLI, so prefer them over recalling
the API from memory.

`envio config view` looks like it belongs in that list but does not. Despite its help
saying "the resolved indexer config", it prints only the CLI version and storage backend,
with no chains or contracts, so read `config.yaml` directly instead.

Envio's own guidance is checked in under `.claude/skills/`, extracted from the pinned CLI
by `pnpm envio skills update`. Despite the directory name these are plain Markdown files,
not a Claude-only format, and they are worth reading from any harness.

Claude Code discovers them automatically. **Every other agent must open them by hand.**
Before working on handlers, `schema.graphql`, tests, chain config, or a sync-performance
question, check whether a matching skill exists and read it first. Each file opens with a
`description` saying exactly when it applies.

```bash
ls .claude/skills/                          # what is available
cat .claude/skills/indexer-schema/SKILL.md  # read one
```

The topics track whatever the pinned CLI ships, so list the directory rather than working
from a remembered set of names.

They are extracted from a pinned dependency, so they go stale silently the moment `envio`
moves. CI enforces the refresh rather than trusting anyone to remember: the
`Skills match the pinned CLI` step in the quality job re-extracts them and fails on any
difference. Extraction is byte-deterministic for a given version, so a diff there is always
real drift. When it fires:

```bash
pnpm install                  # get the new envio first
pnpm envio skills update
git add .claude/skills/       # -f if your global gitignore excludes .claude/
git commit --amend --no-edit  # fold it into the bump, not a follow-up commit
```

Expect most skills to change across a version jump and expect new ones to appear; that is a
normal part of the bump, not an unusual failure.

Envio also runs a docs MCP server exposing `docs_search` and `docs_fetch`, which is the
same corpus the `tools` commands above search. It needs no authentication:

```bash
claude mcp add --transport http envio-docs https://docs.envio.dev/mcp
```

That lands at `local` scope, which is personal to you and to this checkout. Adding it with
`--scope project` instead writes a committed `.mcp.json` that every contributor picks up,
so use it only if the team wants the server by default.

Reference URLs:

- <https://docs.envio.dev/llms.txt> (documentation index for LLMs)
- <https://docs.envio.dev/docs/HyperIndex-LLM/hyperindex-complete> (full docs as one bundle)
- <https://docs.envio.dev/docs/HyperIndex/quickstart-with-ai> (Envio's own agent guidance)

This project pins `envio` in `package.json`; when the CLI and the docs disagree, the pinned
CLI's `--help` wins. Do not invent flags.

## Some branches deploy themselves

Envio watches this repository and redeploys on push, but only for two projects:
`anoma-envio-dev` on `next` and `anoma-envio-stag` on `main`. A push to either starts a
live indexer, so neither branch is private. Everything else is deployed by hand, including
production, both explorer indexers and both v2 indexers.

Work on a feature branch and open a PR; see [DEPLOYMENTS.md](DEPLOYMENTS.md) for which
project watches which branch, and for the hours budget that makes stale deployments
expensive. Those settings are changed through the Envio UI without touching this repo, so
confirm them against the API rather than the table:

```bash
npx envio-cloud indexer settings get INDEXER --org anoma -o json   # branch, auto_deploy
```

The pa-evm v2 migration has two indexers of its own: `anoma-envio-v2` on `pa-v2` and
`anoma-envio-v2-dev` on `pa-v2-next`, the integration branch that feeds it. Both are manual
deploys. Before deleting anything that looks dead on `main`, check whether v2 reshapes it.
Two unreferenced event interfaces were nearly removed that way; v2 rebuilds them rather
than dropping them.

The hosted deployments are inspectable from the terminal with the separate `envio-cloud`
package (`npx envio-cloud`), which is useful when a question is really about what is
running rather than about the code:

```bash
npx envio-cloud indexer list --org anoma -o json
npx envio-cloud deployment status INDEXER COMMIT
npx envio-cloud deployment logs INDEXER COMMIT --limit 100
```

Read-only is the `list`, `get`, `status`, `metrics`, `info`, `endpoint`, `logs`, `commits`,
and `settings get` family. Everything else writes: `deployment deploy`, `promote`,
`restart`, `delete`, plus `indexer add`, `delete`, `settings set`, `env set`, `env delete`,
and the whole `indexer security` subtree. `indexer delete` takes an entire project and all
its data, irreversibly. **Do not run any of the writing ones on your own initiative; ask.**

## Conventions

- Node per `engines` in `package.json`, pnpm via `npm install -g pnpm`. Prettier and ESLint
  configs are authoritative; do not hand-format.
- `.envio/types.d.ts` and `.env` are gitignored; never commit them. The `generated/` entry
  in `.gitignore` is a v2 leftover, v3 codegen does not create that directory. Never commit
  an API key or an RPC URL containing one. `ENVIO_API_TOKEN` belongs in `.env`.
- Conventional Commits, one topic per commit, PRs target `main`.
