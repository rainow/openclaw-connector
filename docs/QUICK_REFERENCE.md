# Quick Reference Card

## Commands

```bash
# Setup
npm install                          # Install dependencies
npm run build                        # Compile TypeScript to dist/
npm run typecheck                    # Type check without output
npm run dev                          # Run with tsx (development)
npm start                            # Run compiled version

# Configuration
cp connector.config.example.json connector.config.json
export GATEWAY_B_TOKEN="..."
export GATEWAY_A_TOKEN="..."
```

## Configuration Checklist

```json
{
  "gatewayB": {
    "url": "ws://127.0.0.1:18789",      // ✓ Point to your Gateway B
    "token": "${GATEWAY_B_TOKEN}"        // ✓ Set env variable
  },
  "commandPolicy": {
    "mode": "allow_all"                  // ✓ Default: allow all commands
  },
  "breaker": {
    "enabled": true,                     // ✓ Enable circuit breaker
    "failureThreshold": 3,               // ✓ Failures before OPEN
    "openMs": 15000,                     // ✓ Time in OPEN state (ms)
    "halfOpenMaxInFlight": 1             // ✓ Max probes in HALF_OPEN
  },
  "remotes": [
    {
      "id": "machine-a",                 // ✓ Unique ID for each remote
      "url": "wss://...:18789",          // ✓ Use wss:// for remote networks
      "token": "${GATEWAY_A_TOKEN}",     // ✓ Set env variable
      "enabled": true,                   // ✓ Can disable without removing
      "timeoutMs": 30000                 // ✓ Invoke timeout per remote
    }
  ]
}
```

## File Structure

```
src/
├── types.ts                        # Type definitions
├── config.ts                       # Configuration loading
├── logger.ts                       # Structured logging
├── bridge.ts                       # Core routing logic
├── remote-client.ts                # Remote gateway connection (stub)
├── node-registration.ts            # Node registration (stub)
├── index.ts                        # Main orchestration
├── commands/                       # Command handlers
│   ├── index.ts                    # Registry
│   ├── sessions-list.ts
│   ├── sessions-send.ts
│   ├── nodes-list.ts
│   ├── nodes-invoke.ts
│   └── gateway-status.ts
├── resilience/
│   └── circuit-breaker.ts          # Circuit breaker
└── __tests__/
    └── circuit-breaker.test.ts     # Example tests
```

## Supported Commands

| Command | Purpose |
|---------|---------|
| `sessions.list` | List sessions on remote gateway |
| `sessions.send` | Send message to session |
| `nodes.list` | List nodes on remote gateway |
| `nodes.invoke` | Invoke command on remote node |
| `gateway.status` | Check remote gateway health |

## Circuit Breaker States

```
CLOSED (accept calls)
  ↓ (3 failures)
OPEN (reject calls)
  ↓ (15s pass)
HALF_OPEN (allow 1 probe)
  ↓ success
CLOSED
  └← failure: back to OPEN
```

## Environment Variables

```bash
GATEWAY_B_TOKEN=...                # Main gateway token
GATEWAY_A_TOKEN=...                # Remote gateway token
GATEWAY_C_TOKEN=...                # Another remote token
CONNECTOR_STATE_DIR=...            # Device identity location (default: ~/.openclaw-connector)
DEBUG=*                            # Enable debug logs (optional)
```

## Log Events

| Event | When |
|-------|------|
| `remote.connect.success` | Remote gateway connected |
| `remote.connect.fail` | Connection failed |
| `node.connect.success` | Node registered to Gateway B |
| `node.pair.pending` | Waiting for pairing approval |
| `invoke.start` | Command started |
| `invoke.success` | Command succeeded |
| `invoke.fail` | Command failed |
| `breaker.open` | Circuit breaker opened |
| `breaker.half_open` | Probing after OPEN |
| `breaker.close` | Recovered to CLOSED |

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "remote gateway not connected" | Check URL, credentials, network |
| "circuit breaker OPEN" | Wait 15s for auto-recovery, or fix underlying issue |
| "command not supported" | Check command name, verify allow_list mode |
| "node not registered" | Approve pairing: `openclaw nodes approve` |
| Config won't load | Validate JSON, check env vars: `echo $GATEWAY_B_TOKEN` |

## Systemd Service

```bash
# Create service file
sudo tee /etc/systemd/system/openclaw-connector.service > /dev/null <<EOF
[Unit]
Description=OpenClaw Connector
After=network-online.target

[Service]
Type=simple
User=openclaw
WorkingDirectory=/opt/openclaw-connector
EnvironmentFile=/etc/openclaw-connector/.env
ExecStart=/usr/bin/npm start
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
sudo systemctl enable openclaw-connector
sudo systemctl start openclaw-connector
sudo systemctl status openclaw-connector
```

## Docker

```bash
docker build -t openclaw-connector .
docker run -d \
  --name connector \
  -e GATEWAY_B_TOKEN="..." \
  -e GATEWAY_A_TOKEN="..." \
  -v connector-state:/app/.openclaw-connector \
  openclaw-connector
```

## Monitoring

```bash
# Watch connection events
journalctl -u openclaw-connector -f | jq '.[] | select(.event | startswith("remote."))'

# Track invokes
jq 'select(.event=="invoke.success")' /var/log/connector.log

# Monitor breaker
jq 'select(.event | startswith("breaker."))' /var/log/connector.log

# Find errors
journalctl -u openclaw-connector | jq 'select(.level=="ERROR")'
```

## Performance Tuning

```json
{
  "breaker": {
    "failureThreshold": 5,          // More tolerant to transient failures
    "openMs": 30000,                // Longer OPEN window for recovery
    "halfOpenMaxInFlight": 2        // Faster probing
  },
  "remotes": [
    {
      "timeoutMs": 60000            // Longer for slow networks
    }
  ]
}
```

## Node Pairing (First Time Only)

```bash
# On Gateway B machine:
openclaw nodes pending              # List pending approvals
openclaw nodes approve --id <nodeId>  # Approve each node
openclaw nodes list                 # Verify all connected
```

## Testing with OpenClaw CLI

```bash
# From Gateway B machine:
openclaw nodes list                 # Should see connector-* nodes

openclaw nodes invoke \
  --node connector-machine-a \
  --command sessions.list

# Check results
openclaw nodes list --detail
```

## Key Concepts

- **RemoteClient**: Operator connection to remote gateway
- **NodeRegistration**: Node registration on Gateway B
- **Bridge**: Routes invokes from Gateway B to RemoteClient
- **Circuit Breaker**: Prevents cascading failures
- **Device Identity**: Cryptographic key pair for each connection

## Help & Debugging

```bash
# Validate types
npm run typecheck

# Build and check
npm run build

# Show logs with timestamps
journalctl -u openclaw-connector -o json | jq '.MESSAGE'

# Export config (safe to share)
cat connector.config.json | jq 'del(.. | .token?)'
```

## Useful Paths

```
Config:           ./connector.config.json
State dir:        ~/.openclaw-connector/
Device IDs:       ~/.openclaw-connector/identity/device-*.json
Compiled:         ./dist/
Logs (systemd):   journalctl -u openclaw-connector
Logs (file):      /var/log/openclaw-connector.log
```

## Deployment Checklist

- [ ] npm install && npm run build
- [ ] Create connector.config.json with real gateway URLs
- [ ] Set environment variables (GATEWAY_*_TOKEN)
- [ ] npm start (verify no errors)
- [ ] openclaw nodes pending (approve all pairing requests)
- [ ] openclaw nodes invoke --node connector-* --command gateway.status
- [ ] Setup monitoring/logging
- [ ] Setup systemd service or container
- [ ] Test failover: stop a remote gateway, verify breaker opens/closes

## Quick Wins

1. Add new command: Create `src/commands/new-command.ts`, add to `commands/index.ts`
2. Change policy: Edit `commandPolicy.mode` in config to `allow_list`, add `allowList` array
3. Adjust breaker: Change `breaker.*` values in config
4. Add remote: Add entry to `remotes` array
5. Increase timeout: Set `timeoutMs` per remote or per invoke

---

**Last Updated:** 2026-04-24
**Version:** 0.1.0 (M1)
