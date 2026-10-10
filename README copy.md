# Pudi Local — advanced implementation

PostgreSQL/PostGIS SQL, async FastAPI radius search and participant-authorized chat, plus a runnable React/Tailwind/Mapbox PWA frontend.

## Database layer

Run `database/001_schema.sql` once as a migration administrator with PostGIS installation permission. It creates users, hashed sessions, livestock listings, conversation participants, durable messages and a chat relay outbox. This is a fresh-schema migration; adapt it through your existing migration system if those tables already exist. Do not rerun it against a migrated schema.

Run `database/002_runtime_privileges.sql` once as a DBA and grant its `pudi_api` group role to your API's PostgreSQL login role. Keep account verification and session creation under separate trusted service credentials. API credentials do not receive permission to verify users or edit listings. Use a separate administrator DSN for migrations, not the runtime DSN.

`database/search_50km.sql` is the exact parameterized 50km query: $1 longitude, $2 latitude. `backend/search.sql` adds purpose/category/verification filtering and signed keyset pagination. `location geometry(Point,4326)` stores WGS84 coordinates in degrees. Radius queries cast to geography for metre-based geodesic distances and use the matching active-listing geography expression GiST index. The ordinary geometry GiST index also exists as requested; it cannot accelerate the geography cast by itself.

After imports run `ANALYZE livestock_listings`. Verify the spatial index with representative `EXPLAIN (ANALYZE, BUFFERS)` queries. On a populated production table, build indexes with `CREATE INDEX CONCURRENTLY` outside a transaction rather than running the bootstrap migration. Spatial indexing narrows radius candidates; exact distance ordering still sorts those candidates. Do not replace exact nearest ordering with geography KNN sphere ordering without considering the accuracy difference.

`purpose` is a nonempty enum array: `breeding`, `slaughter`, `ceremonial`, `lobola`. `is_verified_seller` is mirrored by triggers from `app_users.seller_verified_at`; the API reads the user record authoritatively. Identity verification is not proof of animal ownership or health. Do not accept this flag from listing-creation payloads.

Discovery returns a snapped approximate display point, not the precise geometry. Distance/radius searches can still reveal location information across repeated queries; apply rate limiting and a deliberate location-disclosure policy if exact farm privacy is required.

## Backend API

From this project root:

```sh
python -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
cp backend/.env.example .env
```

Set DATABASE_URL, REDIS_URL, exact ALLOWED_ORIGINS and a cryptographically random CURSOR_SIGNING_KEY in `.env`. Runtime PostgreSQL/Redis must use restricted credentials and TLS in production. Keep `.env` out of source control. `backend/requirements-lock.txt` reproduces the complete tested Python environment, including development test dependencies.

Apply migrations with your administrator connection, then start:

```sh
.venv/bin/uvicorn backend.main:create_app --factory --host 127.0.0.1 --port 8000 --workers 2 --ws-max-size 8192
```

Development: use one worker with `--reload`. Each worker owns a maximum 10-connection PostgreSQL pool and a maximum 256-connection Redis pool, including Pub/Sub sockets; size the service accordingly. Apply perimeter request/connection limits. Application chat limits are 30 messages per user per fixed UTC minute, shared across workers through Redis.

### Search

`GET /api/listings/nearby?longitude=29.4689&latitude=-23.9045&radius_km=50&purpose=breeding&verified_only=true`

Returns `application/geo+json` FeatureCollection with typed Point features and `next_cursor`. Optional parameters: category, purpose, verified_only, limit (1–100), cursor. Coordinates/radius are validated, including non-finite numbers. Cursor signatures bind the radius/filters and expire after one hour. Listing changes between page requests can affect pagination; this is not a snapshot export.

Money is returned in integer ZAR cents. Precise private geometry is excluded. API responses use `Cache-Control: no-store`.

### Authentication and chat

Connect your existing trusted login service to `backend/sessions.py:issue_authenticated_session` after it authenticates the account. It persists only the SHA-256 hash of a random opaque token and issues a secure HttpOnly cookie. The login service uses separate session-write credentials. No endpoint accepts a user ID as authentication. If your existing identity provider uses JWTs, replace the session lookup dependency with actual issuer/audience/signature verification; do not bypass participant checks.

Production cookie: `__Host-pudi_session; HttpOnly; Secure; SameSite=Lax; Path=/`, with no Domain. Local HTTP development only: configure both login and API to use `pudi_session` with secure=False. Cookie-authenticated mutations require an exact allowed Origin. REST may also use a Bearer session token. Browser WebSockets use the HttpOnly cookie, never a URL token.

1. Authenticated buyer calls `POST /api/conversations` with `{ "listing_id": "<actual listing UUID>" }`. Seller identity comes from the listing, and the buyer identity comes from the session. A buyer cannot open a negotiation on their own listing. The response contains the conversation ID and current user ID.
2. Buyer and farmer connect to `wss://your-origin/api/ws/conversations/{conversation_id}`. Origin, session expiry/revocation, disabled account status and participant membership are checked. Membership/session is rechecked on incoming/outgoing messages and at most every 30 seconds while idle.
3. Client sends `{ "type":"message", "client_message_id":"<fresh UUID>", "body":"your negotiation text" }`. Senders cannot supply sender_id. Message text is 1–2000 characters; raw frame size is bounded. `client_message_id` provides idempotent retries. The same ID cannot be reused with different text.
4. Each message and relay outbox row commit atomically. Redis relays messages across workers. Relay jobs are retried, using `FOR UPDATE SKIP LOCKED`. Outbox replays may duplicate events; clients deduplicate message IDs. Acknowledgement means stored, not delivered/read. Redis Pub/Sub alone is not durable.
5. `GET /api/conversations/{id}/messages` returns the latest 100 messages. `before_id` loads older pages; `after_id` retrieves missed committed messages in increasing ID order. These IDs are strings in JSON to avoid JavaScript bigint precision loss. The API serializes room inserts before allocating identity IDs; preserve this invariant in any other writer.

The included ChatPanel polls history every 20 seconds and catches up after reconnects; its history cursor is independent of Pub/Sub arrival order. It preserves drafts and requires a manual retry with the same UUID if an acknowledgement was lost. Messages are not queued by the service worker. No payment or agreement-finalization workflow is implied. Add retention/archival for delivered outbox rows and chat history according to your product requirements.

## Frontend components

```sh
cd frontend
npm ci
cp .env.example .env
```

Set VITE_MAPBOX_ACCESS_TOKEN to your Mapbox public `pk.` token, restricted to your site URLs. Never expose a secret `sk.` token. Then `npm run dev` or `npm run build`. The development server proxies `/api` and WebSockets to 127.0.0.1:8000. Production should serve the built frontend and proxy `/api` to FastAPI under the same HTTPS origin so secure cookies work reliably.

- `LivestockMap.tsx`: react-map-gl/mapbox, custom earthy vector-tile style, accessible flat SVG pin buttons, popup selection, map error fallback. Closest 200 loaded pins are displayed to bound DOM cost; all loaded cards remain available.
- `earthyStyle.ts`: custom Mapbox style JSON, Mapbox Streets v8 sources, dark forest/terracotta/paper palette. Attribution remains enabled.
- `useNearbyListings.ts`: abortable/time-limited searches, retry, filter reset and signed-cursor page appending.
- `LivestockCard.tsx` and `LivestockCardSkeleton.tsx`: shared CardFrame, identical 4:3 image and content dimensions, polite loading announcement and reduced-motion-safe shimmer.
- `ChatPanel.tsx`: conversation creation, cookies, WSS reconnect, history recovery, deduplication and explicit retry.
- `App.tsx`: working discovery surface, filters, coordinate form, loaded result list and accessible native listing dialog.

Coordinates are developer-facing inputs in this integration harness. Replace them with your existing town/geocoder picker in the customer-facing Site while retaining SearchParams and the server query contract.

## Offline/PWA configuration

Serve over HTTPS (localhost is supported for development). The manifest includes actual 192px/512px and maskable PNG icons. Vite generates `precache-manifest.js` from the real hashed build outputs, including lazy Mapbox JS. `public/sw.js` uses that manifest to cache the app shell. Register only in production builds; do not cache Vite's development modules.

The service worker does not cache `/api`, requests with Authorization, POSTs, chat, third-party photos, or Mapbox tiles/glyphs/styles. Navigation is network-first with a 4.5-second timeout, falling back to cached index.html. Cache activation deletes only older `pudi-shell-*` caches and waits for existing tabs to close before activating an update. The app shell is available offline after at least one successful online installation. Live searches and messages remain online-only; no stale availability is represented as current. A device may evict offline cache; offline availability is not permanent storage. Mapbox offline basemap support is a separate capability, not provided by this web app-shell cache.

Deploy `dist` intact. Serve `/sw.js` and `/precache-manifest.js` with revalidation/no-cache; serve hashed `/assets/*` with long-lived immutable caching; route non-API SPA navigation to index.html. Preserve HTTP Upgrade for `/api/ws`. Mapbox GL JS needs WebGL and appropriate CSP permissions for its worker and Mapbox endpoints.

## Validation

Passed: Python module compilation; six backend tests covering request validation, signed cursor integrity, message bounds, GeoJSON contract/no-store, SQL syntax parsing and untrusted WebSocket Origin rejection; service-worker API/auth/POST/Mapbox exclusion and offline shell fallback; TypeScript and production Vite build including the lazy Mapbox bundle. Build validation used a nonfunctional test public token solely to include the Mapbox code path; no token is shipped in source.

Not run: live PostgreSQL/PostGIS migrations/query plans, Redis outbox/relay integration, authenticated two-party WebSocket tests, Mapbox rendering with your account, browser layout/accessibility checks, or installable-PWA testing. Syntax/mocked tests are not database integration tests. Complete these against your staging environment before production rollout.

Tests:

```sh
.venv/bin/pip install -r backend/requirements-dev.txt
.venv/bin/python -m unittest backend.test_core -v
cd frontend
node test-sw.mjs
npm run build
```

Primary documentation: https://postgis.net/docs/ST_DWithin.html ; https://www.postgresql.org/docs/current/indexes-expressional.html ; https://magicstack.github.io/asyncpg/current/usage.html ; https://fastapi.tiangolo.com/advanced/websockets/ ; https://redis.io/docs/latest/develop/pubsub/ ; https://visgl.github.io/react-map-gl/docs/api-reference/mapbox/map ; https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers
