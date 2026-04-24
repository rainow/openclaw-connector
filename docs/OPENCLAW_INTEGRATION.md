# OpenClaw Integration Guide

## Overview

The connector uses OpenClaw's `GatewayClient` to:
1. **RemoteClient**: Connect as an operator to remote gateways
2. **NodeRegistration**: Connect as a node to Gateway B

The `GatewayClient` is lazy-loaded at runtime to avoid hard dependencies.

## Installation Methods

### Option 1: Local Development (Link Local OpenClaw)

If you have OpenClaw checked out locally:

```bash
# In openclaw-connector directory
npm link ../path/to/openclaw

# Or use npm install with local path
npm install ../path/to/openclaw/openclaw
```

### Option 2: From npm Registry (When Available)

```bash
npm install openclaw
```

### Option 3: From Git Repository

```bash
npm install github:openclaw/openclaw
```

## Verify Installation

Check that GatewayClient is importable:

```bash
node -e "const oc = require('openclaw'); console.log('GatewayClient:', typeof oc.GatewayClient)"
```

Expected output:
```
GatewayClient: function
```

## Runtime Behavior

### When openclaw is Available

The connector will:
1. Load `GatewayClient` from the openclaw package
2. Create real WebSocket connections to gateways
3. Handle authentication and device identity
4. Support full OpenClaw protocol features

### When openclaw is NOT Available

The connector will:
1. Fail with a clear error message
2. Suggest installing openclaw
3. Not create any connections

Example error:
```
GatewayClient not available. Make sure openclaw is installed.
```

## GatewayClient Features Used

### RemoteClient (Operator Mode)

```typescript
const client = new GatewayClient({
  url: "wss://gateway:18789",
  mode: "operator",
  clientName: "connector",
  clientDisplayName: "Connector-A",
  token: authToken,              // Optional: token authentication
  password: authPassword,        // Optional: password authentication
  deviceIdentity: identity,      // Optional: device identity
  timeoutMs: 30000,              // Request timeout
  onConnectError: (err) => {},   // Connection error callback
  onClose: (code, reason) => {}, // Connection closed callback
});

client.start();

// Make RPC calls
const response = await client.request<T>(method, params, options);
```

**Supported Methods**:
- `nodes.list` - List nodes on the gateway
- `nodes.invoke` - Invoke a command on a node
- `sessions.list` - List sessions
- Any custom commands registered

### NodeRegistration (Node Mode)

```typescript
const client = new GatewayClient({
  url: "wss://gateway-b:18789",
  mode: "node",
  role: "node",
  clientName: "connector-node",
  clientDisplayName: "Connector-Node-A",
  instanceId: "connector-node-A",
  commands: ["sessions.list", "sessions.send", /* ... */],
  token: authToken,
  onEvent: (evt) => {
    if (evt.event === "node.invoke.request") {
      // Handle incoming invoke request
      handleInvokeRequest(evt.payload);
    }
  },
  onConnectError: (err) => {},
  onClose: (code, reason) => {},
});

client.start();

// Send results back
await client.request("node.invoke.result", resultParams);
```

## Device Identity Management

Both RemoteClient and NodeRegistration use device identity for authentication:

```typescript
import { loadOrCreateDeviceIdentity } from "openclaw/src/infra/device-identity.js";

const identity = loadOrCreateDeviceIdentity();
```

The identity includes:
- `deviceId`: Unique device identifier (UUID)
- `deviceKey`: Private key for signing
- `devicePublicKey`: Public key for verification

Device identity is persisted in the OpenClaw state directory.

## Authentication Methods

### Token Authentication

```typescript
{
  token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

Use when:
- Gateway is configured with token auth
- You have a pre-shared token

### Password Authentication

```typescript
{
  password: "gateway-password"
}
```

Use when:
- Gateway is configured with password auth
- Simpler setup for development

### Device Token Authentication

```typescript
{
  deviceIdentity: loadOrCreateDeviceIdentity()
}
```

Use when:
- Device identity is registered with gateway
- Most secure for production

## Connection Lifecycle

### Start Connection

```typescript
const client = new GatewayClient(options);
client.start();

// Client automatically:
// 1. Initiates WebSocket connection
// 2. Performs TLS handshake (if wss://)
// 3. Sends connect request
// 4. Waits for server hello
// 5. Becomes ready for requests
```

### Handle Events

```typescript
// For operator clients
client.onConnectError?.((err) => {
  console.error("Connection failed:", err);
});

client.onClose?.((code, reason) => {
  console.log(`Connection closed: ${code} ${reason}`);
});

// For node clients
client.onEvent?.((evt) => {
  if (evt.event === "node.invoke.request") {
    const payload = evt.payload as NodeInvokeRequest;
    console.log("Invoke request:", payload.command);
  }
});
```

### Stop Connection

```typescript
await client.stop();
// or
client.stop?.();
```

## Testing Without openclaw

For unit testing without OpenClaw:

```typescript
// In tests, mock the require:
jest.mock("openclaw", () => ({
  GatewayClient: MockGatewayClient,
}));

// Or provide a mock implementation:
const mockClient = {
  start: () => {},
  stop: async () => {},
  request: async (method, params) => ({ /* mocked response */ }),
  ws: { readyState: 1 },
};
```

## Troubleshooting

### "GatewayClient not available"

**Problem**: openclaw package is not installed

**Solution**:
```bash
npm install openclaw
# or for local development:
npm link ../path/to/openclaw
```

### Connection Timeout

**Problem**: Cannot connect to gateway at specified URL

**Solution**:
1. Verify gateway is running: `curl https://gateway:18789/health`
2. Check URL format: `wss://hostname:port` (not ws:// for remote)
3. Verify firewall/network connectivity
4. Check gateway TLS certificate if using wss://

### Device Identity Issues

**Problem**: "device token mismatch" error

**Solution**:
1. Delete stale device identity: `rm -rf ~/.openclaw/state/device-identity.json`
2. Device will be recreated on next connection
3. May need to re-pair the device with gateway

### Authentication Failures

**Problem**: "unauthorized" error on connect

**Solution**:
1. Verify token/password is correct
2. Check token hasn't expired
3. Verify gateway auth configuration
4. Try with device token if available

## Performance Considerations

### Connection Pooling

The connector creates separate client connections:
- One per RemoteClient (each remote gateway)
- One per NodeRegistration (one to Gateway B)

For large deployments:
- Consider reusing connections when possible
- Implement connection pooling in the future

### Request Timeouts

Default: 30 seconds

Adjust based on operation type:
```typescript
// Quick operations (list)
await client.request("nodes.list", {}, { timeoutMs: 5000 });

// Long operations (system.run)
await client.request("system.run", cmd, { timeoutMs: 120000 });
```

### Reconnection Strategy

The connector uses exponential backoff:
- Initial: 1 second
- Increases: 2x each attempt
- Maximum: 30 seconds
- No maximum attempts (retries indefinitely)

## Security Considerations

### TLS Verification

Always use `wss://` for remote gateways:
```typescript
{
  url: "wss://gateway.example.com:18789",
  // Not: ws://gateway.example.com:18789
}
```

### TLS Fingerprint Pinning

For additional security, pin the gateway's TLS certificate:
```typescript
{
  url: "wss://gateway.example.com:18789",
  tlsFingerprint: "sha256/AAAA...",
}
```

Get fingerprint:
```bash
openssl s_client -connect gateway:18789 -showcerts 2>/dev/null | \
  openssl x509 -fingerprint -noout -sha256
```

### Environment Variables

Store sensitive data in environment variables, not config files:
```bash
export OPENCLAW_CONNECTOR_TOKEN="..."
export OPENCLAW_CONNECTOR_PASSWORD="..."
```

Then reference in config:
```json
{
  "token": "${OPENCLAW_CONNECTOR_TOKEN}"
}
```

## Integration with CI/CD

### GitHub Actions Example

```yaml
- name: Test OpenClaw Connector
  env:
    OPENCLAW_URL: wss://test-gateway:18789
    OPENCLAW_TOKEN: ${{ secrets.OPENCLAW_TOKEN }}
  run: |
    npm install openclaw
    npm run typecheck
    npm run build
    npm test
```

### Docker Integration

```dockerfile
FROM node:20-alpine

WORKDIR /app
COPY . .

# Install dependencies including openclaw
RUN npm ci

# Build
RUN npm run build

# Run
ENTRYPOINT ["node", "dist/index.js"]
```

## Version Compatibility

The connector is tested with OpenClaw:
- Minimum version: 0.1.0 (when GatewayClient exists)
- Latest tested: Latest main branch

Check OpenClaw version in package.json when updating.

## Additional Resources

- [OpenClaw Documentation](https://github.com/openclaw/openclaw)
- [GatewayClient Source Code](https://github.com/openclaw/openclaw/blob/main/src/gateway/client.ts)
- [Node Host Implementation](https://github.com/openclaw/openclaw/tree/main/src/node-host)

## Support & Debugging

For debugging OpenClaw connections:

```bash
# Enable verbose logging
export DEBUG=openclaw:*

# Or set in connector config
{
  "logLevel": "debug"
}

# Monitor WebSocket traffic
export OPENCLAW_DEBUG_WS=1
```

Check logs for:
- Connection establishment
- Authentication handshake
- Request/response pairs
- Reconnection events
