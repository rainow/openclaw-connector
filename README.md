# OpenClaw Connector

A multi-gateway control connector that allows Gateway B to manage and invoke commands on multiple remote OpenClaw gateways, while keeping all gateways in their native gateway mode.

**Languages**: [中文](./README-CN.md) | English

## Features

- **Multi-Gateway Support**: Control multiple remote gateways from a single Gateway B
- **Circuit Breaker**: Automatic failure handling with state machine (CLOSED → OPEN → HALF_OPEN)
- **Command Policies**: Support for allow_all (default) and allow_list command filtering
- **Structured Logging**: JSON-based logging with sensitive data masking
- **Per-Remote Isolation**: Failures on one remote don't affect others
- **Environment Variable Substitution**: Flexible credential management via `${VAR_NAME}`
- **Device Identity Manager**: Isolated device identity for each remote gateway (no node conflicts)
- **Command Catalog**: Extensible command registry with enable/disable support
- **Error Classifier**: Intelligent error categorization for precise circuit breaker and retry logic

## Project Structure

```
openclaw-connector/
├── src/
│   ├── index.ts                 # Main entry point
│   ├── types.ts                 # Core type definitions
│   ├── config.ts                # Configuration loading
│   ├── logger.ts                # Structured logging
│   ├── remote-client.ts         # Remote gateway operator connection
│   ├── node-registration.ts     # Local node registration to Gateway B
│   ├── bridge.ts                # Core routing and invoke handling
│   ├── device-identity-manager.ts # Device identity manager
│   ├── commands/                # Command handlers
│   │   ├── index.ts
│   │   ├── command-catalog.ts   # Command registry
│   │   ├── sessions-list.ts
│   │   ├── sessions-send.ts
│   │   ├── nodes-list.ts
│   │   ├── nodes-invoke.ts
│   │   └── gateway-status.ts
│   └── resilience/
│       ├── circuit-breaker.ts   # Circuit breaker implementation
│       └── error-classifier.ts  # Error classification
├── package.json
├── tsconfig.json
├── connector.config.example.json
└── README.md
```

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Create Configuration

Copy the example configuration and customize for your environment:

```bash
cp connector.config.example.json connector.config.json
```

Edit `connector.config.json`:

- Update `gatewayB.url` to point to your main Gateway B
- Add your remote gateways in the `remotes` array
- Use environment variables for sensitive data like `${GATEWAY_B_TOKEN}`

### 3. Set Environment Variables

```bash
export GATEWAY_B_TOKEN="your-gateway-b-token"
export GATEWAY_A_TOKEN="your-gateway-a-token"
export GATEWAY_C_TOKEN="your-gateway-c-token"
```

### 4. Build and Run

Development mode:
```bash
npm run dev
```

Production build:
```bash
npm run build
npm start
```

## Configuration Reference

### Global Configuration

```json
{
  "gatewayB": {
    "url": "ws://127.0.0.1:18789",
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
  "remotes": [...]
}
```

### Remote Configuration

```json
{
  "id": "machine-a",
  "url": "wss://remote-a.example.com:18789",
  "token": "${GATEWAY_A_TOKEN}",
  "enabled": true,
  "timeoutMs": 30000,
  "commandPolicy": {
    "mode": "allow_all"
  }
}
```

### Command Policy Modes

- **allow_all** (default): All registered commands are allowed
- **allow_list**: Only commands in the `allowList` are permitted

```json
{
  "mode": "allow_list",
  "allowList": ["sessions.list", "gateway.status"]
}
```

### Circuit Breaker Options

- `enabled`: Enable/disable circuit breaker (default: true)
- `failureThreshold`: Consecutive failures before opening (default: 3)
- `openMs`: Time to wait in OPEN state before probing (default: 15000ms)
- `halfOpenMaxInFlight`: Max concurrent requests in HALF_OPEN (default: 1)

## Authentication

Use the `token` field for gateway authentication:

```json
{
  "id": "gateway-a",
  "url": "ws://gateway-a.local:18789",
  "token": "your-auth-token"
}
```

## Supported Commands

1. **sessions.list** - List all sessions on the remote gateway
2. **sessions.send** - Send a message to a session on the remote gateway
3. **sessions.get_messages** - Get messages from a session on the remote gateway (with automatic fallback to `sessions.get`)
4. **nodes.list** - List all nodes managed by the remote gateway
5. **nodes.invoke** - Invoke a command on a node managed by the remote gateway
6. **gateway.status** - Get health status of the remote gateway

## Logging

Logs are output as JSON for easy parsing and aggregation.

### Log Levels

- **DEBUG**: Low-level diagnostic messages
- **INFO**: General informational messages
- **WARN**: Warning messages
- **ERROR**: Error messages

### Key Events

- `remote.connect.success` / `remote.connect.fail` - Remote gateway connection state
- `node.connect.success` / `node.connect.fail` - Node registration state
- `invoke.start` / `invoke.success` / `invoke.fail` - Command invocation lifecycle
- `breaker.open` / `breaker.half_open` / `breaker.close` - Circuit breaker state changes

### Sensitive Data Masking

The logger automatically masks sensitive fields (token, password, secret, apikey, auth, authorization, credential).

## Troubleshooting

### Connection Issues

Check logs for:
- Network connectivity errors
- Authentication failures
- Circuit breaker state transitions

Use the JSON logs to diagnose:
```bash
cat connector-logs.log | jq '.[] | select(.event=="remote.connect.fail")'
```

### Command Failures

1. Verify command is in allowed list (if using allow_list policy)
2. Check circuit breaker state
3. Verify remote gateway has the requested command available
4. Check timeout settings

### Performance

If experiencing timeouts:
1. Increase per-remote `timeoutMs`
2. Check circuit breaker `halfOpenMaxInFlight` setting
3. Monitor network latency to remotes

## Advanced: SSO Cookie-based Authentication (Optional)

For gateways protected by Single Sign-On (SSO), you can optionally use the `cookie` field to pass session cookies:

```json
{
  "id": "gateway-b",
  "url": "wss://gateway-b.example.com:18789",
  "token": "your-auth-token",
  "cookie": "session_id=xxx; sso_token=yyy"
}
```

**How to extract cookies:**
1. Open the gateway URL in your browser
2. Complete SSO login
3. Open Developer Tools (F12) → Network tab
4. Inspect any authenticated HTTP request
5. Copy the value of the `Cookie` header
6. Paste it into the connector config

**Note**: Both `token` and `cookie` can be used together for dual-layer authentication. Cookies are passed in the WebSocket handshake headers to bypass SSO verification.

## Architecture

```
┌─────────────────────┐
│    Gateway B (主控) │
└──────────┬──────────┘
           │
      (node role)
           │
┌──────────┴──────────────────────────┐
│      Connector Process              │
│  ┌────────────────────────────────┐ │
│  │  Bridge (routing + breaker)    │ │
│  └─┬──────────────────────────────┘ │
│    │                                │
│  ┌─┴──────────┐  ┌──────────────┐   │
│  │ RemoteA    │  │ NodeRegA     │   │
│  │ (operator) │  │ (node)       │   │
│  └─┬──────────┘  └──────────────┘   │
│    │                                │
│    ├────────────> Gateway A         │
│    └────────────> Gateway B         │
└────────────────────────────────────┘
```

## License

MIT
