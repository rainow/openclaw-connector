# 🚀 START HERE

Welcome to OpenClaw Connector! This document will guide you through the project.

## ⚡ 5-Minute Quickstart

```bash
# 1. Install dependencies
npm install

# 2. Build the project
npm run build

# 3. Create your configuration
cp connector.config.example.json connector.config.json

# 4. Edit connector.config.json with your gateway URLs and tokens
# (see section "Setting Up Your Config" below)

# 5. Run it
npm start
```

---

## 📚 Documentation Guide

### For Different Roles

**🎯 Project Managers / Decision Makers:**
- Start with: `README.md` - Overview and capabilities
- Then read: `PLAN.md` - Architecture and design decisions
- Reference: `COMPLETION_SUMMARY.md` - What's done, what's planned

**👨‍💻 Developers:**
- Start with: `README.md` - Setup and configuration
- Then read: `DEVELOPMENT.md` - Architecture deep dive and integration guide
- Reference: `QUICK_REFERENCE.md` - Commands and troubleshooting

**🔧 DevOps / Operations:**
- Start with: `DEPLOYMENT.md` - Production deployment
- Reference: `QUICK_REFERENCE.md` - Monitoring and troubleshooting

**🐛 Troubleshooting:**
- First: `QUICK_REFERENCE.md` - Common issues and solutions
- Then: `DEVELOPMENT.md` - Architecture and debugging tips
- Finally: `DEPLOYMENT.md` - Production troubleshooting

---

## 📖 Full Documentation Index

| Document | Purpose | Read Time |
|----------|---------|-----------|
| **README.md** | Project overview, setup, feature list | 10 min |
| **PLAN.md** | Architecture, design, flow diagrams | 20 min |
| **DEVELOPMENT.md** | Dev guide, integration roadmap, patterns | 15 min |
| **DEPLOYMENT.md** | Production deployment, monitoring, scaling | 15 min |
| **QUICK_REFERENCE.md** | Commands, configs, troubleshooting | 5 min |
| **IMPLEMENTATION_STATUS.md** | M1 status, roadmap, limitations | 10 min |
| **COMPLETION_SUMMARY.md** | Deliverables, metrics, summary | 10 min |

---

## ⚙️ Setting Up Your Config

Create `connector.config.json` based on the example:

```json
{
  "gatewayB": {
    "url": "ws://YOUR_GATEWAY_B_IP:18789",
    "token": "${GATEWAY_B_TOKEN}"
  },
  "remotes": [
    {
      "id": "machine-a",
      "url": "wss://YOUR_GATEWAY_A_IP:18789",
      "token": "${GATEWAY_A_TOKEN}",
      "enabled": true
    }
  ]
}
```

Then set environment variables:
```bash
export GATEWAY_B_TOKEN="your-token-here"
export GATEWAY_A_TOKEN="your-token-here"
```

See `QUICK_REFERENCE.md` for all configuration options.

---

## ✅ Project Status

### ✅ Completed (M1)
- Type system and interfaces
- Configuration management
- Structured logging with masking
- Circuit breaker implementation
- Bridge routing logic
- Command handlers (5 built-in)
- Main orchestration
- Comprehensive documentation

### ⏳ In Progress (M2)
- GatewayClient integration
- Real WebSocket connections
- Device identity management
- Node pairing flow

See `IMPLEMENTATION_STATUS.md` for full roadmap.

---

## 🔍 What This Project Does

```
Your Network
└─ Connector Process (Node.js)
   ├─ RemoteClient → Gateway A (as operator)
   │  └─ Can control Gateway A
   ├─ RemoteClient → Gateway C (as operator)
   │  └─ Can control Gateway C
   └─ NodeRegistration → Gateway B (as node)
      └─ Appears as "connector-machine-a", "connector-office-server" etc.
         └─ Gateway B's AI can invoke commands via Connector
```

Result: **Gateway B controls multiple remote gateways while all stay in gateway mode.**

---

## 🎮 Quick Commands

```bash
# Development
npm run dev                    # Run with auto-reload
npm run typecheck              # Check types
npm run build                  # Build for production

# Production
npm install
npm run build
npm start

# Monitoring
tail -f connector.log | jq '.'
journalctl -u openclaw-connector -f
```

See `QUICK_REFERENCE.md` for more.

---

## 🏗️ Project Structure

```
src/
├── types.ts                  # Type definitions
├── config.ts                 # Configuration loading
├── logger.ts                 # Structured logging
├── bridge.ts                 # Core routing
├── remote-client.ts          # Remote gateway (stub)
├── node-registration.ts      # Node registration (stub)
├── index.ts                  # Main entry
├── commands/                 # 5 command handlers
└── resilience/
    └── circuit-breaker.ts    # Circuit breaker

dist/                         # Compiled output (ready to run)
```

---

## 🆘 Common Issues

| Issue | Solution |
|-------|----------|
| Won't start | Run `npm run typecheck` to check for errors |
| Config error | Validate JSON: `cat connector.config.json \| jq .` |
| Connection failed | Check gateway URLs and network connectivity |
| Circuit breaker OPEN | Wait 15 seconds for auto-recovery |
| Node not registered | Approve pairing: `openclaw nodes approve` |

See `QUICK_REFERENCE.md` for more troubleshooting.

---

## 📊 Key Concepts

### Circuit Breaker
Prevents cascading failures. Automatically opens/closes based on error rate.
```
CLOSED (accept) → OPEN (reject) → HALF_OPEN (probe) → CLOSED
```

### Command Policies
- **allow_all**: Accept all registered commands (default)
- **allow_list**: Only accept whitelisted commands

### Per-Remote Isolation
Each remote gateway has:
- Independent connection
- Own CircuitBreaker
- Separate device identity
- Can be enabled/disabled independently

---

## 🚀 Next Steps

### 1. First Time?
- [ ] Read `README.md`
- [ ] Run the quickstart above
- [ ] Review `QUICK_REFERENCE.md`

### 2. Want to Deploy?
- [ ] Follow `DEPLOYMENT.md`
- [ ] Check `QUICK_REFERENCE.md` systemd section
- [ ] Setup monitoring as described

### 3. Want to Develop?
- [ ] Read `DEVELOPMENT.md`
- [ ] Understand GatewayClient integration (section in DEVELOPMENT.md)
- [ ] Review `PLAN.md` for architecture

### 4. Troubleshooting?
- [ ] Check `QUICK_REFERENCE.md` first
- [ ] Review logs for details
- [ ] Check `DEPLOYMENT.md` troubleshooting section

---

## 🎯 What You Can Do With This

Once fully integrated (M2), you'll be able to:

✅ Control multiple OpenClaw gateways from one main gateway
✅ All gateways stay in gateway mode (no node downgrade needed)
✅ Automatic failure handling with circuit breaker
✅ Monitor and manage remotes from Gateway B's AI
✅ Execute commands across multiple gateways

Example:
```bash
# From Gateway B, invoke command on remote Gateway A
openclaw nodes invoke --node connector-machine-a --command sessions.list
```

---

## 📞 Getting Help

1. **Quick answers**: `QUICK_REFERENCE.md`
2. **How-to guides**: `DEPLOYMENT.md` or `DEVELOPMENT.md`
3. **Architecture questions**: `PLAN.md`
4. **Error messages**: Check logs with `jq` filtering

---

## 🎓 Learning Value

This project demonstrates:
- Circuit breaker pattern for resilience
- TypeScript best practices (strict mode, interfaces)
- Configuration management patterns
- Structured logging
- Error classification and handling
- Async/await patterns
- Multi-component orchestration

Perfect for understanding modern microservices resilience patterns.

---

## ⚡ Quick Comparison: Before vs After

### Before (Two Separate Systems)
```
Gateway A (standalone)  →  Can't be controlled by Gateway B
Gateway B (standalone)  →  Can't access Gateway A's resources
```

### After (With Connector)
```
Gateway B (main) ──→ Connector Process ──→ Gateway A (remote)
                  └──→ [Can invoke commands on Gateway A]
```

---

## 🔐 Security Notes

- Tokens/passwords are never logged (automatic masking)
- Use `wss://` for remote network connections
- Keep device identity files (`~/.openclaw-connector/identity/`) secure
- Credentials via environment variables, not hardcoded

---

## 📈 Architecture Overview

```
┌─────────────────────────────────────────┐
│    Gateway B (Main Controller)          │
└────────────────┬────────────────────────┘
                 │
                 │ (node role)
                 │
┌────────────────┴────────────────────────┐
│  Connector Process (Node.js)            │
│  ┌────────────────────────────────────┐ │
│  │  Bridge (Routing + CircuitBreaker) │ │
│  ├────────────────────────────────────┤ │
│  │  5 Command Handlers                │ │
│  │  (sessions, nodes, gateway.status) │ │
│  └────────┬───────────────────────────┘ │
│           │                             │
│  ┌────────┴──────────┬─────────────┐   │
│  │                   │             │   │
│  ▼                   ▼             ▼   │
│ Remote-A           Remote-B      Remote-C
│ (operator)         (operator)    (operator)
└─────────────────────────────────────────┘
   │                  │              │
   ▼                  ▼              ▼
Gateway A          Gateway B       Gateway C
```

---

## 🎉 You're All Set!

Everything is built and ready to go. Pick a section below based on what you want to do:

- 📖 **[Learn Architecture](PLAN.md)** - How it all works
- 🚀 **[Deploy to Production](DEPLOYMENT.md)** - Get it running
- 👨‍💻 **[Develop & Extend](DEVELOPMENT.md)** - Build on it
- ⚡ **[Quick Reference](QUICK_REFERENCE.md)** - Cheat sheet
- ✅ **[Check Status](COMPLETION_SUMMARY.md)** - What's done

**Ready? Pick a doc and start reading!** 🎯

---

**Version:** 0.1.0 (M1 Complete)
**Status:** ✅ Ready for GatewayClient Integration
**Build Date:** 2026-04-24
