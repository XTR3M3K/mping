# mping-agent

A standalone collector daemon. It pulls its target list from the central mping
server, runs ICMP ping + traceroute locally, and pushes results back over HTTPS.

## Run (Node)

```bash
MPING_SERVER=https://mping.example.com \
MPING_TOKEN=<collector-token-from-ui> \
MPING_NAME=hetzner \
pnpm --filter @mping/agent start
# or with flags:
pnpm --filter @mping/agent start -- --server https://mping.example.com --token TOKEN --name hetzner
```

Create the collector + token in the web UI (Settings → Collectors), then start the
agent with that token. The `--name` must match the collector name you created.

## Requirements

- `ping` (iputils) — present on virtually every Linux box.
- `mtr` (preferred) or `traceroute` for route tracing. `mtr` gives per-hop loss.
  `mtr` needs raw-socket capability: it's usually setuid, or grant it with
  `setcap cap_net_raw+ep $(which mtr)`.

## Docker

```bash
docker run -d --name mping-hetzner --restart unless-stopped \
  --cap-add NET_RAW \
  -e MPING_SERVER=https://mping.example.com \
  -e MPING_TOKEN=... -e MPING_NAME=hetzner \
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
Environment=MPING_NAME=hetzner
ExecStart=/usr/bin/node --import tsx /opt/mping/packages/agent/src/index.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```
