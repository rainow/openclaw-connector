# 可选改进功能快速开始

本指南展示如何快速开始使用三个可选改进功能。

## 🚀 快速示例

### 1. Device Identity 管理

#### 查看所有设备身份

```bash
# 在 Node.js REPL 中运行
node --input-type=module
```

```javascript
import { 
  listRemoteDeviceIdentities, 
  getDeviceIdentityStats 
} from './src/device-identity-manager.js';

const stateDir = `${process.env.HOME}/.openclaw/connector-state`;
const remoteIds = ['machine-a', 'machine-b', 'office-server'];

// 列出所有身份
const status = listRemoteDeviceIdentities(stateDir, remoteIds);
console.table(status);

// 获取统计信息
const stats = getDeviceIdentityStats(stateDir);
console.log('Device Identity Statistics:', stats);
```

#### 清除和重新配对

```javascript
import { clearRemoteDeviceIdentity } from './src/device-identity-manager.js';

const stateDir = `${process.env.HOME}/.openclaw/connector-state`;

// 清除特定远程网关的身份（强制重新配对）
const cleared = clearRemoteDeviceIdentity(stateDir, 'machine-a');
console.log(cleared ? '✓ Device identity cleared' : '✗ Device not found');
```

### 2. 命令支持范围

#### 查看可用命令

```javascript
import { 
  getEnabledCommands, 
  formatCommandList,
  getCommandStats 
} from './src/commands/command-catalog.js';

// 显示已启用的命令
console.log('\n已启用的命令：');
console.log(formatCommandList(true));

// 显示统计信息
const stats = getCommandStats();
console.log('\n命令统计：', stats);
// 输出示例：{ total: 9, enabled: 5, disabled: 4, categories: 3 }
```

#### 动态启用命令

```javascript
import { 
  enableCommand, 
  getEnabledCommands,
  getCommandMetadata 
} from './src/commands/command-catalog.js';

// 启用高级功能
console.log('\n启用更多命令...');
enableCommand('nodes.approve');
enableCommand('gateway.config');
enableCommand('gateway.metrics');

// 查看更新后的列表
const enabled = getEnabledCommands();
console.log('已启用的命令数:', enabled.length);

// 查看特定命令的详情
const meta = getCommandMetadata('nodes.approve');
console.log('nodes.approve:', meta);
```

#### 按分类查看命令

```javascript
import { getCommandsByCategory, getCommandCategories } from './src/commands/command-catalog.js';

// 列出所有分类
const categories = getCommandCategories();
console.log('\n命令分类：', categories);

// 查看各分类的命令
for (const category of categories) {
  const commands = getCommandsByCategory(category, true);
  console.log(`\n${category.toUpperCase()}:`, commands);
}
```

### 3. 错误分类和处理

#### 分类错误

```javascript
import { 
  classifyError, 
  getErrorSeverity,
  getUserFriendlyMessage 
} from './src/resilience/error-classifier.js';

// 示例 1：网络错误
const networkError = new Error('Connection refused');
networkError.code = 'ECONNREFUSED';

const classification = classifyError(networkError);
console.log('网络错误分类：');
console.log('  Category:', classification.category);
console.log('  Should trigger breaker:', classification.breakerTriggering);
console.log('  Is retriable:', classification.retriable);
console.log('  Severity:', getErrorSeverity(networkError));
console.log('  User message:', getUserFriendlyMessage(networkError));

// 示例 2：业务错误
const businessError = new Error('Resource not found');
businessError.code = 'ENOENT';

const bizClassification = classifyError(businessError);
console.log('\n业务错误分类：');
console.log('  Category:', bizClassification.category);
console.log('  Should trigger breaker:', bizClassification.breakerTriggering);
console.log('  Is retriable:', bizClassification.retriable);
console.log('  User message:', getUserFriendlyMessage(businessError));
```

#### 监控错误模式

```javascript
import { ErrorStatistics, classifyError } from './src/resilience/error-classifier.js';

const stats = new ErrorStatistics();

// 模拟记录一些错误
const errors = [
  { msg: 'Connection refused', code: 'ECONNREFUSED' },
  { msg: 'Connection refused', code: 'ECONNREFUSED' },
  { msg: 'Timeout', code: 'TIMEOUT' },
  { msg: 'Not found', code: 'ENOENT' },
  { msg: 'Permission denied', code: 'EACCES' },
];

for (const err of errors) {
  const error = new Error(err.msg);
  error.code = err.code;
  stats.recordError(error);
}

// 生成报告
const report = stats.getStats();
console.log('\n错误统计报告：');
console.log('  总数:', report.total);
console.log('  按分类:', report.byCategory);
console.log('  TOP 错误代码:', report.topCodes);
```

---

## 📋 完整集成示例

### 在启动脚本中的使用

```typescript
// src/index.ts - 启动时的集成示例

import { listRemoteDeviceIdentities } from './device-identity-manager.js';
import { formatCommandList, getCommandStats } from './commands/command-catalog.js';
import { getConnectorStateDir } from './config.js';
import { createLogger } from './logger.js';

const logger = createLogger('startup');
const stateDir = getConnectorStateDir();

// 1. 检查设备身份状态
const remoteIds = config.remotes.map(r => r.id);
const identityStatus = listRemoteDeviceIdentities(stateDir, remoteIds);

logger.info('Device Identity Status', {
  count: identityStatus.length,
  existing: identityStatus.filter(s => s.exists).length,
});

// 2. 显示启用的命令
const commandStats = getCommandStats();
logger.info('Command Catalog Ready', {
  total: commandStats.total,
  enabled: commandStats.enabled,
  categories: commandStats.categories,
});

// 3. 可选：记录命令列表（调试用）
if (process.env.DEBUG_COMMANDS) {
  logger.info('Enabled Commands', {
    list: formatCommandList(true),
  });
}
```

### 在错误处理中的使用

```typescript
// src/bridge.ts - 错误处理中的使用示例

import { classifyError, shouldTriggerBreaker, isRetriable } from './resilience/error-classifier.js';

export class Bridge {
  async handleInvoke(...): Promise<InvokeResult> {
    try {
      // ... 执行命令 ...
    } catch (err) {
      // 分类错误
      const classification = classifyError(err);
      
      // 根据分类采取行动
      if (shouldTriggerBreaker(err)) {
        // 更新熔断器
        breaker.recordFailure(err);
      }
      
      if (isRetriable(err)) {
        // 可以重试（建议实现指数退避）
        logger.warn('Retriable error, consider retrying', { error: err });
      }
      
      // 使用分类来记录日志
      const severity = getErrorSeverity(err);
      logger[severity]('Operation failed', { error: err, category: classification.category });
    }
  }
}
```

---

## 🔧 配置示例

### 在 config.yaml 中启用高级功能

```yaml
# ~/.openclaw/connector/config.yaml

remotes:
  - id: machine-a
    url: ws://192.168.1.10:8000
    enabled: true

# 命令配置（可选）
# 如需自定义启用的命令，可以在这里配置
# 当前所有基础命令都默认启用
commands:
  # enabled: ['nodes.list', 'nodes.invoke', 'sessions.list', ...]
  # disabled: ['nodes.approve']

# 熔断器配置
breaker:
  enabled: true
  failureThreshold: 3
  openMs: 15000
  halfOpenMaxInFlight: 1
```

---

## 📊 监控和调试

### 查看设备身份目录结构

```bash
# 查看所有设备身份文件
ls -la ~/.openclaw/connector-state/device-identities/

# 示例输出
# device-machine-a.json
# device-machine-b.json
# device-office-server.json

# 查看特定设备身份内容
cat ~/.openclaw/connector-state/device-identities/device-machine-a.json
```

### 调试错误分类

```javascript
// 快速测试错误分类

import { classifyError } from './src/resilience/error-classifier.js';

const testCases = [
  { msg: 'Connection refused', code: 'ECONNREFUSED', expectedCategory: 'AVAILABILITY' },
  { msg: 'Not found', code: 'ENOENT', expectedCategory: 'BUSINESS' },
  { msg: 'Interrupted', code: 'EINTR', expectedCategory: 'TRANSIENT' },
];

for (const tc of testCases) {
  const error = new Error(tc.msg);
  error.code = tc.code;
  const result = classifyError(error);
  const pass = result.category === tc.expectedCategory ? '✓' : '✗';
  console.log(`${pass} ${tc.code}: ${result.category}`);
}
```

### 监控命令使用

```bash
# 检查已启用的命令数量
node -e "
  import('./src/commands/command-catalog.js').then(mod => {
    const stats = mod.getCommandStats();
    console.log('Commands: ' + stats.enabled + '/' + stats.total + ' enabled');
  });
"
```

---

## ✅ 验证清单

完成以下检查确保所有功能正常工作：

- [ ] Device Identity 文件在 `~/.openclaw/connector-state/device-identities/` 创建
- [ ] 命令列表包含至少 5 个已启用的命令
- [ ] 能够动态启用/禁用命令
- [ ] 网络错误被分类为 AVAILABILITY
- [ ] 业务错误被分类为 BUSINESS
- [ ] 熔断器与错误分类集成
- [ ] 日志中显示了命令统计信息
- [ ] 日志中显示了设备身份状态

---

## 🚨 常见问题

### Q: 如何重置设备身份？
**A:** 使用 `clearRemoteDeviceIdentity()` 函数或删除对应的文件：
```bash
rm ~/.openclaw/connector-state/device-identities/device-<remote-id>.json
```

### Q: 如何启用所有命令？
**A:** 使用以下代码：
```javascript
import { getAllCommands, enableCommand } from './src/commands/command-catalog.js';

for (const cmd of getAllCommands()) {
  enableCommand(cmd);
}
```

### Q: 业务错误为什么不触发熔断？
**A:** 设计如此。业务错误（如权限拒绝、未找到资源）通常不是临时的网络问题，因此不应该触发熔断。只有网络/可用性错误才会触发。

### Q: 如何自定义错误分类？
**A:** 编辑 `src/resilience/error-classifier.ts` 中的错误代码集合和分类逻辑。

---

## 🔗 相关文档

- [OPTIONAL_ENHANCEMENTS.md](./OPTIONAL_ENHANCEMENTS.md) - 详细的功能文档
- [DEVELOPMENT.md](./DEVELOPMENT.md) - 开发指南
- [PLAN.md](./PLAN.md) - 设计方案

