# Fabrix Central

Central orchestration server for the Fabrix distributed 3D printing platform.

## Maintainer

- BackendGlitch
- contact@backendglitch.com

## Requirements

- Node.js 18+
- pnpm
- PostgreSQL database URL (for Neon or any PostgreSQL provider)

## Setup

1. Install dependencies:

```bash
pnpm install
```

2. Create environment file:

```bash
cp .env.example .env
```

3. Update `.env` values:

```env
NODE_ENV=development
PORT=4000
DATABASE_URL=postgresql://<username>:<password>@<host>/<database>?sslmode=require
```

4. Push database schema:

```bash
pnpm run db:push
```

5. Run in development mode:

```bash
pnpm run start:dev
```

## Verify

- API health check:

```bash
curl http://localhost:4000/health
```

- WebSocket gateway:
  - Path: `ws://localhost:4000/ws/agent`

Expected health response shape:

```json
{
  "status": "ok",
  "service": "fabrix-central",
  "database": "connected",
  "timestamp": "2026-..."
}
```

## Scripts

- `pnpm run start:dev` - start in watch mode
- `pnpm run build` - build project
- `pnpm run start:prod` - run production build
- `pnpm run db:generate` - generate Drizzle SQL/migrations
- `pnpm run db:push` - push Drizzle schema to database
- `pnpm run db:studio` - open Drizzle Studio

## Project Structure

```text
src/
├── main.ts
├── app.module.ts
├── health/
│   ├── health.module.ts
│   ├── health.controller.ts
│   └── health.service.ts
├── ws/
│   ├── ws.module.ts
│   └── agent.gateway.ts
└── database/
    ├── database.module.ts
    ├── database.service.ts
    └── schema.ts
```
