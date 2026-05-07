# OpenClaw 连接器

一个多网关控制连接器，允许 Gateway B 管理和调用多个远程 OpenClaw 网关上的命令，同时保持所有网关以其本地网关模式运行。

**其他语言**: [English](./README.md)

## 功能特性

- **多网关支持**: 从单个 Gateway B 控制多个远程网关
- **断路器**: 自动故障处理，包含状态机 (CLOSED → OPEN → HALF_OPEN)
- **命令策略**: 支持 allow_all（默认）和 allow_list 命令过滤
- **结构化日志**: 基于 JSON 的日志记录，带敏感数据脱敏
- **单网关隔离**: 一个远程网关的故障不会影响其他网关
- **环境变量替换**: 通过 `${VAR_NAME}` 灵活管理凭证
- **设备身份管理器**: 为每个远程网关隔离设备身份（避免 NodeId 冲突）
- **命令目录**: 可扩展的命令注册表，支持启用/禁用
- **错误分类器**: 智能错误分类，用于精确的断路器和重试逻辑

## 项目结构

```
openclaw-connector/
├── src/
│   ├── index.ts                 # 主入口点
│   ├── types.ts                 # 核心类型定义
│   ├── config.ts                # 配置加载
│   ├── logger.ts                # 结构化日志记录
│   ├── remote-client.ts         # 远程网关操作员连接
│   ├── node-registration.ts     # 本地节点注册到 Gateway B
│   ├── bridge.ts                # 核心路由和调用处理
│   ├── device-identity-manager.ts # 设备身份管理器
│   ├── commands/                # 命令处理器
│   │   ├── index.ts
│   │   ├── command-catalog.ts   # 命令注册表
│   │   ├── sessions-list.ts
│   │   ├── sessions-send.ts
│   │   ├── nodes-list.ts
│   │   ├── nodes-invoke.ts
│   │   └── gateway-status.ts
│   └── resilience/
│       ├── circuit-breaker.ts   # 断路器实现
│       └── error-classifier.ts  # 错误分类
├── package.json
├── tsconfig.json
├── connector.config.example.json
└── README-CN.md
```

## 安装与配置

### 1. 安装依赖

```bash
npm install
```

### 2. 创建配置文件

复制示例配置并根据环境进行自定义：

```bash
cp connector.config.example.json connector.config.json
```

编辑 `connector.config.json`：

- 更新 `gatewayB.url` 指向你的主 Gateway B
- 在 `remotes` 数组中添加远程网关
- 使用环境变量管理敏感数据，如 `${GATEWAY_B_TOKEN}`

### 3. 设置环境变量

```bash
export GATEWAY_B_TOKEN="your-gateway-b-token"
export GATEWAY_A_TOKEN="your-gateway-a-token"
export GATEWAY_C_TOKEN="your-gateway-c-token"
```

### 4. 构建并运行

开发模式：
```bash
npm run dev
```

生产构建：
```bash
npm run build
npm start
```

## 配置参考

### 全局配置

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

### 远程网关配置

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

### 命令策略模式

- **allow_all**（默认）: 允许所有注册的命令
- **allow_list**: 仅允许 `allowList` 中的命令

```json
{
  "mode": "allow_list",
  "allowList": ["sessions.list", "gateway.status"]
}
```

### 断路器选项

- `enabled`: 启用/禁用断路器（默认：true）
- `failureThreshold`: 打开前的连续故障次数（默认：3）
- `openMs`: 在 OPEN 状态下等待的时间（默认：15000ms）
- `halfOpenMaxInFlight`: HALF_OPEN 中的最大并发请求数（默认：1）

## 身份验证

使用 `token` 字段进行网关身份验证：

```json
{
  "id": "gateway-a",
  "url": "ws://gateway-a.local:18789",
  "token": "your-auth-token"
}
```

## 支持的命令

1. **sessions.list** - 列出远程网关上的所有会话
2. **sessions.send** - 向远程网关上的会话发送消息
3. **sessions.get_messages** - 获取远程网关上会话的消息（自动回退到 `sessions.get`）
4. **nodes.list** - 列出远程网关管理的所有节点
5. **nodes.invoke** - 调用远程网关上节点管理的命令
6. **gateway.status** - 获取远程网关的健康状态

## 日志记录

日志以 JSON 格式输出，便于解析和汇总。

### 日志级别

- **DEBUG**: 低级诊断消息
- **INFO**: 常规信息消息
- **WARN**: 警告消息
- **ERROR**: 错误消息

### 关键事件

- `remote.connect.success` / `remote.connect.fail` - 远程网关连接状态
- `node.connect.success` / `node.connect.fail` - 节点注册状态
- `invoke.start` / `invoke.success` / `invoke.fail` - 命令调用生命周期
- `breaker.open` / `breaker.half_open` / `breaker.close` - 断路器状态变化

### 敏感数据脱敏

日志记录器自动脱敏敏感字段（token、password、secret、apikey、auth、authorization、credential）。

## 故障排除

### 连接问题

检查日志以获取：
- 网络连接错误
- 身份验证失败
- 断路器状态转换

使用 JSON 日志进行诊断：
```bash
cat connector-logs.log | jq '.[] | select(.event=="remote.connect.fail")'
```

### 命令失败

1. 验证命令是否在允许列表中（如果使用 allow_list 策略）
2. 检查断路器状态
3. 验证远程网关是否有请求的命令可用
4. 检查超时设置

### 性能优化

如果遇到超时：
1. 增加单个远程网关的 `timeoutMs`
2. 检查断路器的 `halfOpenMaxInFlight` 设置
3. 监控到远程网关的网络延迟

## 高级选项：SSO Cookie 身份验证（可选）

对于受单点登录（SSO）保护的网关，你可以选择使用 `cookie` 字段传递会话 Cookie：

```json
{
  "id": "gateway-b",
  "url": "wss://gateway-b.example.com:18789",
  "token": "your-auth-token",
  "cookie": "session_id=xxx; sso_token=yyy"
}
```

**如何提取 Cookie：**
1. 在浏览器中打开网关 URL
2. 完成 SSO 登录
3. 打开开发者工具（F12）→ Network 标签
4. 检查任何已认证的 HTTP 请求
5. 复制 `Cookie` 请求头的值
6. 粘贴到连接器配置中

**说明**：`token` 和 `cookie` 可以一起使用进行双层身份验证。Cookie 在 WebSocket 握手头中传递以绕过 SSO 验证。

## 架构

```
┌─────────────────────┐
│    Gateway B (主控) │
└──────────┬──────────┘
           │
      (node role)
           │
┌──────────┴──────────────────────────┐
│      连接器进程                       │
│  ┌────────────────────────────────┐ │
│  │  Bridge (路由 + 断路器)         │ │
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

## 许可证

MIT


