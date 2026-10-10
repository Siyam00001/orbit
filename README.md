# 🪐 Orbit

A personal life dashboard built for lazy people: everything is one tap (or one key).

- **Your world** — a planet that mirrors your week: habits turn it green, streak days become moons,
  garden photos grow trees, overdoing nicotine adds smog, city lights spread as you level up
- **Weekly boss fight** — job-hunt DMs, applications and replies deal damage to a new boss every Monday
- **Craving SOS** — 3-minute guided breathing to ride out a Velo craving
- **Daily side quest**, **time capsule** letters that stay locked until their date, **weekly recap** stories
- Habits checklist, Velo counter, money runway, consistency heatmap, garden photo timelapse
- XP and levels, synth sound effects, confetti, a sky that follows the real time and weather

**Stack:** React 18 + TypeScript (Vite) · Node 22 + Express 5 · SQLite (`node:sqlite`, zero native deps) · Open-Meteo weather

## Run

Double-click `Orbit.cmd`, or:

```bash
npm install
npm start          # http://localhost:4321
```

```bash
npm run check      # logic self-test (dates, streaks, runway, boss, XP, recap)
npm run typecheck
```

Keyboard: `1–6` habits · `V` Velo · `D/A/R` DM/application/reply · `Q` quest · `W` week recap · `M` mute · `?` help

## How it works

- `server.js` — one process: REST API + Vite middleware serving the UI. Binds to `127.0.0.1` only.
- `data/` — `orbit.db` and garden photos (gitignored). `ORBIT_DATA=/path` points it elsewhere.
- `src/logic.ts` — pure functions (streaks, runway, boss, world, XP, recap) shared by UI and tests.

| Endpoint | |
|---|---|
| `GET /api/days`, `PATCH /api/days/:date` | habits, mood, quest per day (JSON merge-patch) |
| `POST /api/days/:date/bump` | atomic `{key, by}` counter increment |
| `GET/POST /api/photos`, `DELETE /api/photos/:id` | garden photos (raw image body) |
| `GET/POST /api/capsules`, `DELETE /api/capsules/:id` | letters — text withheld until the open date |
| `GET/PATCH /api/settings` | name, city, starting cash, Velo limit, notes |
| `GET /api/weather` | today's weather for your city (cached 30 min) |
