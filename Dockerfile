FROM node:20-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN corepack enable && corepack install --global pnpm@9.15.9

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# Resolve ${VAR:-default} substitutions in every config file at build time.
# At runtime, CONFIG_FILE env var selects which one Envio loads (default: config.yaml).
RUN for f in config.yaml config.prod.yaml; do \
      perl -pe 's/\$\{(\w+):-([^}]*)\}/defined $ENV{$1} ? $ENV{$1} : $2/ge' "$f" > "$f.resolved" && mv "$f.resolved" "$f"; \
    done
RUN pnpm codegen

EXPOSE 9898

CMD ["pnpm", "start"]
