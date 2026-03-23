FROM node:20-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

RUN perl -pe 's/\$\{(\w+):-([^}]*)\}/defined $ENV{$1} ? $ENV{$1} : $2/ge' config.yaml > config.resolved.yaml && mv config.resolved.yaml config.yaml
RUN pnpm codegen

EXPOSE 9898

CMD ["pnpm", "start"]
