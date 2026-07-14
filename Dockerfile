FROM node:20-bookworm-slim

# CA trust store: bookworm-slim ships no ca-certificates, so envio's TLS client
# (HyperSync over https) fails with `invalid peer certificate: UnknownIssuer`.
# Linux-container-only — the native macOS run uses the system keychain instead.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN corepack enable && corepack install --global pnpm@9.15.9

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# Which config to bake. codegen bakes the network scope at BUILD time, so the config
# chosen here — not a runtime mount — decides which chains the image indexes.
# Demo (3 testnets) build: --build-arg CONFIG_FILE=config.demo.yaml
# Default stays config.yaml so existing consumers are unaffected.
ARG CONFIG_FILE=config.yaml
ENV CONFIG_FILE=${CONFIG_FILE}

# Resolve ${VAR:-default} substitutions at build time (now includes config.demo.yaml).
RUN for f in config.yaml config.prod.yaml config.demo.yaml; do \
      [ -f "$f" ] && perl -pe 's/\$\{(\w+):-([^}]*)\}/defined $ENV{$1} ? $ENV{$1} : $2/ge' "$f" > "$f.resolved" && mv "$f.resolved" "$f" || true; \
    done

# Codegen against the SELECTED config so its networks are baked (was always config.yaml).
RUN pnpm envio codegen --config "${CONFIG_FILE}"

EXPOSE 9898

CMD ["pnpm", "start"]
