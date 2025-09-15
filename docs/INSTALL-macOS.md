# Installation (macOS) — Backend MongoDB only

This project runs in DB-only mode (no in-memory fallback). MongoDB must be installed and reachable.

## 1) Prerequisites

- Homebrew: https://brew.sh/
- Node.js 18+ and pnpm
  - brew install node
  - corepack enable
  - corepack prepare pnpm@latest --activate

## 2) Install MongoDB Community Server

```
brew tap mongodb/brew
brew install mongodb-community@7.0
brew services start mongodb-community@7.0
```

Verify:

```
mongosh --eval "db.runCommand({ connectionStatus: 1 })"
```

## 3) Create database (optional)

MongoDB creates databases on first write. Default DB name: dao-management.

## 4) Environment (.env.local)

```
PORT=3001
FRONTEND_URL=http://localhost:8080
MONGODB_URI=mongodb://localhost:27017/dao-management
JWT_SECRET=$(openssl rand -hex 48)
ADMIN_EMAIL=admin@2snd.fr
ADMIN_PASSWORD=admin123
FORCE_DB_ONLY=1
MONGODB_FAST_FAIL=1
```

Notes:

- FORCE_DB_ONLY=1 disables all in-memory fallbacks globally.
- ADMIN_EMAIL/ADMIN_PASSWORD ensures a super-admin on startup.

## 5) Install and run

```
pnpm install
pnpm dev
```

- Backend: http://localhost:3001
- Frontend: http://localhost:8080

## 6) Health

- API: http://localhost:3001/api/health
- DB: http://localhost:3001/api/health/db (ok:true means Mongo connected)

## 7) Troubleshooting

- If DB health fails: `brew services list` then `brew services start mongodb-community@7.0`.
- Port conflicts: change PORT or stop the conflicting process.
- JWT_SECRET must be ≥ 32 chars.
