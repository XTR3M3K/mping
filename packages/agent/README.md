# mping-agent

A standalone collector daemon. It pulls its target list from the central mping
server, probes locally — ICMP ping, TCP handshake, HTTP/HTTPS request, plus
traceroute — and pushes results back over HTTPS.

## Run (Node)

```bash
MPING_SERVER=https://mping.example.com \
MPING_TOKEN=<collector-token-from-ui> \
MPING_NAME=location-a \
pnpm --filter @mping/agent start
# or with flags:
pnpm --filter @mping/agent start -- --server https://mping.example.com --token TOKEN --name location-a
```

Create the collector + token in the web UI (Settings → Collectors), then start the
agent with that token. The `--name` must match the collector name you created.

## Tuning

| var | default | purpose |
|---|---|---|
| `MPING_CONFIG_REFRESH_SEC` | `30` | how often the target list is re-pulled |
| `MPING_COMMAND_POLL_SEC` | `5` | how often to claim "traceroute now" requests from the UI |
| `MPING_MAX_CONCURRENT_PROBES` | `32` | probe cycles allowed to run at once |
| `MPING_MAX_CONCURRENT_TRACEROUTES` | `4` | traceroutes allowed to run at once |

Probe cycles are scheduled on absolute ticks with a jittered start, so a slow
target never pushes the next cycle back and a large target list doesn't fire in
one burst.

## Requirements

- `ping` (iputils) — present on virtually every Linux box. Only ICMP probes need
  it; TCP/HTTP probes use plain sockets.
- `mtr` (preferred) or `traceroute` for route tracing. `mtr` gives per-hop loss.
  `mtr` needs raw-socket capability: it's usually setuid, or grant it with
  `setcap cap_net_raw+ep $(which mtr)`.
- Outbound DNS for hop annotation: reverse lookups, plus TXT queries against
  Team Cymru's `origin.asn.cymru.com` / `asn.cymru.com` zones for the origin AS.
  A resolver that blocks them just leaves the ASN column empty.

## Docker

```bash
docker run -d --name mping-location-a --restart unless-stopped \
  --cap-add NET_RAW \
  -e MPING_SERVER=https://mping.example.com \
  -e MPING_TOKEN=... -e MPING_NAME=location-a \
  ghcr.io/you/mping-agent:latest
```

## systemd

```ini
[Unit]
Description=mping collector agent
After=network-online.target

[Service]
Environment=MPING_SERVER=https://mping.example.com
Environment=MPING_TOKEN=...
Environment=MPING_NAME=location-a
ExecStart=/usr/bin/node --import tsx /opt/mping/packages/agent/src/index.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```
