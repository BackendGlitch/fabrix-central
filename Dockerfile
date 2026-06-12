# Stage 1 — Build
FROM node:24-slim AS builder

RUN npm install -g pnpm@latest

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts && \
    pnpm rebuild @nestjs/core bcrypt esbuild

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src/ ./src/

RUN pnpm build

# Stage 2 — Production runtime
FROM node:24-slim AS runner

RUN npm install -g pnpm@latest

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts && \
    pnpm rebuild @nestjs/core bcrypt

COPY --from=builder /app/dist ./dist

EXPOSE 4000

CMD ["node", "dist/main"]
