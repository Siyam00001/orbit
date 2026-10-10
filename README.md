# 🪐 Orbit

A personal life dashboard: daily habits, job-hunt pipeline, money runway, body tracking,
a weather-aware garden, and an XP/level system that rewards showing up.

**Stack:** React 18 + TypeScript (Vite) · Node 22 + Express 5 · SQLite (`node:sqlite`, zero native deps) · Open-Meteo weather

## Run

Double-click `Orbit.cmd`, or:

```bash
npm install
npm start          # http://localhost:4321
```

```bash
npm run check      # logic self-test (dates, streaks, runway, XP)
npm run typecheck
```

## How it works

- `server.js` — one process: REST API + Vite middleware serving the UI. Binds to `127.0.0.1` only.
- `data/orbit.db` — all your data (gitignored). Back it up by copying the file.
- `src/logic.ts` — pure functions (streaks, runway, thirst, XP) shared by UI and tests.

| Endpoint | |
|---|---|
| `GET/POST /api/items/:kind` | `jobs`, `money`, `body`, `plants` |
| `PATCH/DELETE /api/items/:kind/:id` | JSON merge-patch update |
| `GET /api/days`, `PATCH /api/days/:date` | habits, mood, velo per day |
| `GET/PATCH /api/settings` | name, city, starting cash, limits, notes |
| `GET /api/weather` | today's weather for your city (cached 30 min) |
