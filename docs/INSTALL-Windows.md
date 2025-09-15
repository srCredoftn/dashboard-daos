# Installation (Windows) — Backend MongoDB only

This project runs in DB-only mode (no in-memory fallback). Install MongoDB locally and ensure it is running.

## 1) Prerequisites

- Node.js 18+ (https://nodejs.org) and pnpm
  - Install Node.js LTS (includes Corepack)
  - In PowerShell (as user): `corepack enable` then `corepack prepare pnpm@latest --activate`

## 2) Install MongoDB Community Server

- Download MSI: https://www.mongodb.com/try/download/community
- Choose "Install MongoDB as a Service" (Network Service user)
- Complete setup and start the MongoDB service

Verify the service:

- Open Windows Services → MongoDB Server → Status: Running
- Or PowerShell: `"db.runCommand({ connectionStatus: 1 })" | mongosh`

## 3) Database

MongoDB creates DBs on first write. Default DB: dao-management.

## 4) Environment (.env.local)

Create a file `.env.local` in the project root:

```
PORT=3001
FRONTEND_URL=http://localhost:8080
MONGODB_URI=mongodb://localhost:27017/dao-management
JWT_SECRET=change_me_to_a_long_random_string_min_48chars
ADMIN_EMAIL=admin@2snd.fr
ADMIN_PASSWORD=admin123
FORCE_DB_ONLY=1
MONGODB_FAST_FAIL=1
```

Tip: generate JWT_SECRET with PowerShell:

```
[guid]::NewGuid().ToString() + [guid]::NewGuid().ToString()
```

## 5) Install and run

In PowerShell from the project folder:

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

- If DB health fails: ensure the Windows service "MongoDB Server" is running.
- Firewall: allow inbound connections on TCP 27017 (local only) and 3001 if needed.
- Port conflicts: change PORT in .env.local or stop the conflicting app.
- JWT_SECRET length must be ≥ 32 characters.
