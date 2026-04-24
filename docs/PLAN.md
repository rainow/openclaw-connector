# OpenClaw Connector 方案设计

## 1. 目标与范围

在不改变各机器均运行 Gateway 模式的前提下，实现：

- Gateway B（主控）可以控制多个远端 Gateway（A/C/D...）
- 每个远端独立隔离，单点故障不影响其他远端
- 保留命令白名单能力，但默认开放全部命令权限（按需再收敛）
- 增强稳定性与可观测性：引入熔断与结构化日志

---

## 2. 设计原则

1. **兼容现有 OpenClaw 协议**：基于 `GatewayClient` + `nodes.invoke` 标准流程，不改核心协议。
2. **默认可用优先**：默认配置尽量少，默认放开命令权限与 operator scopes，先跑通主流程。
3. **按 remote 隔离**：连接、身份、熔断、日志都以 remote 为最小隔离单元。
4. **可收敛**：支持后续按 remote 配置命令白名单与权限收敛，不破坏整体架构。

---

## 3. 总体架构

Connector 是独立 Node.js 进程。对每个 remote 维护两条连接：

- `RemoteClient`（operator 角色）连接远端 Gateway
- `NodeRegistration`（node 角色）注册到 Gateway B

Gateway B 的 AI 发起 `nodes.invoke` -> Connector 路由到对应 `RemoteClient` -> 回传 `node.invoke.result`。

```text
Gateway B（主控）
 ├── connector-machine-a  <->  [RemoteClient + NodeRegistration]  <->  Gateway A
 ├── connector-office-srv <->  [RemoteClient + NodeRegistration]  <->  Gateway C
 └── connector-home-nas   <->  [RemoteClient + NodeRegistration]  <->  Gateway D

                                      ↑ 全部运行在一个 Connector 进程
```

---

## 4. 关键机制

### 4.1 命令权限策略（默认全开放）

Connector 保留命令白名单能力，但默认模式为 `allow_all`：

- 默认：允许调用 `commands` 注册表中的全部命令
- 可选：切换为 `allow_list`，仅允许指定命令
- 支持全局配置 + per-remote 覆盖

建议配置结构：

```ts
type CommandPolicy = {
  mode: "allow_all" | "allow_list"; // 默认 allow_all
  allowList?: string[]; // mode=allow_list 时生效
};
```

### 4.2 Operator 权限策略（默认 admin）

`RemoteClient` 默认沿用 `GatewayClient` 默认 scopes（`operator.admin`），即默认具备完整控制能力。

- 默认：不额外限制 scopes（满足“默认开放全部权限”）
- 可选：用户后续可在配置中指定更小 scopes

### 4.3 多实例 Device Identity 隔离（必须）

每个 `NodeRegistration` 必须使用独立 `deviceIdentity` 文件，避免 nodeId 冲突覆盖：

```ts
const identity = loadOrCreateDeviceIdentity(
  path.join(connectorStateDir, "identity", `device-${remote.id}.json`)
);
```

> 不可让多个 NodeRegistration 共享 `~/.openclaw/identity/device.json`。

### 4.4 熔断机制（新增）

每个 remote 一个独立熔断器，状态机：`CLOSED -> OPEN -> HALF_OPEN -> CLOSED`。

- **触发 OPEN**：连续失败达到阈值（默认 3）
- **OPEN 窗口**：默认 15s，窗口内直接快速失败（不再请求远端）
- **HALF_OPEN 探测**：放行少量探测请求（默认 1 个），成功则闭合，失败则重新 OPEN

失败计数建议只统计“可用性错误”：

- 连接不可用
- 网络/传输错误
- 超时

不统计“业务错误”（例如命令参数错误、命令不存在）。

建议配置结构：

```ts
type CircuitBreakerConfig = {
  enabled: boolean; // 默认 true
  failureThreshold: number; // 默认 3
  openMs: number; // 默认 15000
  halfOpenMaxInFlight: number; // 默认 1
};
```

### 4.5 结构化日志（新增）

所有关键事件使用 JSON 行日志，便于检索、聚合、告警。

最小字段建议：

- `ts`, `level`, `event`
- `remoteId`, `nodeDisplayName`
- `invokeId`, `command`, `durationMs`
- `ok`, `errorCode`, `errorMessage`
- `breakerState`, `retryCount`

关键事件建议：

- `remote.connect.success` / `remote.connect.fail` / `remote.disconnect`
- `node.pair.pending` / `node.pair.approved`
- `invoke.start` / `invoke.success` / `invoke.fail` / `invoke.timeout`
- `breaker.open` / `breaker.half_open` / `breaker.close`

日志脱敏要求：

- 禁止输出 token/password
- URL 如含凭据需打码
- params 中敏感字段按 key 黑名单脱敏

---

## 5. 调用流程（修正版）

```text
Gateway B AI 发起 nodes.invoke
    ↓
NodeRegistration.onEvent("node.invoke.request", payload)
    ↓
Bridge.handleInvoke(payload, nodeRegistration)
    ↓
1) 通过 nodeRegistration 映射到 remoteId
2) 校验命令权限策略（allow_all / allow_list）
3) 检查 remote 熔断器状态（OPEN 则快速失败）
4) 调用对应 RemoteClient handler
5) 记录成功/失败并更新熔断器状态
    ↓
NodeRegistration.sendResult(...)
    ↓
client.request("node.invoke.result", params)
    ↓
Gateway B 收到结果
```

> 注意：结果回传方法名是 `node.invoke.result`（单数）。

---

## 6. 模块划分

### `src/config.ts`

- 读取与校验配置
- 处理全局默认值 + per-remote 覆盖
- 输出运行时配置对象

### `src/remote-client.ts`

- 远端 Gateway 的 operator 连接封装
- 提供统一 `request(method, params, timeout)` 能力
- 上报连接状态变化事件

### `src/node-registration.ts`

- 以 node 角色接入 Gateway B
- 处理 `node.invoke.request`
- 回传 `node.invoke.result`

### `src/bridge.ts`

- 核心路由：`nodeRegistration -> remoteId -> command handler`
- 权限策略检查（allow_all / allow_list）
- 与熔断器交互
- 统一错误映射与结果回传

### `src/commands/`

- 命令注册与处理器
- 初期建议命令：
  - `sessions.list`
  - `sessions.send`
  - `nodes.list`
  - `nodes.invoke`
  - `gateway.status`

### `src/resilience/circuit-breaker.ts`（新增）

- 每个 remote 一份实例
- 维护状态机、失败计数、探测窗口
- 暴露 `beforeCall` / `onSuccess` / `onFailure`

### `src/logger.ts`

- 结构化日志输出（JSON）
- 提供统一 `logEvent(event, fields)`
- 内置敏感字段脱敏

### `src/index.ts`

- 启动流程编排
- 初始化 remotes、桥接关系、熔断器
- 优雅退出

---

## 7. 配置建议

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
  "remotes": [
    {
      "id": "machine-a",
      "url": "wss://a.example.com:18789",
      "token": "${GATEWAY_A_TOKEN}",
      "enabled": true,
      "timeoutMs": 30000,
      "commandPolicy": {
        "mode": "allow_all"
      }
    }
  ]
}
```

说明：

- 默认即全开放（命令 + operator 权限）
- 用户有需求时再给某个 remote 切到 `allow_list`
- `enabled=false` 可临时下线某个 remote

---

## 8. 鉴权与 Pairing 流程

### 8.1 Connector -> Gateway A（operator）

- 使用 token/password 鉴权
- 默认可跳过 device pairing（operator + shared auth）
- 建立 operator 会话

### 8.2 Connector -> Gateway B（node）

- 先通过 token/password 初始鉴权
- node 角色必须经过 device pairing（首次）
- 管理员执行 `openclaw nodes approve` 后进入可用状态

### 8.3 重启行为

- device identity 与 device token 持久化后，重启通常无需重复 pairing
- 每个 remote 独立 identity，互不影响

---

## 9. 使用流程（简版）

1. 准备 Gateway A/B 的 token 或 password
2. 编写 `connector.config.json`
3. 启动 Connector
4. 首次在 Gateway B 批准各 remote 对应 node pairing
5. 在 Gateway B 通过 `nodes.invoke` 调用远端命令

---

## 10. 里程碑建议

### M1（先跑通）

- 多 remote 基础链路
- 独立 device identity
- 默认全开放命令策略（allow_all）
- 基础结构化日志（invoke + connect）

### M2（增强稳定性）

- per-remote 熔断器
- 超时与错误分类
- breaker 状态事件日志

### M3（按需收敛）

- per-remote `allow_list`
- 可选缩减 operator scopes
- 指标与告警接入

---

## 11. 当前结论

该方案在保持原有 OpenClaw 模型不变的前提下可落地。当前版本按你的要求采用：

- **命令白名单能力保留，但默认全开放**
- **默认开放 operator 权限**
- **新增熔断与结构化日志作为稳定性基线**

核心架构无需大改，可直接进入实现阶段。