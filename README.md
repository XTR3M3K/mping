# mping

A smokeping-style network latency monitor — a Node.js + React reimagining of
[SmokePing](https://github.com/oetiker/SmokePing) with **multiple collectors**, **Discord
alerts**, and **traceroute change history**.

![dark](https://img.shields.io/badge/theme-dark-7c5cff) ![node](https://img.shields.io/badge/node-%E2%89%A520-green)

## What it does

- **Smoke charts** — latency distribution drawn as nested percentile bands, with the
  median line coloured by packet loss. Custom retina Canvas renderer.
- **Multiple collectors** — run lightweight agents on as many boxes as you like
  (`kat01a`, `hetzner`, …). Each probe's detail page shows **per-collector charts**
  side-by-side (grid) or **overlaid** on one axis.
- **Discord alerts (ping probes)** — pretty embeds when a probe's **median latency**
  or **packet loss** crosses a per-probe threshold (🔴 firing / 🟢 recovered), with a
  debounced state machine so it doesn't flap.
- **Traceroute history** — agents trace the path; when the route changes a new
  history entry is stored and a Discord embed shows the **before/after hop diff**.
  The UI has a per-collector traceroute tab with an expandable change timeline.
- **Polished, responsive, dark** — works on desktop and phone, live-updating over
  WebSocket.

## Architecture

```
  agent (ovh) ─┐
  agent (hetzner)─┼─ HTTPS + token ─►  server (Fastify) ─►  Postgres + TimescaleDB
  agent (…)      ─┘   push samples       │ alert engine      (hypertables + caggs)
                      + traceroutes       │ discord webhooks
                                          ▼
                              React SPA (served by the server)
```

- Agents are **stateless about config**: they pull their target list from the server,
  probe locally, and push results. Configure probes once in the UI; every agent picks
  them up.
- The server owns **storage, alerting, Discord delivery, auth**, serves the SPA, and
  broadcasts a **live WebSocket** feed.
- Per-`(target × collector)` evaluation — each location has its own path, so thresholds
  and route diffs are tracked independently per collector.

Packages (pnpm workspace, TypeScript throughout):

| package | what |
|---|---|
| `@mping/shared` | zod schemas + types + stats/percentile/route helpers (browser-safe) |
| `@mping/server` | Fastify API, TimescaleDB, alert engine, Discord, serves the SPA |
| `@mping/agent`  | collector daemon — shells out to `ping` + `mtr`/`traceroute` |
| `@mping/web`    | Vite + React + Tailwind dark UI, Canvas smoke charts |

## Quick start (dev)

```bash
pnpm install
docker compose up -d db          # TimescaleDB on :5432
cp .env.example .env             # adjust if needed

# Terminal 1 — API (runs migrations on boot, serves on :4420)
pnpm dev:server

# Terminal 2 — Vite dev server with HMR on :5173 (proxies /api to :4420)
pnpm dev:web
```

Open http://localhost:5173 and log in with `ADMIN_PASSWORD` (default `admin`).

Then:
1. **Settings → Collectors → Create** a collector (e.g. `kat01a`). Copy its token.
2. **Settings → Probes → Add** a probe (e.g. `1.1.1.1`), set a latency threshold.
3. Run an agent:

```bash
pnpm dev:agent -- --server http://localhost:4420 --token <TOKEN> --name kat01a
```

Charts start filling within a probe cycle. Add more agents with different `--name`
to see multi-collector views.

## Production — one command

```bash
cp .env.example .env             # set SESSION_SECRET, ADMIN_PASSWORD, PUBLIC_URL, COLLECTOR_TOKEN
docker compose up -d --build
```

This brings up the **whole stack**: TimescaleDB + the server (which builds and serves
the SPA) + a **bundled local collector**. The server auto-creates a collector named
`COLLECTOR_NAME` with `COLLECTOR_TOKEN`, and the `agent` service connects to it — so
charts start filling as soon as you add a probe in the UI. No manual token step.

The server serves the SPA at `/` and the API under `/api`. Put it behind a TLS reverse
proxy and set `PUBLIC_URL` so Discord embed links point at it. **Change `COLLECTOR_TOKEN`
and `SESSION_SECRET`** for any real deployment.

To add **more collectors** on other machines, create a collector in the UI (Settings →
Collectors) and run `packages/agent` there with its token — see
[`packages/agent/README.md`](packages/agent/README.md) for Docker and systemd examples.
Agents need `ping` (always present) and `mtr` or `traceroute` (`mtr` gives per-hop loss;
grant it `cap_net_raw` if unprivileged).

## Container images (CI)

GitHub Actions ([`.github/workflows/docker.yml`](.github/workflows/docker.yml)) builds
and pushes a multi-arch (amd64 + arm64) image per component to GHCR on every push to
the default branch and on `v*` tags:

- `ghcr.io/<owner>/mping-server` — API + bundled SPA
- `ghcr.io/<owner>/mping-agent` — collector daemon

Pull requests build the images (for validation) without pushing. Tags follow the git
ref: `latest` on the default branch, `sha-<short>`, and semver (`1.2.3`, `1.2`) on `v*`
tags. To deploy from published images instead of building locally, point the compose
`server`/`agent` services at the `image:` refs above.

## Configuration

Server env (`.env`):

| var | default | purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://mping:mping@localhost:5432/mping` | TimescaleDB connection |
| `PORT` / `HOST` | `4420` / `0.0.0.0` | bind address |
| `PUBLIC_URL` | `http://localhost:4420` | base URL for Discord embed links |
| `SESSION_SECRET` | — | cookie signing secret (≥ 32 chars) |
| `ADMIN_PASSWORD` | `admin` | seeds the UI password on first boot |

Discord webhook + default thresholds + alert debounce are set in **Settings**;
per-probe thresholds and webhook overrides are set on each probe.

## Data & retention

Raw samples live in a TimescaleDB hypertable (30-day retention by default).
`samples_5m` / `samples_1h` continuous aggregates roll up the percentile bands so
long-range charts stay fast — the series API auto-selects resolution by zoom range.

## Verification

The full flow is verified end-to-end: collector + token, probe config propagation,
sample ingest (with percentile-band computation), series across raw/5m/1h resolutions,
traceroute change detection + history, the debounced latency/loss alert state machine,
WebSocket live updates, SPA serving, and the auth guard.

```bash
pnpm -r typecheck && pnpm --filter @mping/web build
```
