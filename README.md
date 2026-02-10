# anoma-envio

[![CI](https://github.com/anoma/anoma-envio/actions/workflows/ci.yml/badge.svg)](https://github.com/anoma/anoma-envio/actions/workflows/ci.yml) [![Docker](https://github.com/anoma/anoma-envio/actions/workflows/docker.yml/badge.svg)](https://github.com/anoma/anoma-envio/actions/workflows/docker.yml)

[Envio Hyperindex](https://docs.envio.dev/) indexer for [Anoma Protocol Adapter](https://github.com/anoma/pa-evm) events. Indexes `ProtocolAdapter` contract activity across multiple EVM chains and exposes the data through a GraphQL API.

## Building Locally

### Requirements

| Tool   | Version    | Notes                            |
|--------|------------|----------------------------------|
| Node.js| `>= 18`   | v20 recommended (used in Docker) |
| pnpm   | Latest     | Enabled via `corepack enable`    |

### Build Steps

```bash
corepack enable          # enables pnpm
pnpm install             # install dependencies
pnpm codegen             # generate types from config.yaml + schema.graphql
pnpm build               # compile TypeScript
```

`pnpm codegen` must run before anything else — it reads `config.yaml` and `schema.graphql` to produce typed handler contexts and entity definitions in the `generated/` directory.

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

On every push to `main`, CI publishes a Docker image to GitHub Container Registry:

```bash
docker pull ghcr.io/anoma/anoma-envio:envio-branch-main
docker run --rm -p 9898:9898 ghcr.io/anoma/anoma-envio:envio-branch-main
```

## Configuration

The indexer is configured through two files — there are no environment variables needed for running the indexer itself.

### `config.yaml`

Defines which contracts, events, and networks the indexer tracks. This is the source of truth for what gets indexed.

| Field                       | Description                                                        |
|-----------------------------|--------------------------------------------------------------------|
| `contracts[].name`          | Contract name (must match ABI)                                     |
| `contracts[].handler`       | Path to the TypeScript event handler                               |
| `contracts[].events`        | List of Solidity event signatures to index                         |
| `networks[].id`             | EVM chain ID                                                       |
| `networks[].start_block`    | Block to start indexing from                                       |
| `networks[].contracts[].address` | Contract address on that chain                                |
| `field_selection`           | Additional EVM transaction fields to capture (hash, from, to, etc) |
| `unordered_multichain_mode` | Allows parallel block processing across chains                     |

Currently tracked chains and addresses (from [pa-evm](https://github.com/anoma/pa-evm)):

| Chain    | Chain ID | Contract Address                             |
|----------|----------|----------------------------------------------|
| Ethereum | 1        | `0x0eA3B55b68A3f307c8FE3fe66E443247c95F0CfF` |
| Arbitrum | 42161    | `0x094FCC095323080e71a037b2B1e3519c07dd84F8` |
| Base     | 8453     | `0x094FCC095323080e71a037b2B1e3519c07dd84F8` |
| Optimism | 10       | `0x094FCC095323080e71a037b2B1e3519c07dd84F8` |

### `schema.graphql`

Defines the GraphQL entities that get stored and queried. Core entities: `EVMTransaction`, `Transaction`, `Action`, `Tag`, `ComplianceUnit`, `LogicInput`, `Payload`, `CommitmentTreeRoot`, `ForwarderCall`, and `Stats`.

### Environment Variables

| Variable            | Required?   | Description                                          |
|---------------------|-------------|------------------------------------------------------|
| `ENVIO_GRAPHQL_URL` | Tests only  | GraphQL endpoint URL used by the integration tests   |

## External Dependencies

| Dependency              | Required? | Purpose                                                    | Notes                                                                                   |
|-------------------------|-----------|------------------------------------------------------------|-----------------------------------------------------------------------------------------|
| **Envio Hyperindex**    | Yes       | Indexer runtime — manages Postgres, block ingestion, and the GraphQL API | Installed as an npm dependency (`envio`). `pnpm dev` handles local setup automatically  |
| **pa-evm contracts**    | Yes       | The `ProtocolAdapter` contracts this indexer tracks         | Addresses and chain IDs are defined in `config.yaml`                                    |
| **Docker**              | Yes       | Required by `pnpm dev` — Envio runs Postgres and its runtime in containers | Must be running before starting local development                                       |

## Troubleshooting Checklist

- **`pnpm dev` fails to start** — Make sure Docker is running. Envio needs it for Postgres and the indexer runtime.
- **Type errors after pulling new changes** — Re-run `pnpm codegen` to regenerate types from updated `config.yaml` or `schema.graphql`.
- **Indexer not picking up events** — Verify the contract addresses and chain IDs in `config.yaml` match the deployed pa-evm contracts. Cross-check with [pa-evm](https://github.com/anoma/pa-evm).
- **GraphQL returns empty data** — The indexer may still be syncing. Check the logs from `pnpm dev` for block progress. Also confirm `start_block` in `config.yaml` is correct for the target chain.
- **Tests fail with connection error** — Set `ENVIO_GRAPHQL_URL` to a running Envio GraphQL endpoint before running `pnpm test`.
- **`generated/` directory missing or stale** — Run `pnpm codegen`. This directory is gitignored and must be regenerated locally.

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
6. Coordinate deployment with the infrastructure team.

Docker images are tagged by branch (`envio-branch-main`), by PR (`envio-pr-<number>`), and by git tag. Production deployments use the `main` branch tag or a specific version tag.

## Architecture

```
src/
├── EventHandlers.ts       # Core event handlers for all 11 ProtocolAdapter events
├── constants.ts           # Selectors, cache sizes, helper functions
├── decoders/
│   ├── ActionDecoder.ts   # Decodes execute() calldata into typed Action structs
│   └── ResourceDecoder.ts # Decodes resource payload blobs
├── types/                 # TypeScript types mirroring pa-evm Solidity structs
└── utils/
    ├── BoundedCache.ts    # FIFO cache for decoded calldata (prevents memory growth)
    └── abi.ts             # ABI definitions for viem decoding
test/
├── graphql.test.ts        # Integration tests against GraphQL endpoint
├── decoders/              # Unit tests for calldata and blob decoders
└── fixtures/              # Real transaction data from Base mainnet
config.yaml                # Indexer config: contracts, events, chains, addresses
schema.graphql             # GraphQL entity definitions
```

Event processing order within an EVM transaction:
1. Payload events (`ResourcePayload`, `DiscoveryPayload`, `ExternalPayload`, `ApplicationPayload`) create `Tag` and `Payload` entities
2. `ForwarderCallExecuted` records external call data
3. `CommitmentTreeRootAdded` stores new roots
4. `ActionExecuted` decodes calldata to create `ComplianceUnit` and `LogicInput` entities
5. `TransactionExecuted` finalizes the transaction with the authoritative tag list
