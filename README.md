# Seatix Waitlist API

Simple waiting-list API demonstrating Node.js + Express, Redis (cache), and SQLite (persistence). Everything is containerized with Docker.

Quick start (without Docker):

1. Install dependencies

```bash
npm install
```

2. Initialize DB

```bash
npm run init-db
```

3. Start app

```bash
npm start
```

With Docker (recommended):

```bash
docker compose up --build
```

API endpoints
- `GET /waitlist` — list entries
- `POST /waitlist` — add entry (JSON {"name":"...","email":"..."})
- `DELETE /waitlist/:id` — remove entry

Files of interest:
- `src/index.js` — app entry
- `src/routes/waitlist.js` — API handlers
- `src/db/sqlite.js` — SQLite helper
- `src/cache/redis.js` — Redis helper
