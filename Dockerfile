FROM node:26-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

# corepack ships with the node images only through 24; install pnpm directly
# so the image builds on any base tag.
RUN npm install --global pnpm@9.15.9

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# Resolve ${VAR:-default} substitutions in the config at build time.
RUN perl -pe 's/\$\{(\w+):-([^}]*)\}/defined $ENV{$1} ? $ENV{$1} : $2/ge' config.yaml > config.yaml.resolved \
    && mv config.yaml.resolved config.yaml
RUN pnpm codegen

EXPOSE 9898

CMD ["pnpm", "start"]
