# Email Campaigns 与 Automations（含 abandoned cart）审计

审计范围：campaigns API/核心库/worker/schema/dashboard，以及 automations API、checkout-reminders、worker、schema/UI。分类：A=后端完整实现且服务端门控；B=后端存在但某入口仅前端/未门控，可绕过；C=缺失/占位；D=部分实现。

## 结论总览

| 子功能 | 分类 | 结论 |
|---|---|---|
| Campaign 记录 CRUD（创建、列表、更新、删除） | A | 通用 feature API 对 campaigns 映射并执行 `requireProFeature`，服务端门控完整。 |
| Campaign 实际发送、个性化、退订、追踪 | A | 发送路由及核心发送逻辑真实可用，发送路由服务端门控。 |
| Campaign 预览收件人 | B | 后端逻辑存在，但 recipients 路由没有 `requireProFeature`；拿到会话即可直接调用。 |
| Campaign 测试邮件 | B | 后端可发测试邮件，但 test 路由没有 PRO 检查，绕过 campaigns license。 |
| Campaign 定时发送 worker | A | worker 通过 scheduler secret 调用已门控 send 路由；有完整查询和失败处理。 |
| Campaign 环境复制 | A | campaigns copy 明确服务端 `requireProFeature("email_campaigns")`。 |
| Abandoned checkout 提醒（调度+发送） | A | 调度、数据库去重、付款后取消、邮件发送均实现；API/业务/worker 都有 automations license 检查。 |
| Automations 设置 API/UI | A | PATCH 服务端要求 automations PRO，UI 调该 API；不是单纯前端锁。 |
| 通用“其他 automations” | C | 未发现 automations 通用路由/工作流模型，现有实现只有 abandoned checkout reminder。 |

## Email campaigns 证据

### 1. CRUD（A）

- `src/app/api/features/[feature]/route.ts:48-60,76-90`：GET/POST 获取 `getDashboardFeatureProRequirement(feature)` 后调用 `requireProFeature`，再处理 campaigns feature。
- `src/app/api/features/[feature]/[id]/route.ts:48-60`：PATCH 同样执行服务端 license 检查；该文件后续 DELETE 也使用相同检查（约 280-300 行）。
- `src/lib/pro-feature-access.ts:20-24`：campaigns 映射为 `email_campaigns`。
- `src/lib/feature-records.config.ts` 将 `campaigns` 注册为 feature；`src/components/dashboard/dashboard-feature.config.ts:272-284` 配置 Campaigns 工作区和表单。

关键片段：
```ts
const proFeature = getDashboardFeatureProRequirement(feature);
if (proFeature) {
  const denied = await requireProFeature(proFeature);
  if (denied) return denied;
}
```

### 2. 实际发送与追踪（A）

- `src/app/api/features/campaigns/[id]/send/route.ts:21-25`：非 scheduler 请求先 `requireProFeature("email_campaigns")`；未登录拒绝。
- 同文件 `:16-20,27-41`：定时 worker 使用 AUTH_SECRET 的 `x-paymug-scheduler` 受控入口，并加载 campaign owner 后调用发送。
- `src/lib/email-campaigns.ts:30-65`：校验 campaign、状态、商店开关、收件人非空；`:67-117` 渲染 subject/content、退订 URL、tracking URL，并写入 `campaignDeliveries`；`:118-157` 发 Cloudflare 邮件并更新 sent 状态及 recipientCount。
- `src/lib/email-campaign-content.ts` 提供占位符、HTML 渲染及点击追踪；`src/lib/email-campaign-tracking.ts:14-30` 更新 open/click 状态和 campaign engagement。
- `src/app/email-preferences/unsubscribe/[campaignId]/[deliveryId]/route.ts` 实现退订页/校验 delivery 与 campaign 归属；open/click 路由位于 `src/app/api/email-campaigns/track/`。
- `src/db/schema.ts:373-388` 定义 `campaignDeliveries` 表及 campaign/email 索引；迁移在 `src/lib/setup-database-migrations.config.ts:77-81`。

### 3. 收件人预览（B）

- `src/app/api/features/campaigns/[id]/recipients/route.ts:6-21` 要求登录并校验 campaign 所有者，但完全没有 `requireProFeature`/`hasProFeature`，直接调用 `getEmailCampaignRecipientPreview` 返回数量与最多 100 个地址。
- `src/lib/email-campaign-recipients.ts` 对 customers/subscribers 进行真实筛选，不是样板数据。

关键片段：
```ts
const campaign = await findFeatureRecord((await params).id, user.id);
if (!campaign || campaign.feature !== "campaigns") return jsonError("Not found", 404);
const preview = await getEmailCampaignRecipientPreview(...);
```
因此 PRO 失效时，虽 CRUD 页面可能不可用，已有/猜到 ID 的用户仍可调用该后端预览接口。

### 4. 测试邮件（B）

- `src/app/api/features/campaigns/[id]/test/route.ts:6-16` 仅检查 session、邮箱格式，然后直接 `sendEmailCampaignTest`，无 `requireProFeature("email_campaigns")`。
- `src/lib/email-campaigns.ts:160-200` 测试邮件真实渲染并调用 Cloudflare Email，不是占位。

这是明确后端绕过点：只要能获得 campaigns 记录 ID，非 PRO 账户仍可能调用测试发送（核心函数本身也未做 license 检查）。

### 5. 定时发送 worker（A）

- `src/worker/email-campaigns.ts:11-20` 查询 `feature='campaigns' AND status='scheduled'` 且 `scheduledAt <= now`，检查 worker 引用和 secret。
- `:21-35` 通过内部 URL + `x-paymug-scheduler` 调 send API；send API 对 scheduler token 做受控认证，正常用户路径要求 PRO。

该 worker 没有独立 license 调用，但实际执行被 send 路由的 scheduler 认证隔离；不应把 scheduler secret 暴露给用户。

### 6. 环境复制（A）

`src/app/api/dashboard/environment/copy/route.ts:13-21` 在 `kind === "campaigns"` 时服务端调用 `requireProFeature("email_campaigns")`，然后 `copyEnvironmentRecords` 执行复制。

## Automations / abandoned cart 证据

### 1. 设置 API 与 Dashboard UI（A）

- `src/app/api/settings/automations/route.ts:11-22` PATCH 先取 session，再 `requireProFeature("automations")`，校验 boolean 并更新 `abandonedCheckoutRemindersEnabled`。
- `src/app/dashboard/automations/page.tsx:6-19` 服务端加载当前 store 并渲染组件；`AbandonedCheckoutAutomation.tsx:14-29` 通过 PATCH API 切换开关并处理失败回滚。UI 没有假装锁定，真正门控在 API。

### 2. 提醒调度（A）

- `src/lib/checkout-reminders.ts:15-23` 同时加载商店与 `hasProFeature("automations")`；商店关闭或非 PRO 时直接返回。启用后 `:36-70` 写入 reminder，1 小时后到期，并按 store/product/environment/email 唯一键 upsert。
- `src/worker/checkout-reminders.ts:23-35` 处理前调用 `workerHasProFeature(env.DB, "automations", now)`；查询到期且未发送/取消的提醒。
- `:37-70` 若已支付则标记 cancelled，否则组装 HTML/text 并发送邮件，成功写入 sent_at；`:71-74` 记录失败。
- `src/db/schema.ts:333-371` 定义 `checkoutReminders`、唯一索引和 due 索引；迁移 SQL 在 `src/lib/setup-database-migrations.config.ts:17-19`。

关键片段：
```ts
if (!(await workerHasProFeature(env.DB, "automations", now))) return result;
...
WHERE cr.due_at <= ? AND cr.sent_at IS NULL AND cr.cancelled_at IS NULL
```

### 3. 通用 automations（C）

Dashboard 只有 `src/app/dashboard/automations/AbandonedCheckoutAutomation.tsx` 及 page；API 只有 `/api/settings/automations`，其 schema 仅 `{ enabled: boolean }`。未发现通用 automation workflow/trigger/action 路由或表，也未发现 `/api/features/automations` 实现。因此产品文案若宣称“automations”泛指多种自动化，目前代码层面仅 abandoned checkout 一项，其他属于缺失（C）。

## 风险与修复建议

1. 将 `requireProFeature("email_campaigns")` 加入 `campaigns/[id]/recipients` GET 与 `campaigns/[id]/test` POST（或在核心函数加防线），避免只靠上游页面/CRUD 门控。
2. 若未来增加 automation 类型，应建立 automation records/schema 与各 trigger/action 服务端门控；当前不要把单一 abandoned checkout 开关描述为通用自动化平台。
3. 保持 scheduler secret 仅 worker 可用；目前 scheduler 分支绕过 PRO 是设计所需，但必须确保 `AUTH_SECRET` 不可由客户端取得。
