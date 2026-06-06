# DispatchSky-Labs

Static Sadiom site plus a standalone secure EDCT tracker served by `npm start` at `/edct`.

## Sadiom Flow

EDCT change alerts for watched flights. The browser route remains `/edct`.

```sh
cp .env.example .env
npm test
npm start
```

Open `http://localhost:3000/edct` locally. Production serves the frontend at `https://sadiom.com/edct` and the API at `https://api.sadiom.com/api/...`.

For the split production deployment, host the static page at `https://sadiom.com/edct` and host the Node API separately on Railway behind the custom domain `https://api.sadiom.com`.

GitHub Pages for `sadiom.com` serves this repository root. The public EDCT page must therefore exist at `edct/index.html` with sibling `edct/app.js`, `edct/styles.css`, and `edct/config.js`.

### Security Model

- The browser never calls the EDCT source and never receives source endpoints, query patterns, credentials, headers, tokens, cookies, or upstream URLs.
- EDCT source config is server-only environment configuration in `.env`; do not expose it through `NEXT_PUBLIC_*`, static files, logs, API responses, or error messages.
- Frontend APIs return normalized app data only: sessions, flights, EDCT states/events, status, and notification messages.
- Anonymous identity is stored in an `httpOnly; Secure` cookie. Same-origin requests use `SameSite=Lax`; approved cross-origin Railway API requests use `SameSite=None`.
- Flight entry, refresh, notification polling, session updates, and general API activity are rate limited.
- The server emits a strict Content Security Policy and baseline security headers.
- No corporate credentials, SSO, browser extensions, or company authentication are collected or required.

### Usage Tracking

The app quietly tracks operational usage: anonymous session creation/last seen, optional label, approximate user agent, IP hash, flights added/edited/deleted, hubs monitored, manual refresh clicks, notification permission state, EDCT events, page/session loads, and API activity counts. Raw IP addresses are not stored.

Protected usage summary:

```sh
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/api/admin/summary
```

The admin response summarizes sessions and usage patterns without source secrets.

### EDCT Workflow

Users enter a callsign and destination. The backend normalizes the callsign and airport, fetches the destination airport feed server-side, matches source records by exact normalized callsign and destination, compares watched flights against persisted state, writes EDCT history, and creates notification events from persisted EDCT events only.

EDCT source polling runs server-side. Browser polling is limited to Sadiom APIs and notification delivery checks.

### Persistence

The standalone app uses `EDCT_DB_FILE` as a file-backed database with table names matching `migrations/001_edct_schema.sql`. Move the same schema to SQL for production scale.

## Railway Backend Deployment

Railway can run the backend directly with the package start command:

```sh
npm start
```

The server listens on `process.env.PORT`, which Railway provides automatically.

Required Railway variables:

- `EDCT_SOURCE_URL`: server-only source URL. Do not expose it in frontend files.
- `EDCT_SOURCE_TOKEN`: server-only source token, if required by the upstream source.
- `EDCT_SOURCE_METHOD`: `GET` or `POST`.
- `EDCT_SOURCE_TIMEOUT_MS`: optional, default `10000`.
- `EDCT_AIRPORT_CACHE_TTL_SECONDS`: optional server-side airport feed cache TTL, default `60`.
- `EDCT_POLL_INTERVAL_MINUTES`: optional, clamped to 1-30.
- `EDCT_IDLE_SLEEP_MINUTES`: optional inactivity threshold for stopping scheduled polling, default `30`.
- `EDCT_ACTIVE_SESSION_THRESHOLD_SECONDS`: optional admin active-session threshold based on recent heartbeat/API activity, default `180`.
- `EDCT_MONITORED_DESTINATIONS`: optional comma-separated default destinations.
- `EDCT_ALLOWED_ORIGINS`: exact browser origins allowed to call the Railway API. Production should include `https://sadiom.com`; local dev can include `http://localhost:3000` or another local origin.
- `ADMIN_TOKEN`: required for `GET /api/admin/summary` and `GET /api/admin/usage`.
- `EDCT_DB_FILE`: required for the standalone file-backed store. On Railway, point this at a mounted volume path for persistence. Without a volume, file storage is ephemeral.

No `SESSION_SECRET` is currently used because anonymous session IDs are random opaque identifiers stored server-side and in an httpOnly cookie.

Admin analytics enrich anonymous sessions only from server-observed request data. The browser does not call any IP, geo, ASN, analytics, or tracking provider. If the hosting edge provides coarse headers such as country, region, city, timezone, ASN, or organization, the backend stores those sanitized values for the protected owner dashboard. Exact IP addresses are not stored by this implementation; only a short hash is retained.

## Static Frontend API Base

The static frontend uses a non-secret API base value in `edct/config.js`:

```js
window.EDCT_API_BASE_URL = "https://api.sadiom.com";
```

Do not include `/api` in this value; the app adds `/api/...` paths itself.

This value is intentionally browser-visible and must contain only the Sadiom/Railway backend origin. It must never contain the EDCT source endpoint, source query pattern, token, credentials, headers, or cookies.

For local same-origin development, temporarily set `window.EDCT_API_BASE_URL = ""` and run the Node server locally.

## CORS And CSP

The backend uses exact-origin CORS. It does not use wildcard CORS. Production should set:

```sh
EDCT_ALLOWED_ORIGINS=https://sadiom.com
```

Add local origins only while testing.

The static page includes a restrictive CSP with `connect-src 'self' https://api.sadiom.com`.

## Expected Live URLs

- Frontend: `https://sadiom.com/edct`
- Backend API: `https://api.sadiom.com/api/...`

## Deployment Checklist

1. Deploy the backend service to Railway with `npm start`.
2. Add Railway environment variables from `.env.example`, using real server-side values only in Railway.
3. Add the custom domain `api.sadiom.com` in Railway for the backend service.
4. Add the DNS CNAME for `api.sadiom.com` to the Railway-provided target.
5. Confirm `edct/config.js` contains `window.EDCT_API_BASE_URL = "https://api.sadiom.com";`.
6. Confirm the GitHub Pages root files exist at `edct/index.html`, `edct/app.js`, `edct/styles.css`, and `edct/config.js`.
7. Deploy the static frontend to `https://sadiom.com/edct`.
8. Open the browser network panel and verify only static Sadiom assets plus `https://api.sadiom.com/api/...` calls are visible.

## Browser Network Checklist

In browser dev tools for `https://sadiom.com/edct`, visible requests should be limited to:

- Static frontend files from `https://sadiom.com/edct/...`
- API calls to `https://api.sadiom.com/api/...`.

Expected API calls:

- `GET /api/session`
- `GET /api/flights`
- `POST /api/flights`
- `PATCH /api/flights/:id`
- `DELETE /api/flights/:id`
- `GET /api/edct/status`
- `POST /api/edct/refresh`
- `GET /api/edct/events`
- `GET /api/edct/flights/:id/events`
- `GET /api/notifications/pending`
- `POST /api/notifications/mark-delivered`
- `POST /api/session/label`
- `GET /api/health`

There should be no browser-visible FAA/source requests, source tokens, source query strings, third-party scripts, analytics, CDNs, external fonts, source maps, or public admin page requests.
