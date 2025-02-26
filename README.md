# Development

## Requirements

- [Node.js (3.8.0+)](https://nodejs.org/)
- [Docker](https://docs.docker.com/engine/)

## Configuring the Project for Development

> [!NOTE]
> If you don't have your IDLs and master key for signing transactions, you must first set up Solana programs.

### Deposit Program

1. Set up and deploy the [Solana Deposit Program](https://github.com/insight-extension/solana-deposit-program).
2. Replace `deposit_program.json` and `deposit_program.ts` in `src/payment/interfaces` with your new program's IDLs.

### Faucet Program

1. Set up and deploy the [Insight Faucet Program](https://github.com/insight-extension/insight-faucet).
2. Replace `insight_faucet.json` and `insight_faucet.ts` in `src/faucet/interfaces` with your new program's IDLs.

### Environment Configuration

> [!NOTE]
> For development purposes, set `NODE_ENV=development`.

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
2. Fill in the required environment variables.

---

> [!NOTE]
> There are two options for starting the application:
>
> - **Only required services** (recommended for backend development).
> - **Full application setup** (useful for frontend testing and quick setup).

## Starting Only Required Services (Postgres, Adminer, Loki, Grafana)

```bash
docker compose -f docker-compose.dev.yaml up -d
```

### Install Dependencies

```bash
pnpm install
```

### Build the Application

```bash
pnpm run build
```

### Apply Database Migrations

```bash
pnpm exec prisma migrate dev
```

### Running the Project

Start in development mode:

```bash
pnpm run start:dev
```

---

## Starting the Whole Application

```bash
docker compose up -d
```

---

### Open in Browser

- API: [http://localhost:YOUR_API_PORT](http://localhost:YOUR_API_PORT)
- Swagger: [http://localhost:YOUR_API_PORT/api/swagger](http://localhost:YOUR_API_PORT/api/swagger)
- Grafana: [http://localhost:3000](http://localhost:3000)
