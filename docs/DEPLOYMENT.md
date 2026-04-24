# Deployment Guide

## Overview

The OpenClaw Connector can run on any machine with Node.js access to both:
- Gateway B (main controller) - needs to reach it
- Multiple remote gateways (A, C, D...) - they need to reach it back

## Architecture for Deployment

```
┌─────────────────────────────────────┐
│   Connector Machine                 │
│  ┌───────────────────────────────┐  │
│  │ OpenClaw Connector Process    │  │
│  │ (Node.js + npm)               │  │
│  └───────────────────────────────┘  │
│             ↓    ↑ ↓    ↑            │
└─────────────┼────┼─┼────┼────────────┘
              │    │ │    │
    ┌─────────┘    │ │    └──────────────┐
    │              │ │                   │
┌───▼──────┐  ┌────▼─▼───┐  ┌─────────┐ │
│ Gateway B│  │ Gateway A │  │Gateway C│ │
│ (main)   │  │ (remote)  │  │(remote) │ │
└──────────┘  └──────────┘  └─────────┘ │
                                        │
         (Remote networks)
```

## Prerequisites

- Node.js 18+
- npm or yarn
- Network access:
  - From Connector → Gateway B (inbound WebSocket)
  - From Connector → Each remote gateway (outbound WebSocket)
  - From each remote gateway → Connector (outbound WebSocket for bidirectional comms)

## Installation

### 1. Clone/Download Connector

```bash
cd /opt/openclaw-connector  # or your deployment path
git clone <repo-url> .
# or unzip release package
```

### 2. Install Dependencies

```bash
npm ci  # Use npm ci for reproducible builds in production
```

### 3. Build

```bash
npm run build
```

The compiled code will be in `dist/` directory.

## Configuration

### 1. Create Configuration File

```bash
cp connector.config.example.json connector.config.json
```

### 2. Edit connector.config.json

```json
{
  "gatewayB": {
    "url": "wss://gateway-b.your-domain.com:18789",
    "token": "${GATEWAY_B_TOKEN}"
  },
  "commandPolicy": {
    "mode": "allow_all"
  },
  "breaker": {
    "enabled": true,
    "failureThreshold": 3,
    "openMs": 15000,
    "halfOpenMaxInFlight": 1
  },
  "remotes": [
    {
      "id": "machine-a",
      "url": "wss://machine-a.your-domain.com:18789",
      "token": "${GATEWAY_A_TOKEN}",
      "enabled": true,
      "timeoutMs": 30000
    },
    {
      "id": "office-server",
      "url": "wss://office.your-domain.com:18789",
      "token": "${GATEWAY_C_TOKEN}",
      "enabled": true,
      "timeoutMs": 30000
    }
  ]
}
```

### 3. Set Environment Variables

Create a `.env` file or use systemd EnvironmentFile:

```bash
export GATEWAY_B_TOKEN="your-gateway-b-token-here"
export GATEWAY_A_TOKEN="your-gateway-a-token-here"
export GATEWAY_C_TOKEN="your-gateway-c-token-here"
export CONNECTOR_STATE_DIR="/var/lib/openclaw-connector"
```

## Running the Connector

### Option 1: Direct Execution

```bash
npm start
```

Or with environment variables:

```bash
source .env
npm start
```

### Option 2: Systemd Service (Linux)

Create `/etc/systemd/system/openclaw-connector.service`:

```ini
[Unit]
Description=OpenClaw Connector
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=openclaw
Group=openclaw
WorkingDirectory=/opt/openclaw-connector
EnvironmentFile=/etc/openclaw-connector/.env
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/openclaw-connector

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable openclaw-connector
sudo systemctl start openclaw-connector
sudo systemctl status openclaw-connector
```

### Option 3: Docker

Create `Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY src ./src
COPY tsconfig.json ./
RUN npm run build

COPY connector.config.json ./

ENV NODE_ENV=production
CMD ["npm", "start"]
```

Build and run:

```bash
docker build -t openclaw-connector .
docker run -d \
  --name openclaw-connector \
  -e GATEWAY_B_TOKEN="..." \
  -e GATEWAY_A_TOKEN="..." \
  -v /var/lib/openclaw-connector:/app/.openclaw-connector \
  openclaw-connector
```

### Option 4: PM2

```bash
npm install -g pm2

pm2 start dist/index.js --name "openclaw-connector" \
  --env "$(cat .env | tr '\n' ' ')"

pm2 save
pm2 startup
```

## Initial Setup

After starting the connector:

### 1. Verify Connections

Check logs for success messages:

```bash
# If using systemd
journalctl -u openclaw-connector -f

# If running directly
tail -f connector.log | jq '.[] | select(.event | startswith("remote.") or startswith("node."))'
```

Look for:
- `remote.connect.success` - Remote gateway connected
- `node.connect.success` - Node registered to Gateway B
- `node.pair.pending` - Waiting for pairing approval

### 2. Approve Node Pairing (First Time Only)

On Gateway B machine:

```bash
# List pending pairing requests
openclaw nodes pending

# Should see something like:
# [pending] connector-machine-a  (from 192.168.1.100)
# [pending] connector-office-server (from 10.0.0.50)

# Approve each one
openclaw nodes approve --id <nodeId>
```

After approval, the connector should automatically transition nodes to connected state.

### 3. Test Invocation

On Gateway B:

```bash
# List all nodes (should see connector-* nodes)
openclaw nodes list

# Invoke a command
openclaw nodes invoke --node connector-machine-a --command sessions.list

# Check from logs
journalctl -u openclaw-connector | jq '.[] | select(.event=="invoke.success")'
```

## Monitoring

### Log Aggregation

The connector outputs structured JSON logs. Set up aggregation:

```bash
# Send logs to file
npm start >> /var/log/openclaw-connector.log 2>&1

# Or use systemd journal
journalctl -u openclaw-connector -f | jq '.meta'
```

### Key Metrics to Monitor

1. **Connection Status**: Look for `remote.connect.*` events
2. **Pairing Status**: Look for `node.pair.*` events
3. **Circuit Breaker State**: Look for `breaker.*` events
4. **Command Performance**: Look for `invoke.success` with `durationMs`
5. **Error Rate**: Look for `invoke.fail` with `errorCode`

### Alerting

Set up alerts for:

```bash
# Connection failures
jq 'select(.event=="remote.connect.fail")' /var/log/openclaw-connector.log

# Circuit breaker opened
jq 'select(.event=="breaker.open")' /var/log/openclaw-connector.log

# High error rate
jq 'select(.level=="ERROR")' /var/log/openclaw-connector.log
```

## Troubleshooting

### Connector won't start

```bash
# Check syntax
npm run typecheck

# Check config
npm run build && cat connector.config.json | jq .

# Verify environment variables
echo $GATEWAY_B_TOKEN
echo $GATEWAY_A_TOKEN
```

### "remote gateway not connected"

```bash
# Check network connectivity from Connector to remote
ping <remote-ip>
curl -i https://<remote-ip>:18789

# Check logs for connection errors
journalctl -u openclaw-connector | jq '.[] | select(.event=="remote.connect.fail")'

# Verify credentials
echo $GATEWAY_A_TOKEN | wc -c  # Should be >0
```

### "node not registered"

```bash
# Check if node pairing was approved
openclaw nodes list  # on Gateway B

# If not in list, approve:
openclaw nodes pending
openclaw nodes approve --id connector-machine-a

# Watch logs for state transition
journalctl -u openclaw-connector -f | jq '.[] | select(.nodeId)'
```

### "circuit breaker OPEN"

The remote is unhealthy. The breaker will automatically probe and recover after `openMs` (default 15s).

```bash
# Manually check remote gateway health
openclaw nodes invoke --node connector-machine-a --command gateway.status

# Check logs for specific failure
journalctl -u openclaw-connector | jq '.[] | select(.event=="breaker.open")'
```

## Updates

### Updating the Connector

```bash
# Pull latest code
git pull origin main

# Rebuild
npm run build

# If using systemd
sudo systemctl restart openclaw-connector

# If using PM2
pm2 restart openclaw-connector

# Verify
sudo systemctl status openclaw-connector
```

## Health Check Endpoint

Future version: Consider adding a simple HTTP health check endpoint for monitoring:

```bash
# curl http://localhost:9999/health
# Returns: { "status": "ok", "remotes": [...], "nodes": [...] }
```

## Backup & Recovery

### Configuration Backup

```bash
cp connector.config.json connector.config.backup.json
cp .env .env.backup
```

### Device Identity Backup

The device identities are stored locally in `~/.openclaw-connector/identity/`:

```bash
tar czf device-identities-backup.tar.gz ~/.openclaw-connector/identity/

# To restore:
tar xzf device-identities-backup.tar.gz -C ~/
```

Backing up device identities allows the connector to reconnect without re-pairing.

## Security Recommendations

1. **Credentials**: Never commit `.env` or `connector.config.json` to version control
2. **SSL/TLS**: Always use `wss://` for remote gateways
3. **Network**: Firewall the connector to only allow necessary connections
4. **Logs**: Logs contain event data but mask tokens/passwords automatically
5. **File Permissions**: Protect device identity files (`~/.openclaw-connector/identity/`)
6. **Process User**: Run connector as dedicated non-root user

## Performance Tuning

### High Latency Networks

Increase timeouts:

```json
{
  "remotes": [
    {
      "id": "remote-slow",
      "url": "...",
      "timeoutMs": 60000
    }
  ]
}
```

### High Load

Adjust circuit breaker:

```json
{
  "breaker": {
    "failureThreshold": 5,
    "openMs": 30000,
    "halfOpenMaxInFlight": 2
  }
}
```

### Many Remotes

Run multiple connector instances with different remote subsets to distribute load.

## Support & Debugging

### Collect Debug Info

```bash
# Logs
journalctl -u openclaw-connector -n 1000 > debug-logs.json

# Config (safe)
cat connector.config.json > debug-config.json
# (remove tokens before sharing)

# System info
uname -a
node --version
npm --version

# Device identities exist
ls -la ~/.openclaw-connector/identity/
```

### Report Issues

Include:
1. Connector logs (with tokens redacted)
2. Config file (with tokens redacted)
3. Output of `openclaw nodes list` on Gateway B
4. Network connectivity test results
5. Connector version and build date
