# Operations — running Pre-Mortem Dispatch

This is the runbook for the deployable shape of the app: one FastAPI process, one nginx container,
and a SQLite database on a persistent volume. It is deliberately single-node.

## Topology

```
browser ──▶ nginx :80 ──▶ /            SPA (dist)
                       └─▶ /api/      FastAPI :8000 (internal)
                                         └─▶ /app/state/app.db  (pmd-state volume)
```

`docker compose up --build` exposes the UI on `http://localhost:5173` and binds the API to
`127.0.0.1:8000` for local docs and debugging. Only nginx is intended to be public. Terminate
TLS at your load balancer or a reverse proxy in front of the web container.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./data/app.db` (dev) | SQLite path. Compose uses `sqlite:////app/state/app.db`. |
| `CORS_ORIGINS` | localhost dev origins | Comma-separated origins. Same-origin deployments through nginx do not need CORS. |
| `SOLVER` | `greedy` | `greedy`, `ortools`, or `auto`. OR-Tools is optional. |
| `MAX_UPLOAD_BYTES` | `5242880` | Per-CSV upload cap. nginx allows 32 MB total for six files. |
| `API_TOKEN` | empty | Shared operator token. Empty keeps the open demo. |
| `ALLOWED_HOSTS` | empty | Comma-separated Host allow-list. Empty disables host filtering. Include `localhost` if the container healthcheck probes the API directly. |
| `DOCS_ENABLED` | `true` | Set `false` to remove `/docs`, `/redoc`, `/openapi.json`. |
| `SECURITY_HEADERS` | `true` | Set `false` only if an upstream already sets them. |
| `LOG_LEVEL` | `INFO` | Access-log level for `app.access`. |
| `APP_VERSION` | `1.0.0` | Reported by `/health` and the OpenAPI document. |

## Access gate

Set `API_TOKEN` to require a token on every `/api/v1` route except:

- `GET /api/v1/health`, `/health/live`, `/health/ready`
- `GET /api/v1/auth/status` (public discovery for the login page)

Clients may send either `Authorization: Bearer <token>` or `X-API-Key: <token>`. The API compares
with `secrets.compare_digest`, returns the standard error envelope with `code: "unauthorized"`, and
adds `WWW-Authenticate: Bearer`.

The `/login` page discovers the requirement from `/auth/status`, verifies the candidate against
`/auth/check`, stores it in `sessionStorage` and sends it on every request. Closing the tab clears
it. This is a shared deployment gate — **not** accounts, roles or an audit trail.

Rotation: change `API_TOKEN`, restart the API, and re-enter the new value in each open tab.
There is no per-user revocation. If a stale token is rejected, the console clears it and returns
to `/login?reason=expired` rather than looping on 401 responses.

## Health and orchestration

| Endpoint | Checks | Failure behaviour |
|---|---|---|
| `/api/v1/health/live` | process only | stays `200` if the database is down |
| `/api/v1/health/ready` | SQLite `SELECT 1` | `503` with `db: "error"` |
| `/api/v1/health` | same body as ready | `200` with `status: "degraded"` so the UI can render it |

Compose uses `/health/ready` for the API healthcheck and starts the web container only after it
passes. Use the same endpoint for Kubernetes readiness probes and `/health/live` for liveness.

## Data, backup and restore

The named volume `pmd-state` holds `/app/state/app.db` (plus WAL files while running). Bundled
sample CSVs stay in the image at `/app/data` and are not shadowed by the volume.

Because SQLite runs in WAL mode, copy the database through SQLite's backup API rather than copying
the file mid-write:

```bash
docker compose exec api python -c "
import sqlite3
src = sqlite3.connect('/app/state/app.db')
dst = sqlite3.connect('/app/state/backup.db')
src.backup(dst)
dst.close(); src.close()
"
mkdir -p backups
docker compose cp api:/app/state/backup.db ./backups/app-$(date +%Y%m%d-%H%M%S).db
docker compose exec api rm /app/state/backup.db
```

Restore into a stopped deployment:

```bash
docker compose stop api
docker compose cp ./backups/app-YYYYmmdd-HHMMSS.db api:/app/state/app.db
docker compose start api
```

`docker compose down` keeps the volume; `docker compose down -v` deletes the database.

## Limits and failure modes

- **One API worker.** SQLite permits one writer; WAL lets readers proceed, and the repository uses a
  5 s busy timeout. Do not run multiple API replicas against the same database file.
- **Horizontal scale is not implemented.** Postgres is on the roadmap; the repository interface is
  the seam, not a drop-in switch.
- **Rate limiting is at the edge.** nginx allows 20 requests/second per IP with burst 40. If you put
  another proxy in front, `$binary_remote_addr` will be that proxy unless you configure real-IP
  handling deliberately.
- **Solver time.** `/plans` and scenario re-solves are synchronous. nginx allows 120 s, but a very
  large network should move solving to a job queue rather than raising that timeout.
- **Advisory cost.** Baseline resilience reads one stored plan and its dataset. A scenario brief
  performs one disrupted solve plus up to six isolated mitigation solves on demand. It stores no
  results; the console makes the advisory opt-in so listing scenarios remains cheap.
- **Docs exposure.** Leave `DOCS_ENABLED=false` in public deployments unless you intend to publish
  the OpenAPI schema.

## Incident triage

Every response returns `X-Request-ID`; error envelopes repeat it as `request_id`. The API access log
line contains the same id:

```
2026-11-02 20:30:43,360 INFO app.access GET /api/v1/scenarios/ 200 8.2ms [ed6d2e418320]
```

nginx forwards its own `$request_id` as `X-Request-ID` for proxied calls, so a browser report and a
server line can be matched. Start with:

```bash
docker compose logs -f api
curl -s http://127.0.0.1:8000/api/v1/health/ready | python -m json.tool
```

## Release checklist

1. Activate `apps/api/.venv`, then run `scripts/ci.sh` — dependency audits, backend tests, frontend
   typecheck/build, browser workflow and container builds (when Docker is available)
2. Optionally enable the GitHub Actions workflow from
   [`github-actions-ci.yml`](github-actions-ci.yml) at `.github/workflows/ci.yml` using a credential
   with the required `workflow` scope
3. Set `API_TOKEN`, `ALLOWED_HOSTS`, `DOCS_ENABLED=false`, and real CORS origins as needed
4. Back up the volume before upgrading
5. Probe `/health/ready` after rollout and confirm an `X-Request-ID` appears in logs
