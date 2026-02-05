# anoma-envio

Envio Hyperindex indexer for Anoma smart contracts.

## Setup

```bash
pnpm install
pnpm codegen
```

## Development

```bash
pnpm dev      # Start local indexer
pnpm test     # Run tests
pnpm lint     # Run ESLint
pnpm format   # Format with Prettier
```

## Configuration

- `config.yaml` - Indexer configuration (networks, contracts, events)
- `schema.graphql` - GraphQL schema for indexed entities

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ENVIO_GRAPHQL_URL` | GraphQL endpoint (for tests) |

## License

See [LICENSE](LICENSE).
