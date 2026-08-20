# anoma-envio

[![CI](https://github.com/anoma/anoma-envio/actions/workflows/ci.yml/badge.svg)](https://github.com/anoma/anoma-envio/actions/workflows/ci.yml) [![Docker](https://github.com/anoma/anoma-envio/actions/workflows/docker.yml/badge.svg)](https://github.com/anoma/anoma-envio/actions/workflows/docker.yml)

[Envio HyperIndex](https://docs.envio.dev/) indexer for [pa-evm](https://github.com/anoma/pa-evm)
`ProtocolAdapter` events. Indexes contract activity across several EVM chains and serves it
over GraphQL.

- Agent and contributor notes: [AGENTS.md](AGENTS.md)
- Hosted deployments, tiers and the Envio Cloud CLI: [DEPLOYMENTS.md](DEPLOYMENTS.md)

## Quick start

Node version is pinned by `engines` in [package.json](package.json). pnpm is not bundled with
Node 25+, so install it directly, and match the version CI and the image use:

```bash
npm install -g pnpm@9
pnpm install
pnpm codegen      # required before build, typecheck or a meaningful test run
pnpm dev          # local indexer + GraphQL playground on http://localhost:8080
```

`pnpm codegen` reads `config.yaml` and `schema.graphql` and writes the typed handler contexts.
Re-run it after editing either file; without it `pnpm build` and `pnpm typecheck` fail on a
fresh clone. `pnpm dev` needs Docker running, since Envio brings up Postgres itself.

`pnpm start` runs the same indexer in production mode.

## What is configured where

| File                                           | Source of truth for                                       |
| ---------------------------------------------- | --------------------------------------------------------- |
| [`config.yaml`](config.yaml)                   | chains, contract addresses, `start_block`, indexed events |
| [`config.prod.yaml`](config.prod.yaml)         | the narrower chain set production indexes                 |
| [`schema.graphql`](schema.graphql)             | GraphQL entities and relationships                        |
| [`src/EventHandlers.ts`](src/EventHandlers.ts) | per-event logic and the intra-transaction event order     |
| [`docker-compose.yml`](docker-compose.yml)     | environment variables for containerised runs              |
| [`.github/workflows/`](.github/workflows/)     | what CI runs and how images are tagged                    |

Chains are listed in `config.yaml` with a `# Name` comment per entry; that comment is parsed by
`scripts/generate-ci-matrix.sh`, so the file is both the config and the chain list. Contract
addresses must match the pa-evm release being indexed.

## Docker

```bash
docker compose --profile build up      # build the image locally, then run
docker compose --profile prebuilt up   # pull the published image instead
```

The `prebuilt` profile pulls `${ENVIO_IMAGE_TAG:-next-envio}`; set `ENVIO_IMAGE_TAG` to run a
different one.

CI publishes to `ghcr.io/anoma/anoma-envio` on pushes to the integration branches, on pull
requests, and on release tags. The tag scheme lives in
[`.github/workflows/docker.yml`](.github/workflows/docker.yml); read it there rather than
guessing a tag name.

## Testing

```bash
pnpm test           # vitest
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint
pnpm format:check   # prettier
```

Most of the suite runs offline. `test/graphql.test.ts` and `test/parity.test.ts` are integration
suites that skip unless `ENVIO_GRAPHQL_URL` is set (and `RPC_<CHAIN_NAME>` for parity), so a
green run with them skipped is not the same as a green run with them executed. See
[AGENTS.md](AGENTS.md) for the full verification loop and the traps around it.

```bash
ENVIO_GRAPHQL_URL="https://your-envio-endpoint" pnpm test
```

## Release

`next` is development, `main` is staging, and a tag is production. Staging deploys itself from
`main`; production is promoted by hand.

1. Merge everything intended for the release into `main`.
2. Confirm the contract addresses in `config.yaml` match the target pa-evm release.
3. Bump `version` in `package.json`, commit, tag `vx.y.z`, and push with `--tags`.
4. CI builds and publishes the tagged image.
5. Deploy and promote it, then delete the superseded deployment. See
   [DEPLOYMENTS.md](DEPLOYMENTS.md) for which project watches which branch and the
   `envio-cloud` commands for each step.

## Troubleshooting

- **`pnpm dev` will not start** — Docker is not running.
- **"has no exported member" errors** — run `pnpm codegen`.
- **`ERR_PNPM_IGNORED_BUILDS` for esbuild** — you are on pnpm 10 or newer; CI and the image
  pin pnpm 9. Use `pnpm@9`. Do not run `pnpm approve-builds` to get past it: it writes a
  `pnpm-workspace.yaml` that then fails under pnpm 9 and in the Docker build with
  `packages field missing or empty`. If you already have that file and did not write it
  yourself, delete it.
- **Empty GraphQL results** — the indexer is probably still syncing; check the logs for block progress and confirm `start_block`.
- **Tests fail to connect** — `ENVIO_GRAPHQL_URL` is unset or points somewhere stale.
