# 可选改进功能指南

本文档描述了已实现的三个可选改进功能，旨在增强系统的可靠性、可扩展性和可维护性。

## 📋 功能概览

| 功能 | 模块 | 优势 | 使用场景 |
|-----|------|------|--------|
| **Device Identity 持久化** | `device-identity-manager.ts` | 避免节点身份冲突 | 多远程网关场景 |
| **命令支持范围扩展** | `commands/command-catalog.ts` | 灵活的命令管理 | 动态命令启用/禁用 |
| **错误分类调整** | `resilience/error-classifier.ts` | 精细化错误处理 | 优化熔断和重试策略 |

---

## 1️⃣ Device Identity 持久化策略

### 概述

每个远程网关保持独立的设备身份（Device Identity），避免节点身份冲突和重复配对。

### 文件位置

```
src/device-identity-manager.ts
```

### 核心函数

#### `getDeviceIdentityPath(stateDir, remoteId)`
获取指定远程网关的设备身份文件路径

**示例：**
```typescript
import { getDeviceIdentityPath } from './device-identity-manager.js';

const stateDir = '~/.openclaw/connector-state';
const path = getDeviceIdentityPath(stateDir, 'machine-a');
// 返回：~/.openclaw/connector-state/device-identities/device-machine-a.json
```

#### `loadOrCreateRemoteDeviceIdentity(stateDir, remoteId)`
加载或创建远程网关的设备身份

**示例：**
```typescript
import { loadOrCreateRemoteDeviceIdentity } from './device-identity-manager.js';

const identity = loadOrCreateRemoteDeviceIdentity(stateDir, 'machine-a');
if (!identity) {
  // GatewayClient 将自动创建新身份
  console.log('New device identity will be created on first connection');
}
```

#### `listRemoteDeviceIdentities(stateDir, remoteIds)`
列出所有远程网关的设备身份状态

**示例：**
```typescript
import { listRemoteDeviceIdentities } from './device-identity-manager.js';

const remoteIds = ['machine-a', 'office-server', 'lab-gateway'];
const status = listRemoteDeviceIdentities(stateDir, remoteIds);
// 返回：
// [
//   { remoteId: 'machine-a', identityPath: '...', exists: true },
//   { remoteId: 'office-server', identityPath: '...', exists: false },
//   ...
// ]
```

#### `clearRemoteDeviceIdentity(stateDir, remoteId)`
清除远程网关的设备身份（用于重新配对）

**示例：**
```typescript
import { clearRemoteDeviceIdentity } from './device-identity-manager.js';

const cleared = clearRemoteDeviceIdentity(stateDir, 'machine-a');
if (cleared) {
  console.log('Device identity cleared. Will re-pair on next connection.');
}
```

### 数据结构

**设备身份文件示例** (`~/.openclaw/connector-state/device-identities/device-machine-a.json`)：
```json
{
  "deviceId": "3f9a2b1c-5d7e-4f3b-9a2c-1d5e7f3b9a2c",
  "deviceSecret": "secret_key_here",
  "createdAt": 1703001234567,
  "pairedAt": 1703001267890
}
```

### 隔离好处

1. **避免 NodeId 冲突**：每个远程网关独立维护身份
2. **设备令牌隔离**：每个网关使用独立的配对密钥
3. **配对状态隔离**：每个网关维护独立的配对状态
4. **便于调试**：清晰的文件结构便于监控和排查

### 在 index.ts 中的使用

```typescript
import { getDeviceIdentityPath } from './device-identity-manager.js';

const stateDir = getConnectorStateDir();
const deviceIdentityPath = getDeviceIdentityPath(stateDir, remote.id);

const nodeRegistration = new NodeRegistration({
  // ... 其他参数 ...
  deviceIdentityPath,  // 传递给 NodeRegistration
});
```

---

## 2️⃣ 命令支持范围扩展

### 概述

提供灵活的命令管理系统，支持命令启用/禁用、分类、文档化和动态配置。

### 文件位置

```
src/commands/command-catalog.ts
```

### 命令分类

系统预定义了三大命令类别：

#### 会话命令 (Session)
```typescript
- sessions.list    ✓ 列出所有会话
- sessions.send    ✓ 发送消息到会话
- sessions.close   ✗ 关闭会话 (默认禁用)
- sessions.get     ✗ 获取会话详情 (默认禁用)
```

#### 节点命令 (Node)
```typescript
- nodes.list       ✓ 列出所有节点
- nodes.invoke     ✓ 调用节点命令
- nodes.approve    ✗ 批准节点注册 (默认禁用)
```

#### 网关命令 (Gateway)
```typescript
- gateway.status   ✓ 获取网关状态
- gateway.config   ✗ 获取网关配置 (默认禁用)
- gateway.metrics  ✗ 获取网关指标 (默认禁用)
```

### 核心 API

#### `getEnabledCommands()`
获取所有已启用的命令

**示例：**
```typescript
import { getEnabledCommands } from './commands/command-catalog.js';

const enabled = getEnabledCommands();
console.log(enabled);
// 输出：['sessions.list', 'sessions.send', 'nodes.list', 'nodes.invoke', 'gateway.status']
```

#### `enableCommand(commandName)` / `disableCommand(commandName)`
动态启用或禁用命令

**示例：**
```typescript
import { enableCommand, disableCommand } from './commands/command-catalog.js';

// 启用高级命令
enableCommand('nodes.approve');
enableCommand('gateway.config');

// 禁用命令
disableCommand('gateway.status');
```

#### `getCommandsByCategory(category, enabledOnly)`
按分类获取命令

**示例：**
```typescript
import { getCommandsByCategory } from './commands/command-catalog.js';

const sessionCommands = getCommandsByCategory('session', true);
console.log(sessionCommands);
// 输出：['sessions.list', 'sessions.send']

const allNodeCommands = getCommandsByCategory('node', false);
console.log(allNodeCommands);
// 输出：['nodes.list', 'nodes.invoke', 'nodes.approve']
```

#### `getCommandMetadata(commandName)`
获取命令元数据

**示例：**
```typescript
import { getCommandMetadata } from './commands/command-catalog.js';

const meta = getCommandMetadata('nodes.invoke');
console.log(meta);
// 输出：
// {
//   name: 'nodes.invoke',
//   description: 'Invoke a command on a node managed by the remote gateway',
//   enabled: true,
//   category: 'node'
// }
```

#### `formatCommandList(enabledOnly)`
获取格式化的命令列表

**示例：**
```typescript
import { formatCommandList } from './commands/command-catalog.js';

console.log(formatCommandList(true));
// 输出：
// SESSION:
//   [✓] sessions.list - List all sessions on the remote gateway
//   [✓] sessions.send - Send a message to a session on the remote gateway
//
// NODE:
//   [✓] nodes.list - List all nodes managed by the remote gateway
//   [✓] nodes.invoke - Invoke a command on a node managed by the remote gateway
//
// GATEWAY:
//   [✓] gateway.status - Get health status of the remote gateway
```

#### `getCommandStats()`
获取命令统计信息

**示例：**
```typescript
import { getCommandStats } from './commands/command-catalog.js';

const stats = getCommandStats();
console.log(stats);
// 输出：{ total: 9, enabled: 5, disabled: 4, categories: 3 }
```

### 扩展命令

要添加新命令，只需在 `BUILTIN_COMMANDS` 对象中添加条目：

```typescript
export const BUILTIN_COMMANDS: Record<string, CommandMetadata> = {
  // ... 现有命令 ...

  // 新增自定义命令
  "custom.mycommand": {
    name: "custom.mycommand",
    description: "My custom command",
    enabled: true,
    category: "custom",
    version: "1.0.0",
  },
};
```

---

## 3️⃣ 错误分类调整

### 概述

高级错误分类系统，根据错误类型自动确定是否应该触发熔断、重试，以及日志级别。

### 文件位置

```
src/resilience/error-classifier.ts
```

### 错误分类

系统定义了以下错误类别：

| 类别 | 触发熔断 | 可重试 | 示例 |
|-----|--------|------|------|
| **AVAILABILITY** | ✓ | ✓ | 网络错误、连接拒绝、超时 |
| **TRANSIENT** | ✗ | ✓ | 临时资源不可用、中断信号 |
| **BUSINESS** | ✗ | ✗ | 找不到资源、权限拒绝、无效参数 |
| **PERMANENT** | ✗ | ✗ | 永久性错误 |
| **UNKNOWN** | ✗ | ✗ | 未分类错误 |

### 核心 API

#### `classifyError(error)`
对错误进行分类

**示例：**
```typescript
import { classifyError } from './resilience/error-classifier.js';

const error = new Error('Connection refused');
const classification = classifyError(error);
console.log(classification);
// 输出：
// {
//   category: 'AVAILABILITY',
//   code: 'ECONNREFUSED',
//   message: 'Connection refused',
//   retriable: true,
//   breakerTriggering: true
// }
```

#### `shouldTriggerBreaker(error)`
检查是否应该触发熔断

**示例：**
```typescript
import { shouldTriggerBreaker } from './resilience/error-classifier.js';

if (shouldTriggerBreaker(error)) {
  // 记录熔断失败
  circuitBreaker.recordFailure(error);
}
```

#### `isRetriable(error)`
检查错误是否可重试

**示例：**
```typescript
import { isRetriable } from './resilience/error-classifier.js';

if (isRetriable(error)) {
  // 重试操作
  await retryWithBackoff(() => operation());
}
```

#### `getErrorSeverity(error)`
获取错误严重程度（用于日志）

**示例：**
```typescript
import { getErrorSeverity } from './resilience/error-classifier.js';

const severity = getErrorSeverity(error);
logger.log(severity, 'Operation failed', { error });
// 可能输出：
// logger.critical('Operation failed', { error })
// logger.warning('Operation failed', { error })
// logger.info('Operation failed', { error })
```

#### `getUserFriendlyMessage(error)`
获取用户友好的错误信息

**示例：**
```typescript
import { getUserFriendlyMessage } from './resilience/error-classifier.js';

const message = getUserFriendlyMessage(error);
console.log(message);
// 输出：
// "Connection failed: Connection refused. Retrying..."
// "Operation failed: Resource not found"
```

### 错误统计

`ErrorStatistics` 类用于收集和分析错误模式：

**示例：**
```typescript
import { ErrorStatistics } from './resilience/error-classifier.js';

const stats = new ErrorStatistics();

// 记录错误
try {
  await operation();
} catch (err) {
  stats.recordError(err);
}

// 获取统计信息
const report = stats.getStats();
console.log(report);
// 输出：
// {
//   total: 45,
//   byCategory: {
//     AVAILABILITY: 30,
//     BUSINESS: 10,
//     TRANSIENT: 5
//   },
//   topCodes: [
//     ['ECONNREFUSED', 20],
//     ['TIMEOUT', 10],
//     ['ENOTFOUND', 5]
//   ]
// }

// 重置统计
stats.reset();
```

### 在 CircuitBreaker 中的集成

错误分类器已集成到 CircuitBreaker 中：

```typescript
import { shouldTriggerBreaker } from './error-classifier.js';

export class CircuitBreaker {
  recordFailure(error: unknown): void {
    // 只计算应该触发熔断的错误
    if (!shouldTriggerBreaker(error)) {
      return; // 业务错误不触发熔断
    }

    // 增加失败计数
    this.failureCount++;
    if (this.failureCount >= this.failureThreshold) {
      this.transitionTo("OPEN");
    }
  }
}
```

### 可视化错误处理流程

```
Error 发生
    ↓
classifyError()
    ↓
错误分类
    ├─ AVAILABILITY
    │   ├─ shouldTriggerBreaker → true
    │   ├─ isRetriable → true
    │   └─ severity → "critical"
    │
    ├─ BUSINESS
    │   ├─ shouldTriggerBreaker → false
    │   ├─ isRetriable → false
    │   └─ severity → "info"
    │
    ├─ TRANSIENT
    │   ├─ shouldTriggerBreaker → false
    │   ├─ isRetriable → true
    │   └─ severity → "warning"
    │
    └─ ...
    ↓
采取相应行动
    ├─ 更新熔断器 (if breakerTriggering)
    ├─ 重试操作 (if retriable)
    └─ 记录日志 (with severity)
```

---

## 🔗 集成示例

### 完整集成示例

```typescript
import { getDeviceIdentityPath, listRemoteDeviceIdentities } from './device-identity-manager.js';
import { getEnabledCommands, enableCommand } from './commands/command-catalog.js';
import { classifyError, shouldTriggerBreaker, isRetriable } from './resilience/error-classifier.js';

// 1. 初始化设备身份
const stateDir = getConnectorStateDir();
const remoteIds = ['machine-a', 'machine-b'];
const identityStatus = listRemoteDeviceIdentities(stateDir, remoteIds);
console.log('Device identities:', identityStatus);

// 2. 配置启用的命令
const enabledCommands = getEnabledCommands();
console.log('Enabled commands:', enabledCommands);

// 根据需要启用更多命令
enableCommand('nodes.approve');
enableCommand('gateway.metrics');

// 3. 处理错误时使用错误分类
try {
  await operation();
} catch (err) {
  const classification = classifyError(err);
  console.log('Error classification:', classification);

  if (shouldTriggerBreaker(err)) {
    circuitBreaker.recordFailure(err);
  }

  if (isRetriable(err)) {
    await retryWithBackoff(() => operation());
  }
}
```

---

## 📊 监控和调试

### 查看所有设备身份

```bash
ls -la ~/.openclaw/connector-state/device-identities/
```

### 监控命令状态

```typescript
import { formatCommandList, getCommandStats } from './commands/command-catalog.js';

console.log('Command catalog:');
console.log(formatCommandList(true)); // 仅显示启用的

const stats = getCommandStats();
console.log(`Total: ${stats.total}, Enabled: ${stats.enabled}, Disabled: ${stats.disabled}`);
```

### 错误模式分析

```typescript
import { ErrorStatistics } from './resilience/error-classifier.js';

const stats = new ErrorStatistics();
// ... 收集错误 ...
const report = stats.getStats();
console.log(JSON.stringify(report, null, 2));
```

---

## ✅ 最佳实践

1. **Device Identity**
   - ✓ 定期备份 `device-identities` 目录
   - ✓ 在重新部署时保留设备身份文件
   - ✓ 使用 `clearRemoteDeviceIdentity()` 强制重新配对

2. **命令管理**
   - ✓ 默认只启用基础命令
   - ✓ 根据实际需求动态启用高级命令
   - ✓ 在日志中记录命令启用/禁用事件

3. **错误处理**
   - ✓ 始终使用 `classifyError()` 分类错误
   - ✓ 根据 `shouldTriggerBreaker()` 更新熔断器
   - ✓ 使用 `ErrorStatistics` 监控错误趋势

---

## 🚀 后续增强

- [ ] 支持自定义错误分类规则
- [ ] 提供命令配置文件支持 (YAML/JSON)
- [ ] 添加命令白名单验证 CLI 工具
- [ ] 实现错误模式预测和自动修复

