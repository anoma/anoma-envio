# anoma-envio

[![CI](https://github.com/anoma/anoma-envio/actions/workflows/ci.yml/badge.svg)](https://github.com/anoma/anoma-envio/actions/workflows/ci.yml) [![Docker](https://github.com/anoma/anoma-envio/actions/workflows/docker.yml/badge.svg)](https://github.com/anoma/anoma-envio/actions/workflows/docker.yml)

[Envio Hyperindex](https://docs.envio.dev/) indexer for [Anoma Protocol Adapter](https://github.com/anoma/pa-evm) events. Indexes `ProtocolAdapter` contract activity across multiple EVM chains and exposes the data through a GraphQL API.

## Building Locally

### Requirements

| Tool    | Version | Notes                            |
| ------- | ------- | -------------------------------- |
| Node.js | `>= 18` | v20 recommended (used in Docker) |
| pnpm    | Latest  | Enabled via `corepack enable`    |

### Build Steps

```bash
corepack enable          # enables pnpm
pnpm install             # install dependencies
pnpm codegen             # generate types from config.yaml + schema.graphql
pnpm build               # compile TypeScript
```

`pnpm codegen` must run before anything else — it reads `config.yaml` and `schema.graphql` to produce typed handler contexts and entity definitions in the `.envio/` directory.

A successful build compiles with no errors and produces output in `build/`.

## Running Locally

Start the Envio local development environment:

```bash
pnpm dev
```

This spins up the Envio indexer locally using Docker (Envio manages its own containers for Postgres and the indexer runtime). The GraphQL playground is available at `http://localhost:8080` once the indexer is running.

For production mode:

```bash
pnpm start
```

### Running the Docker Image

This repository holds a `docker-compose.yml` file to easily start the Anoma Envio indexer locally. It can either use an image from the registry on GitHub, or you can build the image locally first.

To build locally and then run, use the `build` profile.

```bash
docker compose --profile build build --no-cache
docker compose --profile build up
```

To run the latest image from the GitHub registry use the `prebuilt` profile.
You can choose another image by changing the compose file accordingly.

```bash
docker compose --profile prebuilt up
```

On every push to `main`, CI publishes a Docker image to GitHub Container Registry:

```bash
docker pull ghcr.io/anoma/anoma-envio:envio-branch-main
docker run --rm -p 9898:9898 ghcr.io/anoma/anoma-envio:envio-branch-main
```

## Configuration

The indexer is configured through two files and environment variables (see below for Docker Compose deployments).

### `config.yaml`

Defines which contracts, events, and networks the indexer tracks. This is the source of truth for what gets indexed.

| Field                            | Description                                                        |
| -------------------------------- | ------------------------------------------------------------------ |
| `contracts[].name`               | Contract name (must match ABI)                                     |
| `contracts[].handler`            | Path to the TypeScript event handler                               |
| `contracts[].events`             | List of Solidity event signatures to index                         |
| `chains[].id`                    | EVM chain ID                                                       |
| `chains[].start_block`           | Block to start indexing from                                       |
| `chains[].contracts[].address`   | Contract address on that chain                                     |
| `field_selection`                | Additional EVM transaction fields to capture (hash, from, to, etc) |
| `save_full_history`              | Whether to retain the full history of entity changes               |

Currently tracked chains and addresses (from [pa-evm](https://github.com/anoma/pa-evm)). This
indexer targets the pa-evm v2 protocol adapter only, which so far is deployed on two testnets.

| Chain        | Chain ID | Contract Address                             | Version     |
| ------------ | -------- | -------------------------------------------- | ----------- |
| Base Sepolia | 84532    | `0xED41cB03feaFB2159182b385873BFa858C577e96` | v2 (in use) |
| Base Sepolia | 84532    | `0x6BbDF59F869957dDC96e8a4d79077613727e6537` | v2 alpha.5  |
| Sepolia      | 11155111 | `0xb7f6DE4Edc94b871B5dB57aa40BbBabC6E9F56fE` | v2 alpha.5  |

The two alpha.5 rows are the canonical deployments recorded in
[`deployments.json`](https://github.com/anoma/pa-evm/blob/contracts/v2.0.0-alpha.5/crates/bindings/deployments.json);
neither has executed a transaction yet, so `0xED41cB03…` is the only address currently producing
`TransactionExecuted` and `ActionExecuted` data. Addresses are the ERC-1967 proxies, not the
implementations: the proxy holds the state and emits the events.

### `schema.graphql`

Defines the GraphQL entities that get stored and queried. Core entities: `EVMTransaction`, `Transaction`, `Action`, `Tag`, `Resource`, `Payload`, `CommitmentTreeRoot`, `KindTableCommitment`, `ForwarderCall`, `ProtocolAdapterUpgraded`, and `Stats`.

### Environment Variables

Production runs on Envio's hosted service, which manages its own database, Hasura, and
process configuration — none of the variables below apply there. They exist for the local
`docker compose` stack (also used by the CI integration job); `pnpm dev` sets its own.

Everything Postgres- and Hasura-related is defined in `docker-compose.yml` and only needs
touching if you change that stack. The ones worth knowing:

| Variable            | Default          | Description                                                              |
| ------------------- | ---------------- | ------------------------------------------------------------------------ |
| `ENVIO_API_TOKEN`   | —                | HyperSync API token. Required to sync; get one at envio.dev/app/api-tokens |
| `ENVIO_TUI`         | `false`          | Terminal UI. Must stay `false` in Docker (v3 name; was `TUI_OFF` in v2)  |
| `LOG_LEVEL`         | `warn`           | Log verbosity (`trace`, `debug`, `info`, `warn`, `error`)                |
| `LOG_STRATEGY`      | `console-pretty` | Logging output format                                                    |
| `ENVIO_GRAPHQL_URL` | —                | Tests only: GraphQL endpoint the integration tests query                 |

Envio reads `config.yaml` from the working directory by default, so no variable selects the
config file.

## External Dependencies

| Dependency           | Required? | Purpose                                                                    | Notes                                                                                  |
| -------------------- | --------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Envio Hyperindex** | Yes       | Indexer runtime — manages Postgres, block ingestion, and the GraphQL API   | Installed as an npm dependency (`envio`). `pnpm dev` handles local setup automatically |
| **pa-evm contracts** | Yes       | The `ProtocolAdapter` contracts this indexer tracks                        | Addresses and chain IDs are defined in `config.yaml`                                   |
| **Docker**           | Yes       | Required by `pnpm dev` — Envio runs Postgres and its runtime in containers | Must be running before starting local development                                      |

## Troubleshooting Checklist

- **`pnpm dev` fails to start** — Make sure Docker is running. Envio needs it for Postgres and the indexer runtime.
- **Type errors after pulling new changes** — Re-run `pnpm codegen` to regenerate types from updated `config.yaml` or `schema.graphql`.
- **Indexer not picking up events** — Verify the contract addresses and chain IDs in `config.yaml` match the deployed pa-evm contracts. Cross-check with [pa-evm](https://github.com/anoma/pa-evm).
- **GraphQL returns empty data** — The indexer may still be syncing. Check the logs from `pnpm dev` for block progress. Also confirm `start_block` in `config.yaml` is correct for the target chain.
- **Tests fail with connection error** — Set `ENVIO_GRAPHQL_URL` to a running Envio GraphQL endpoint before running `pnpm test`.
- **`.envio/` types missing or stale** — Run `pnpm codegen`. This directory is gitignored and must be regenerated locally.

## Testing

```bash
pnpm test
```

Tests require a running Envio instance with indexed data. Set the endpoint before running:

```bash
ENVIO_GRAPHQL_URL="https://your-envio-endpoint" pnpm test
```

The test suite includes integration tests against the GraphQL API and unit tests for the calldata and resource decoders.

For code quality checks (same as CI):

```bash
pnpm format:check    # Prettier
pnpm lint            # ESLint
pnpm typecheck       # TypeScript type checking
```

## Release Process

1. Make sure all required features are merged into `main`.
2. Verify the contract addresses in `config.yaml` match the pa-evm version you intend to index.
3. Bump the version in `package.json`.
4. Commit the version bump, tag the commit (`git tag vx.y.z`), and push both (`git push origin main --tags`).
5. CI builds and publishes a new Docker image to `ghcr.io/anoma/anoma-envio`.
6. Coordinate deployment with the infrastructure team. See [DEPLOYMENTS.md](DEPLOYMENTS.md)
   for the Envio-hosted projects, which branch each one watches, and how to
   trigger or clean up a deployment.

Docker images are tagged by branch (`envio-branch-main`), by PR (`envio-pr-<number>`), and by git tag. Production deployments use the `main` branch tag or a specific version tag.

## Architecture

```
src/
├── EventHandlers.ts       # Core event handlers for all 12 ProtocolAdapter events
├── constants.ts           # Selectors, cache sizes, helper functions
├── decoders/
│   └── ActionDecoder.ts   # Decodes execute() calldata into typed Action structs
├── types/                 # TypeScript types mirroring pa-evm Solidity structs
└── utils/
    ├── BoundedCache.ts    # FIFO cache for decoded calldata (prevents memory growth)
    └── index.ts           # Utility re-exports
test/
├── graphql.test.ts        # Integration tests against GraphQL endpoint
├── decoders/              # Unit tests for calldata and blob decoders
└── fixtures/              # Synthetic execute() calldata for handler tests
config.yaml                # Indexer config: contracts, events, chains, addresses
schema.graphql             # GraphQL entity definitions
```

Event processing order within an EVM transaction:

1. Payload events (`ResourcePayload`, `DiscoveryPayload`, `ExternalPayload`, `ApplicationPayload`) create `Tag` and `Payload` entities
2. `ForwarderCallExecuted` records external call data
3. `CommitmentTreeRootAdded` stores new roots
4. `ActionExecuted` is authoritative for the action's tags and their logic references, and creates the `Resource` entities; calldata decoding adds the action delta, each consumed resource's commitment tree root, and the app data payload counts
5. `TransactionExecuted` creates the `Transaction` and relinks the actions and tags emitted before it

`KindTableCommitmentUpdated` is recorded independently of that order; the latest row per chain is the kind table transactions must currently prove against. `Upgraded` is likewise independent: the v2 adapters are ERC-1967 proxies, so it records which implementation was in force at a given block.
