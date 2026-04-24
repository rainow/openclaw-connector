# Development Guide

## Current Status (M2 - Real GatewayClient Integration)

✅ **M2 COMPLETE** - Real OpenClaw integration implemented

The connector now has:

- ✅ Complete type system (`src/types.ts`)
- ✅ Configuration loading with environment variable substitution (`src/config.ts`)
- ✅ Structured logging with sensitive data masking (`src/logger.ts`)
- ✅ Circuit breaker implementation (`src/resilience/circuit-breaker.ts`)
- ✅ Bridge routing engine (`src/bridge.ts`)
- ✅ Command handlers (`src/commands/`)
- ✅ **Real RemoteClient with GatewayClient integration** (`src/remote-client.ts`)
- ✅ **Real NodeRegistration with GatewayClient integration** (`src/node-registration.ts`)
- ✅ Graceful startup/shutdown orchestration (`src/index.ts`)

## M2 Implementation Details

### RemoteClient (Operator Mode)

The `RemoteClient` now:
- Creates real WebSocket connections to remote gateways
- Connects in **operator mode** (`mode: "operator"`)
- Handles authentication (token/password)
- Manages automatic reconnection with exponential backoff
- Forwards RPC calls directly to the remote gateway

**Key Changes**:
```typescript
async start(): Promise<void> {
  const GatewayClient = this.getGatewayClientClass();
  
  const clientOpts = {
    url: this.url,
    mode: "operator",
    clientName: "connector",
    clientDisplayName: `Connector-${this.id}`,
    token: this.token,
    password: this.password,
    onConnectError: (err) => { /* handle */ },
    onClose: (code, reason) => { /* handle */ },
  };

  this.gatewayClientInstance = new GatewayClient(clientOpts);
  this.gatewayClientInstance.start();
  await this.waitForReady();
}

async request<T>(method, params, timeoutMs) {
  return await this.makeRequest<T>(method, params, timeoutMs);
}
```

### NodeRegistration (Node Mode)

The `NodeRegistration` now:
- Creates real WebSocket connections to Gateway B
- Connects in **node mode** (`mode: "node"`, `role: "node"`)
- Registers supported commands with Gateway B
- Handles incoming `node.invoke.request` events
- Sends results back via `node.invoke.result` RPC

**Key Changes**:
```typescript
async start(): Promise<void> {
  const GatewayClient = this.getGatewayClientClass();
  
  const clientOpts = {
    url: this.url,
    mode: "node",
    role: "node",
    instanceId: this.id,
    commands: this.commands,
    clientName: "connector-node",
    onEvent: (evt) => {
      if (evt.event === "node.invoke.request") {
        void this.handleInvokeEvent(evt.payload);
      }
    },
  };

  this.gatewayClientInstance = new GatewayClient(clientOpts);
  this.gatewayClientInstance.start();
  await this.waitForReady();
}

private async handleInvokeEvent(payload: InvokeRequest) {
  const result = await this.onInvoke(this.id, payload);
  await this.sendResult(payload.id, result);
}

async sendResult(invokeId, result) {
  await this.gatewayClientInstance.request("node.invoke.result", {
    id: invokeId,
    nodeId: this.id,
    ok: result.ok,
    payload: result.payload,
    error: result.error,
  });
}
```

## Building & Testing

### Build

```bash
npm run build
```

### Type Check

```bash
npm run typecheck
```

### Run Integration Tests

```bash
npm test -- src/__tests__/integration.test.ts
```

### Run Locally

```bash
npm run dev
```

## Installation Requirements

To use the real GatewayClient integration, you need to install openclaw:

```bash
# Option 1: Link local development copy
npm link ../path/to/openclaw

# Option 2: Install from npm
npm install openclaw

# Option 3: Install from git
npm install github:openclaw/openclaw
```

See `OPENCLAW_INTEGRATION.md` for detailed installation instructions.

## Testing the Connector

### 1. Create Test Config

```bash
cp connector.config.example.json connector.config.test.json
```

Edit to point to your local gateway instances.

### 2. Run in Development Mode

```bash
npm run dev
```

Watch for logs:
- `remote.connect.success` - Remote connection established
- `node.connect.success` - Node registration to Gateway B established
- `node.pair.pending` - Waiting for admin approval on first run

### 3. Approve Node Pairing on Gateway B

```bash
# List pending pairing requests
openclaw nodes pending

# Approve each connector node
openclaw nodes approve --id <nodeId>
```

### 4. Test Command Invocation

From Gateway B:

```bash
# List remotes (should see connector-machine-a, connector-office-server, etc.)
openclaw nodes list

# Invoke a command
openclaw nodes invoke --node connector-machine-a --command sessions.list
```

## Architecture Deep Dive

### Command Routing

```
Gateway B (nodes.invoke)
    ↓
NodeRegistration (onEvent)
    ↓
Bridge.handleInvoke()
    ├─ Map node → remote
    ├─ Check breaker state
    ├─ Check command policy (allow_all / allow_list)
    ├─ Dispatch to handler
    ├─ Update breaker (recordSuccess / recordFailure)
    └─ Return result
    ↓
NodeRegistration.sendResult()
    ↓
Gateway B (receives result)
```

### Circuit Breaker State Transitions

```
CLOSED ──(failure_threshold)──→ OPEN
  ↑                              ↓
  └──(success in HALF_OPEN)── HALF_OPEN ──(openMs passed)→
```

Only "availability errors" count toward breaker:
- NOT_CONNECTED, UNAVAILABLE, TIMEOUT
- Network errors (ECONNREFUSED, ECONNRESET, etc.)

Business errors (command not found, invalid params) don't count.

### Per-Remote Isolation

Each remote has:
- Independent RemoteClient connection
- Independent NodeRegistration to Gateway B
- Own CircuitBreaker instance
- Own device identity file
- Own command policy (if configured)

Failure on one remote doesn't affect others.

## Logging Strategy

All events are JSON-logged for observability:

```bash
# Follow all events
tail -f connector-logs.log | jq '.'

# Find connection errors
jq 'select(.event=="remote.connect.fail")' connector-logs.log

# Track breaker state changes
jq 'select(.event | startswith("breaker."))' connector-logs.log

# Monitor invoke performance
jq 'select(.event=="invoke.success") | {command, durationMs}' connector-logs.log
```

## Performance Tuning

### Circuit Breaker

- `failureThreshold`: Lower = more aggressive (default: 3)
- `openMs`: Longer = slower recovery (default: 15s)
- `halfOpenMaxInFlight`: More = faster probing (default: 1)

### Timeout

- Global per-remote: `timeoutMs` in config (default: 30s)
- Per-invoke: `timeoutMs` in payload (overrides global)

### Max Connections

Currently unbounded. Future: add connection pooling if needed.

## Debugging

### Enable Debug Logs

```bash
# Temporarily set environment variable
DEBUG=* npm run dev
```

### Check Breaker State

The Bridge logs all breaker transitions:
```json
{
  "event": "breaker.open",
  "remoteId": "machine-a",
  "fromState": "CLOSED",
  "failureCount": 3,
  "willRetryMs": 15000
}
```

### Validate Config

```bash
npm run typecheck
```

### Build Check

```bash
npm run build
```

## Common Issues

### "remote gateway not connected"

The RemoteClient hasn't successfully connected to the remote gateway.

1. Check network connectivity
2. Verify URL and credentials in config
3. Check logs for `remote.connect.fail` events

### "circuit breaker OPEN"

Too many failures. The breaker is in OPEN state and rejecting requests.

1. Check what's failing (availability errors vs business errors)
2. Fix the underlying issue
3. Wait for `openMs` (default 15s) for automatic probe
4. Check logs for `breaker.open` and `breaker.close` events

### "command not supported"

The command handler isn't registered.

1. Check `src/commands/index.ts` includes the command
2. Verify command name is correct
3. Check command policy (allow_list mode might be blocking it)

### Pairing Fails on Gateway B

If the node registration doesn't progress past "pending":

1. Ensure you ran `openclaw nodes approve`
2. Check device identity is being created (should be in `~/.openclaw-connector/identity/`)
3. Look for `node.pair.*` events in logs
4. Verify Gateway B can write to its pairing store

## File Organization Recommendations

For future expansion:

```
src/
├── modules/
│   ├── remote-gateway/
│   │   ├── client.ts
│   │   ├── types.ts
│   │   └── handlers/
│   ├── local-node/
│   │   ├── registration.ts
│   │   └── handlers/
│   └── core/
│       ├── bridge.ts
│       ├── config.ts
│       └── logger.ts
├── commands/
│   ├── base.ts
│   ├── sessions/
│   ├── nodes/
│   └── gateway/
└── resilience/
    ├── circuit-breaker.ts
    ├── retry-policy.ts
    └── metrics.ts
```

## Next Release (M2)

- Full GatewayClient integration
- Real WebSocket connection handling
- Device identity management
- Node pairing flow
- Structured metrics/telemetry
