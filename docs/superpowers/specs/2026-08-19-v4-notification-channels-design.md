# V4 通知渠道 - 设计文档

> 日期：2026-08-19
> 分支：feature/v3-development
> 前置：V3.4 已完成（异常检测、预算告警、站内告警中心已就绪，576 测试通过）

## 现状分析

V3.4 建立了"系统主动发现问题"的能力，但发现问题后**只能被动等待用户登录查看**：

1. **渠道单一**：只有站内告警中心（`AnomalyAlert` 表 + `/alerts` 页面），无邮件、无推送、无短信
2. **无投递追踪**：`AnomalyAlert` 表无 `channel`/`emailSentAt`/`pushSentAt` 等字段，告警产生后是否送达用户完全不可知
3. **无偏好设置**：`User` 模型无任何通知偏好字段，所有家庭成员收到的告警完全相同，无法按类型/严重度/渠道订阅
4. **无实时提醒**：前端顶栏无铃铛图标、无未读数徽章、无实时推送，用户必须主动访问 `/alerts` 页面才能看到新告警
5. **无邮件基础设施**：后端无 `nodemailer`，无 SMTP 配置，无邮件模板
6. **无 Web Push**：虽已安装 `vite-plugin-pwa`，但未配置 VAPID、无 push subscription 管理、无 service worker 推送逻辑
7. **无统一通知抽象**：异常检测和预算告警各自直接写 `AnomalyAlert`，没有统一的通知分发层

## 目标

建立**多渠道通知体系**——告警产生后按用户偏好通过邮件 / Web Push / 站内多通道送达，并在前端提供实时铃铛提醒和偏好设置。

### 非目标（V4 不做）

- 不做短信渠道（Twilio/阿里云短信，留 V5）
- 不做移动端 App 推送（FCM/APNs，留 V5）
- 不做 WebSocket/SSE 实时双向通信（V4 用 60s 轮询 + Web Push 覆盖实时性）
- 不做用户级已读状态重构（`AnomalyAlert.isRead` 保持家庭级，符合家庭财务场景；新增 `NotificationDelivery` 追踪每用户每渠道投递状态）
- 不做可视化邮件模板编辑器（模板硬编码 + Handlebars 变量替换）
- 不做通知摘要/聚合（V4 即时投递；每日摘要留 V5）

## 架构总览

```
告警产生点                通知分发层                  渠道适配器               投递追踪
─────────              ──────────                ────────               ────────
anomalyService     ─┐                                              ┌─→ InAppChannel ─→ NotificationDelivery
budgetAlertService  ─┼─→ notificationDispatcher.dispatch(alert) ─→├─→ EmailChannel  ─→ NotificationDelivery
(未来) sync失败     ─┘    (查询偏好/去重/并行投递)                  └─→ PushChannel   ─→ NotificationDelivery
                                                                                          ↓
                                                                                   前端轮询/SW推送
```

**核心设计原则**：
- **渠道适配器模式**：每个渠道实现统一的 `Channel` 接口（`send(notification, recipient)`），新增渠道只需加适配器
- **偏好驱动**：分发前查询 `NotificationPreference`，用户可按告警类型 + 严重度独立开关每个渠道
- **投递可观测**：每次投递写 `NotificationDelivery`，记录状态/时间/错误，支持重试和排查
- **优雅降级**：渠道未配置（如 SMTP 未设置）时该渠道静默跳过并记日志，不影响其他渠道
- **家庭级告警 + 用户级投递**：`AnomalyAlert` 仍属家庭，分发时遍历家庭成员为每人生成投递记录

## 子任务

### V4.1 通知偏好与数据模型

**问题**：无通知偏好存储、无投递追踪、无 Web Push 订阅存储。

**方案**：

#### Prisma Schema 新增 3 个模型

```prisma
// 用户通知偏好（每个用户-家庭-告警类型一条记录）
model NotificationPreference {
  id           String   @id @default(cuid())
  userId       String
  familyId     String
  alertType    String   // LARGE_EXPENSE | FREQUENCY_SPIKE | CATEGORY_SURGE | DUPLICATE | BUDGET_EXCEEDED | BUDGET_WARNING | SYSTEM
  minSeverity  String   @default("LOW") // HIGH | MEDIUM | LOW - 只推送此严重度及以上
  inAppEnabled Boolean  @default(true)
  emailEnabled Boolean  @default(false)
  pushEnabled  Boolean  @default(false)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  family       Family   @relation(fields: [familyId], references: [id], onDelete: Cascade)

  @@unique([userId, familyId, alertType])
  @@index([userId, familyId])
}

// 投递记录（每次渠道投递一条，追踪状态）
model NotificationDelivery {
  id              String    @id @default(cuid())
  alertId         String
  userId          String
  familyId        String
  channel         String    // IN_APP | EMAIL | WEB_PUSH
  status          String    // PENDING | SENT | FAILED | SKIPPED
  errorMessage    String?
  alertSnapshot   Json      // 投递时告警快照（title/description/amount/severity/type）
  sentAt          DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  alert           AnomalyAlert @relation(fields: [alertId], references: [id], onDelete: Cascade)
  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  family          Family    @relation(fields: [familyId], references: [id], onDelete: Cascade)

  @@unique([alertId, userId, channel])
  @@index([userId, status])
  @@index([familyId, createdAt])
  @@index([status, createdAt])
}

// Web Push 订阅（一个用户可多设备）
model PushSubscription {
  id           String   @id @default(cuid())
  userId       String
  familyId     String?  // 可选：仅订阅某家庭的通知
  endpoint     String   @unique
  p256dh       String
  auth         String
  userAgent    String?
  createdAt    DateTime @default(now())
  lastUsedAt   DateTime?
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

#### User / Family / AnomalyAlert 模型增加反向关系

- `User` 增加：`notificationPreferences NotificationPreference[]`、`notificationDeliveries NotificationDelivery[]`、`pushSubscriptions PushSubscription[]`
- `Family` 增加：`notificationPreferences NotificationPreference[]`、`notificationDeliveries NotificationDelivery[]`
- `AnomalyAlert` 增加：`deliveries NotificationDelivery[]`

#### 偏好默认值策略

新家庭成员首次查询偏好时，若不存在记录，由服务层**惰性创建默认偏好**：
- 所有类型 `inAppEnabled=true`、`emailEnabled=false`、`pushEnabled=false`、`minSeverity=LOW`
- 用户可通过 API 修改

#### 配置模块

新建 `backend/src/config/notification.ts`：
```typescript
export const NOTIFICATION_CONFIG = {
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  emailFrom: process.env.SMTP_FROM || 'noreply@homefinance.local',
  // 重试配置
  maxRetries: 3,
  retryDelayMs: 60_000,
  // 轮询节流
  pollThrottleMs: 60_000,
};

export const isEmailConfigured = (): boolean =>
  Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);
export const isPushConfigured = (): boolean =>
  Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
```

参照 `config/ai.ts` 模式。

#### 路由

新建 `backend/src/routes/notificationPreferences.ts`，挂载到 `/api/families/:familyId/notification-preferences`：
- `GET /` — 获取当前用户在该家庭的所有偏好（惰性创建默认记录）
- `PUT /` — 批量更新偏好（body: `{ preferences: Array<{alertType, minSeverity, inAppEnabled, emailEnabled, pushEnabled}> }`）
- 权限：`checkFamilyAccess(familyId, userId)`

新建 `backend/src/routes/pushSubscriptions.ts`，挂载到 `/api/push-subscriptions`（用户级，不绑定家庭）：
- `POST /` — 订阅（body: `{endpoint, p256dh, auth, userAgent?, familyId?}`）
- `DELETE /` — 取消订阅（body: `{endpoint}`）
- 权限：`authMiddleware`

**测试**：
- Service：惰性创建默认偏好、批量更新、唯一约束冲突处理、severity 过滤逻辑
- Route：GET 惰性创建、PUT 批量更新、鉴权 403、POST/DELETE push subscription、重复订阅幂等

---

### V4.2 邮件通知渠道

**问题**：告警产生后无法通过邮件送达，用户不登录就收不到。

**方案**：

#### 依赖安装

```bash
npm install nodemailer handlebars
npm install -D @types/nodemailer
```

- `nodemailer`：Node 生态最成熟的邮件库，支持 SMTP/SES/SendGrid 等多种 transport
- `handlebars`：轻量模板引擎，用于邮件 HTML 变量替换（不引入全功能模板框架）

#### 配置模块

新建 `backend/src/config/mail.ts`：
```typescript
export const MAIL_CONFIG = {
  host: process.env.SMTP_HOST || '',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true',
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.SMTP_FROM || 'HomeFinance <noreply@homefinance.local>',
};
```

`.env.example` 补充：
```bash
# Email (SMTP)
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=HomeFinance <noreply@homefinance.local>
APP_URL=http://localhost:3000
```

#### 邮件 Channel 适配器

新建 `backend/src/services/channels/emailChannel.ts`：
```typescript
export interface ChannelRecipient {
  userId: string;
  email: string;
  name: string;
}
export interface ChannelMessage {
  alertType: string;
  severity: string;
  title: string;
  description: string;
  amount?: number;
  category?: string;
  familyId: string;
  familyName: string;
  alertId: string;
  createdAt: Date;
}
export interface ChannelResult {
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  errorMessage?: string;
  messageId?: string;
}

export async function sendEmail(
  recipient: ChannelRecipient,
  message: ChannelMessage
): Promise<ChannelResult>
```

- 使用 `nodemailer.createTransport(MAIL_CONFIG)` 创建 transport（模块级单例）
- 未配置 SMTP 时返回 `SKIPPED`
- 邮件主题格式：`[${severityLabel}] ${familyName} - ${title}`（如 `[高] 我的家 - 发现大额支出`）
- HTML 模板用 Handlebars 编译，模板内嵌于代码中（不单独建 .hbs 文件，避免运行时路径问题）：
  - 顶部：家庭名 + 告警标题 + severity 色标
  - 正文：描述
  - 详情：金额（如有）、品类（如有）、时间
  - 底部：`APP_URL/alerts` 链接按钮"查看告警详情"
  - 页脚：HomeFinance 自动发送，去偏好设置关闭

#### 邮件模板设计

模板包含字段：`familyName`、`severityLabel`、`severityColor`、`title`、`description`、`amountFormatted`、`category`、`timeFormatted`、`alertUrl`。

severity 映射：HIGH → 红色 (#dc2626)，MEDIUM → 黄色 (#d97706)，LOW → 灰色 (#6b7280)。

#### 单元测试 Mock 策略

Mock `nodemailer`：
```typescript
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'test-msg-id' }),
  })),
}));
```

测试：
- 未配置 SMTP → SKIPPED
- 配置正常 → SENT，messageId 返回
- SMTP 抛错 → FAILED，errorMessage 记录
- 模板渲染正确（包含 title/description/amount/alertUrl）
- 主题格式正确

---

### V4.3 Web Push 通知渠道

**问题**：用户关闭页面后无法实时收到告警。

**方案**：

#### 依赖安装

```bash
npm install web-push
npm install -D @types/web-push
```

#### VAPID 配置

新建 `backend/src/config/push.ts`：
```typescript
export const PUSH_CONFIG = {
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || '',
  subject: process.env.VAPID_SUBJECT || 'mailto:admin@homefinance.local',
};
```

`.env.example` 补充：
```bash
# Web Push (VAPID keys - generate with: npx web-push generate-vapid-keys)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@homefinance.local
```

应用启动时若 VAPID 已配置，调用 `webpush.setVapidDetails(subject, publicKey, privateKey)`。

#### Push Channel 适配器

新建 `backend/src/services/channels/pushChannel.ts`：
```typescript
export async function sendPush(
  recipient: ChannelRecipient & { pushSubscriptions: PushSubscription[] },
  message: ChannelMessage
): Promise<ChannelResult>
```

- 查询用户所有 `PushSubscription`
- 对每个订阅调用 `webpush.sendNotification(subscription, JSON.stringify(payload))`
- payload 结构：
  ```typescript
  {
    title: message.title,
    body: message.description,
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    tag: `alert-${message.alertId}`,  // 同告警多渠道去重
    data: { alertId: message.alertId, familyId: message.familyId, url: `/alerts` },
    requireInteraction: message.severity === 'HIGH',  // HIGH 级不自动消失
  }
  ```
- 若订阅返回 410 Gone（endpoint 已失效），删除该 `PushSubscription` 记录
- 至少一个订阅发送成功 → SENT；全部失败 → FAILED；无订阅 → SKIPPED

#### 前端 PWA 配置增强

检查 `frontend/vite.config.ts` 中 `vite-plugin-pwa` 配置，确保：
- `registerType: 'autoUpdate'`
- manifest 包含 `name`/`short_name`/`icons`/`theme_color`
- `includeAssets: ['icons/*.png']`（若已有 icon 资源）
- dev 模式启用（`devOptions: { enabled: true }`）便于测试

新建 `frontend/src/services/pushService.ts`：
- `urlBase64ToUint8Array(base64String)` — VAPID 公钥转换
- `subscribeUser()` — 注册 SW + `pushManager.subscribe` + POST 到后端
- `unsubscribeUser()` — 取消订阅 + DELETE 到后端
- `isPushSupported()` — 检测 `'serviceWorker' in navigator && 'PushManager' in window`
- `getSubscriptionStatus()` — 查询当前订阅状态

前端 Service Worker（由 vite-plugin-pwa 自动生成）需添加 push 事件处理。由于 vite-plugin-pwa 生成的 SW 不支持自定义 push 处理代码直接注入，采用**自定义 SW** 方案：新建 `frontend/src/sw.ts`（或 `public/sw.js`），在插件配置中指定 `srcDir`/`filename`，包含：
```javascript
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title || '新通知', {
      body: data.body,
      icon: data.icon,
      badge: data.badge,
      tag: data.tag,
      data: data.data,
      requireInteraction: data.requireInteraction,
    })
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = data.data?.url ? `${self.registration.scope}${data.data.url}` : self.registration.scope;
  event.waitUntil(self.clients.openWindow(url));
});
```

**测试**：
- Service：Mock `web-push` 的 `sendNotification`，测试成功/失败/410 清理/无订阅 SKIPPED
- Service：多订阅部分失败时仍返回 SENT 并记录失败
- Route：POST 订阅、DELETE 取消、重复订阅幂等、未登录 401

---

### V4.4 通知分发服务与告警挂钩

**问题**：告警写入 `AnomalyAlert` 后无自动分发机制，需要统一分发层查询偏好并调用各渠道。

**方案**：

#### 通知分发服务

新建 `backend/src/services/notificationDispatcher.ts`：

```typescript
export interface DispatchResult {
  alertId: string;
  deliveries: Array<{
    userId: string;
    channel: string;
    status: 'SENT' | 'FAILED' | 'SKIPPED';
    errorMessage?: string;
  }>;
}

export async function dispatchAlert(
  alert: AnomalyAlert & { family: Family }
): Promise<DispatchResult>

export async function dispatchAlertForFamily(
  familyId: string
): Promise<DispatchResult[]>
```

**分发流程**：
1. 查询该家庭所有成员（`FamilyMember` include `User`）
2. 对每个成员：
   a. 查询/创建该用户在该家庭的 `NotificationPreference`（按 alert.type 匹配）
   b. 检查 `minSeverity`：若告警严重度低于阈值，跳过所有渠道
   c. 检查 `alertSnapshot` 和去重：`NotificationDelivery` 已有 `(alertId, userId, channel)` 记录则跳过
   d. 按偏好并行投递：
      - `inAppEnabled=true` → 写一条 `channel=IN_APP, status=SENT` 的 delivery（站内无需异步发送）
      - `emailEnabled=true` 且 `isEmailConfigured()` → 调用 `sendEmail`
      - `pushEnabled=true` 且 `isPushConfigured()` → 查询用户 pushSubscriptions 后调用 `sendPush`
   e. 渠道未配置或偏好关闭 → 写 `status=SKIPPED`
3. 每个渠道结果写 `NotificationDelivery`（含 `alertSnapshot` JSON 快照）
4. 单用户/单渠道失败不中断其他投递，错误记入 `errorMessage`

#### 告警产生点挂钩

修改 `backend/src/services/anomalyService.ts` 的 `detectAndSaveAnomalies`：
- 在 `prisma.anomalyAlert.create` 成功后，调用 `dispatchAlert(createdAlert)`（不 await 阻塞主流程，用 `.catch()` 记录错误；或用 `await` 但包裹 try/catch）
- 采用**异步触发**模式：`void dispatchAlert(alert).catch(e => logger.error(...))`，避免告警检测因通知故障而失败

同理修改 `backend/src/services/budgetAlertService.ts` 的 `checkAndSaveBudgetAlerts`。

> **设计决策**：不引入事件总线（EventEmitter），避免过度工程化。直接在 create 后调用 dispatcher，代码直观可测试。未来若触发点增多可再抽取事件层。

#### 定时补偿任务

scheduler.ts 新增：每 30 分钟扫描 `status=PENDING` 或 `status=FAILED` 且 `createdAt > 24h 内` 且重试次数 < 3 的 delivery，重新投递。

- cron: `*/30 * * * *`
- 调用 `retryFailedDeliveries()` 函数（在 notificationDispatcher 中导出）
- 注意：IN_APP 类型无 PENDING（创建即 SENT），只有 EMAIL/WEB_PUSH 会重试

#### 通知查询路由

新建 `backend/src/routes/notifications.ts`，挂载到 `/api/families/:familyId/notifications`：

- `GET /` — 获取当前用户在该家庭的通知投递列表
  - query: `status?`（SENT/FAILED）、`channel?`（IN_APP/EMAIL/WEB_PUSH）、`limit?`（默认 50）
  - 返回 `{ notifications: NotificationDelivery[], unreadCount }`
  - unreadCount = 该用户在该家庭的 `channel=IN_APP, status=SENT` 且无对应已读标记的记录数
  - **注意**：已读状态复用 `AnomalyAlert.isRead`（家庭级）。当 `AnomalyAlert.isRead=true` 时，该告警的所有 IN_APP delivery 视为已读。这样无需新增已读表，避免数据冗余。
- `GET /unread-count` — 返回 `{ unreadCount: number }`，供前端轮询
- `PUT /:id/read` — 标记单条通知对应告警已读（委托到 anomalies 的 markRead 逻辑，或直接 update AnomalyAlert.isRead=true）

**测试**：
- Dispatcher：偏好过滤、severity 阈值、去重、多渠道并行、单渠道失败隔离、快照写入、家庭无成员
- Dispatcher：无偏好记录时惰性创建默认偏好
- Channel 未配置时 SKIPPED
- 重试任务：PENDING/FAILED 重试、超过 24h 不重试、超过 3 次不重试
- Route：GET 列表、unread-count、PUT read、鉴权

---

### V4.5 前端通知中心

**问题**：前端无实时铃铛、无未读提醒、无偏好设置 UI。

**方案**：

#### 全局通知 Store

新建 `frontend/src/stores/notificationStore.ts`（zustand）：
```typescript
interface NotificationStore {
  unreadCount: number;
  notifications: NotificationDelivery[];
  setUnreadCount: (n: number) => void;
  decrementUnread: () => void;
  setNotifications: (list: NotificationDelivery[]) => void;
  clear: () => void;
}
```

#### 铃铛组件

新建 `frontend/src/components/NotificationBell.tsx`：
- 固定在 Layout 顶栏右侧（"欢迎，xxx"文本左侧）
- 铃铛 emoji/SVG 图标，未读数 > 0 时显示红色圆形徽章（数字 > 99 显示 `99+`）
- 点击展开 Popover 下拉面板：
  - 顶部：标题"通知" + "全部已读"按钮
  - 列表：最近 10 条通知，显示 title/description/时间/渠道图标（邮件/推送/站内）
  - 未读项背景高亮
  - 底部："查看全部"链接 → `/alerts`
- 60 秒轮询 `GET /unread-count`（页面可见时才轮询，用 `document.visibilityState` 暂停）
- 点击单条通知 → 标记已读 + 跳转 `/alerts`

#### 偏好设置页面

新建 `frontend/src/pages/NotificationSettingsPage.tsx`：
- 路由：`/settings/notifications`
- 按告警类型分组显示，每行：
  - 告警类型 label + 说明
  - 最低严重度下拉（HIGH/MEDIUM/LOW）
  - 三个 Toggle 开关：站内 / 邮件 / 推送
- 顶部"渠道状态"卡片：
  - 邮件：显示"已启用"/"未配置（请联系管理员配置 SMTP）"
  - 推送：显示"已启用"/"未启用"按钮（未启用时显示"开启浏览器推送"按钮，调用 `subscribeUser()`）
- 底部"保存"按钮，PUT 批量更新
- 从 Layout 侧边栏"设置"组（若不存在则在工具组底部）添加入口

#### AlertsPage 增强

- 页面加载时同时拉取 `notifications`（含渠道投递状态），在每条告警卡片上展示投递状态小图标：
  - 📧 邮件已送达 / ✉️ 邮件未启用 / ❌ 邮件失败
  - 🔔 推送已送达 / 🔕 推送未启用
- 不改动现有筛选/排序/检测逻辑

#### Layout 集成

修改 `frontend/src/components/Layout.tsx`：
- Header 区域引入 `NotificationBell`
- 侧边栏添加"通知设置"入口（可放在"工具"组底部，或新增"设置"组）

#### App.tsx 路由

新增懒加载路由：
```tsx
const NotificationSettingsPage = lazy(() => './pages/NotificationSettingsPage');
// <Route path="/settings/notifications" element={<ProtectedRoute><Layout><NotificationSettingsPage/></Layout></ProtectedRoute>} />
```

#### 前端 Service 层

新建 `frontend/src/services/notificationService.ts`：
- `getNotifications(familyId, params?)`
- `getUnreadCount(familyId)`
- `markNotificationRead(familyId, deliveryId)`
- `getPreferences(familyId)`
- `updatePreferences(familyId, preferences)`
- `subscribePush()`（调用 pushService.subscribeUser）
- `unsubscribePush()`

类型定义与后端 `NotificationDelivery`/`NotificationPreference` 对齐。

**测试**：
- Store：unreadCount 更新、decrement
- 组件：铃铛渲染、徽章显示、Popover 展开、轮询启动/暂停（visibilitychange）、点击标记已读
- 偏好页：表单回填、开关切换、保存调用、渠道状态显示
- Service：API 路径和方法正确

---

## 路由汇总（新增）

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/families/:familyId/notification-preferences` | 获取偏好 |
| PUT | `/api/families/:familyId/notification-preferences` | 批量更新偏好 |
| GET | `/api/families/:familyId/notifications` | 通知投递列表 |
| GET | `/api/families/:familyId/notifications/unread-count` | 未读数 |
| PUT | `/api/families/:familyId/notifications/:id/read` | 标记已读 |
| POST | `/api/push-subscriptions` | 订阅 Web Push |
| DELETE | `/api/push-subscriptions` | 取消订阅 |

## 环境变量新增

```bash
# Email (SMTP)
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=HomeFinance <noreply@homefinance.local>
APP_URL=http://localhost:3000

# Web Push (VAPID)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@homefinance.local
```

未配置时渠道自动降级（SKIPPED），不影响应用启动。

## 数据库迁移

新增 3 张表 + 3 个反向关系字段，部署时需执行：
```bash
cd backend && npx prisma migrate dev --name v4_notification_channels
```

由于本地无数据库（沿用 V3 惯例），TDD 阶段只运行 `npx prisma generate`，迁移在部署时手动执行。

## 前端路由新增

| 路径 | 页面 |
|---|---|
| `/settings/notifications` | NotificationSettingsPage |

## 调度任务新增

| 任务 | Cron | 说明 |
|---|---|---|
| 通知投递重试 | `*/30 * * * *` | 重试 FAILED/PENDING 的 EMAIL/WEB_PUSH 投递（24h 内，<3 次） |

## 测试增量预估

V3.4 基线 576 测试。V4 预估新增约 130-160 个：
- V4.1 偏好与模型：~30
- V4.2 邮件渠道：~20
- V4.3 Web Push 渠道：~25
- V4.4 分发服务 + 路由 + 重试：~45
- V4.5 前端（store/组件/偏好页）：~25

预计 V4 完成后达 **700-730 测试**。

## 依赖变更

**后端新增**：
- `nodemailer` — SMTP 邮件发送
- `handlebars` — 邮件模板渲染
- `web-push` — Web Push 协议

**后端 devDependencies 新增**：
- `@types/nodemailer`
- `@types/web-push`

**前端无新增依赖**（`vite-plugin-pwa` 已存在，浏览器 Push API 原生支持）。

## 风险与缓解

1. **SMTP 凭证泄露**：SMTP_PASS 只走环境变量，不入代码库；`.env.example` 留空
2. **Web Push 浏览器兼容**：Safari 16+ 才支持 Push API，`isPushSupported()` 检测后不支持则隐藏推送开关
3. **通知风暴**：单次检测可能产生多条告警，分发时对每用户每渠道并行但限制并发（Promise.all 即可，量级小无需队列）；`@@unique([alertId, userId, channel])` 防重复投递
4. **VAPID 密钥管理**：文档说明用 `npx web-push generate-vapid-keys` 生成，密钥不入 git
5. **Service Worker 更新**：vite-plugin-pwa `autoUpdate` 模式自动更新，用户无感知
6. **投递性能**：告警检测在每日 8:00/9:00 定时执行，量级可控（家庭数 × 成员数 × 渠道数），无需引入 BullMQ；若未来量级增大再引入 Redis 队列
7. **Prisma Json 字段**：`alertSnapshot` 用 PostgreSQL Json 类型，SQLite 不支持（项目用 PostgreSQL，无问题）

## 实施顺序

由于子任务间有依赖，采用**部分并行**策略：

1. **V4.1（偏好与数据模型）必须先完成**——它定义了所有后续依赖的 Prisma 模型和配置
2. **V4.2（邮件）和 V4.3（Web Push）可并行**——两者都是独立的渠道适配器，互不依赖
3. **V4.4（分发服务）依赖 V4.1+V4.2+V4.3**——需要偏好查询和两个渠道适配器
4. **V4.5（前端）依赖 V4.4 的 API**——但前端铃铛和偏好页可在 V4.1 完成后并行开发（使用 mock 数据），最后联调

建议 TDD 推进顺序：
- 第一批并行：V4.2 + V4.3（渠道适配器，独立可测）
- V4.1 先行（模型 + 偏好路由，为分发铺路）
- V4.4 串联所有渠道
- V4.5 前端集成
