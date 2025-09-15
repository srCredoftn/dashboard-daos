# Backend

Un seul backend est supporté: `backend-express/` (Express + MongoDB via Mongoose). Aucune alternative n’est requise.

## Caractéristiques

- Express + TypeScript, intégré au dev server Vite
- MongoDB obligatoire (pas de fallback mémoire)
- Authentification JWT, sessions, rate limiting, Helmet
- API REST: DAOs, utilisateurs, commentaires, notifications

## Configuration

Variables clés (.env ou variables d’environnement):

```
PORT=3001
FRONTEND_URL=http://localhost:8080
MONGODB_URI=mongodb://localhost:27017/dao-management
JWT_SECRET=... (≥32 chars)
FORCE_DB_ONLY=1
```

## Lancer en local

```
pnpm install
pnpm dev
```

- Backend: http://localhost:3001
- Frontend: http://localhost:8080

## Santé

- API: GET /api/health
- DB: GET /api/health/db (ok:true => Mongo connecté)
