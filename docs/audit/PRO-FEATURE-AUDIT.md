# Paymug PRO 功能逐项审计报告

> 审计范围：当前代码树中 PRO 清单的六项功能：`email_campaigns`、`automations`、`affiliates`、`pages`、`multi_store`、`private_github`。本报告只记录代码层面的实现、服务端 license 门控、前端锁定能否绕过，以及明确缺失/边界。行号按审计时源码及分项报告记录。

## 分类定义

- **A：完整实现 + 服务端门控**。核心业务可执行，关键 API/服务端入口检查 `requireProFeature` 或 `hasProFeature`（worker 使用 `workerHasProFeature`）。绕过 UI 直接调用通常仍被拒绝。
- **B：后端已有实现，但仅前端锁或某后端入口未门控**。已有账户/记录时可直接调用未保护 API，因而可能绕过 PRO。
- **C：代码层面未实现**。仅有开关、页面或占位，缺乏宣称的业务工作流/数据模型/执行逻辑。
- **D：部分实现或架构/附属差异**。不能简单归 A/B/C，例如采用通用表、专用路由分流、缺少非核心附属能力；不等于核心功能不存在。

## 结论总览

| PRO 功能 | 核心结论 | 细分分类 | 未门控/缺失要点 |
|---|---|---|---|
| `email_campaigns` | 核心 CRUD、发送、追踪、定时及复制完整且服务端门控 | A；收件人预览与测试邮件为 B | `campaigns/[id]/recipients`、`campaigns/[id]/test` 未调用 PRO 检查 |
| `automations` | 实际实现的是 abandoned checkout reminder | A（该能力）；C（通用 automation） | 通用 trigger/action/workflow 未实现；设置 API与 worker有门控 |
| `affiliates` | 联盟申请、归因、佣金、门户、payout 等完整且服务端门控 | A；通用表结构记 D | 未发现可绕过的核心 API；实体使用 `feature_records` 而非独立表 |
| `pages` | CMS CRUD、编辑器、发布渲染、metadata 完整且服务端门控 | A；通用 features API 分流记 D | `/api/features/[feature]` 对 pages 404 是有意分流，不是缺失 |
| `multi_store` | 多店创建、切换、停用、主店和域名更新完整，额外店服务端门控 | A；store limit/redirect 附属记 D | 没有 `store_limit` 字段；独立 `store-domain-redirect.ts` 缺失 |
| `private_github` | OAuth、连接、仓库校验、支付后邀请/撤销完整，关键入口服务端门控 | A（边界覆盖不一致） | OAuth callback 未显式门控；客户 DELETE 撤销未显式门控 |

## 1. 许可基础设施与判定依据

- 六项清单及 Dashboard 映射在 `src/lib/app-license.config.ts:7-35`；`src/lib/pro-feature-access.ts:8-17` 的 `requireProFeature` 无许可时返回 403。动态 feature API 使用 `getDashboardFeatureProRequirement` 后再检查。
- 本地许可状态及离线宽限见 `src/lib/app-license.ts:34-54,107-179`；激活/验证/停用 API 见 `src/app/api/license/route.ts:14-49`。worker 侧 `src/worker/app-license.ts:3-30` 要求 active、未过期且最近验证不超过 7 天。
- 当前 worker 明确门控：`src/worker/checkout-reminders.ts:28` 检查 `automations`，`src/worker/affiliate-payout-reports.ts:39` 检查 `affiliates`。这意味着这些异步业务不是仅依赖前端页面锁。
- 动态 feature 路由门控点：`src/app/api/features/[feature]/route.ts:48-99`、`src/app/api/features/[feature]/[id]/route.ts:48-60,约280-300`、`src/app/api/features/[feature]/import/route.ts:27`。专用 API 也在下文逐项列出。

## 2. `email_campaigns`（Email Campaigns）

### 2.1 核心实现与门控：A

- **记录 CRUD：A。** `src/app/api/features/[feature]/route.ts:48-60,76-90` 和 `[id]/route.ts:48-60、约280-300` 通过 `getDashboardFeatureProRequirement(feature)` 获取要求并调用 `requireProFeature`；`src/lib/pro-feature-access.ts:20-24` 将 campaigns 映射为 `email_campaigns`。`src/lib/feature-records.config.ts` 注册 campaigns，Dashboard 配置见 `src/components/dashboard/dashboard-feature.config.ts:272-284`。
- **真实发送/个性化/退订/追踪：A。** `src/app/api/features/campaigns/[id]/send/route.ts:21-25` 对普通请求服务端检查 `email_campaigns`；`src/lib/email-campaigns.ts:30-157` 校验状态、店铺开关和收件人，渲染内容、退订/追踪 URL，写 delivery，调用 Cloudflare 邮件并更新发送状态。退订见 `src/app/email-preferences/unsubscribe/[campaignId]/[deliveryId]/route.ts`，open/click 见 `src/app/api/email-campaigns/track/`；表结构见 `src/db/schema.ts:373-388`。
- **定时发送：A。** `src/worker/email-campaigns.ts:11-35` 查询到期 scheduled campaign，并以 scheduler secret 调受保护的 send API；send 路由的 scheduler 分支是受控内部认证，不是客户端可用的免费路径。
- **环境复制：A。** `src/app/api/dashboard/environment/copy/route.ts:13-21` 对 `kind === "campaigns"` 调用 `requireProFeature("email_campaigns")`。

### 2.2 后端绕过点：B

- **收件人预览：B。** `src/app/api/features/campaigns/[id]/recipients/route.ts:6-21` 只检查 session、campaign 所有者和 feature 类型，直接调用 `getEmailCampaignRecipientPreview`；没有 `requireProFeature`/`hasProFeature`。后端筛选是真实实现（`src/lib/email-campaign-recipients.ts`），因此不是 C，而是已有实现但可绕过 PRO。
- **测试邮件：B。** `src/app/api/features/campaigns/[id]/test/route.ts:6-16` 仅检查 session 和邮箱格式，直接调用真实发送的 `sendEmailCampaignTest`（`src/lib/email-campaigns.ts:160-200`），没有 `email_campaigns` 检查。拥有/猜到 campaign ID 的非 PRO 用户理论上可直接调用。

### 2.3 小结

Email campaigns 不能笼统称为“仅前端加锁”：发送、CRUD、复制等主链路确实有服务端门控（A）；但 recipients 预览与 test 两个后端入口明确属于 B，应补充 `requireProFeature("email_campaigns")` 或在核心函数增加防线。

## 3. `automations`

### 3.1 Abandoned checkout reminder：A

- 设置 API：`src/app/api/settings/automations/route.ts:11-22` 的 PATCH 先 session 校验，再 `requireProFeature("automations")`，只更新 `abandonedCheckoutRemindersEnabled`。
- 调度与去重：`src/lib/checkout-reminders.ts:15-23` 检查商店和 `hasProFeature("automations")`，启用时 `:36-70` 写入 reminder，按 store/product/environment/email 做唯一约束及延迟调度。
- Worker：`src/worker/checkout-reminders.ts:23-35` 用 `workerHasProFeature(env.DB, "automations", now)` 门控；`:37-74` 处理已付款取消、HTML/text 邮件发送、sent_at 及失败记录。schema/索引见 `src/db/schema.ts:333-371`，迁移见 `src/lib/setup-database-migrations.config.ts:17-19`。
- Dashboard UI `src/app/dashboard/automations/page.tsx:6-19`、`AbandonedCheckoutAutomation.tsx:14-29` 只是调用受保护 API；真正门控在 API、业务库和 worker，故不是 B。

### 3.2 通用 Automation workflow：C

Dashboard 只有 abandoned checkout 组件，API 只有 `/api/settings/automations` 且 schema 仅 `{ enabled: boolean }`。未发现通用 automation records/schema、trigger/action 路由、workflow 执行器或 `/api/features/automations` 实现。因此如果产品文案中的 “automations” 意味着多种自动化，除 abandoned checkout 外均为代码缺失（C），不能把单一开关当作通用平台。

## 4. `affiliates`

### 4.1 核心能力：A

- **许可注册/申请：A。** `src/lib/app-license.config.ts:7-20,25-34` 注册 affiliates；`src/app/api/stores/[id]/affiliates/route.ts:26-34` POST 首先 `requireProFeature`，随后检查 `affiliatesEnabled`、重复申请、生成 code，`:43-113` 写记录并发通知/邮件。
- **管理 API/仪表盘：A。** `src/app/api/features/[feature]/route.ts:48-72,76-89` 对动态 affiliate feature 先门控；聚合逻辑在 `src/lib/affiliate-dashboard.ts:7-71`。
- **客户设置 referral username：A。** `src/app/api/customer/affiliates/[id]/route.ts:25-31` 服务端门控，`:39-79` 校验邮箱、active 状态、code 唯一性后更新。
- **点击追踪与归因：A。** `src/app/api/affiliate/track/route.ts:14-16,27-76` 与 `src/app/r/[storeSlug]/[code]/route.ts:14-31,37-83` 均进行 license/店铺开关/affiliate 有效性检查并设置 HttpOnly cookie；`src/lib/commerce-features.ts:93-117` 也有核心校验。
- **订单转化、佣金及 recurring/one-time：A。** `src/lib/commerce-features.ts:214-259` 在 `hasProFeature('affiliates')` 后校验归因、佣金周期并写 referral；相关字段在 `src/db/schema.ts:54-71,275`。
- **payout 与双周 worker：A。** `src/lib/affiliate-payouts.ts:9-68` 真实结算；`src/worker/affiliate-payout-reports.ts:35-41` worker 门控，`:42-161` 查询、计算并持久化报告。
- **客户门户、公开页面、通知邮件：A。** `src/lib/customer-affiliate-portal.ts:19-23,50-189` 服务端门控并聚合状态/点击/佣金/payout；`src/app/customer/affiliate/page.tsx:6-11` 要求会话；公开页 `src/app/s/[slug]/affiliates/page.tsx:47-55` 检查店铺开关及 `hasProFeature`；邮件模板见 `src/lib/affiliate-application-email*.ts`、`affiliate-decision-email*.ts`。

### 4.2 D：通用记录表架构，不是缺失

联盟实体、clicks、referrals、payouts 使用 `feature_records.feature` 值，而非独立 affiliate SQL 表；配置见 `src/lib/feature-records.config.ts:10`，读写见 `src/lib/commerce-features.ts:104-107,157-168,221-259`。这是统一存储设计，不能因搜索不到独立 `affiliate_*` 表判 C。未发现 B/C 核心功能。

## 5. `pages` / CMS

### 5.1 页面全链路：A

- **注册和 Dashboard：A。** `src/lib/app-license.config.ts:7-14,16-35` 注册 pages 并映射 `/dashboard/pages`；`src/app/dashboard/layout.tsx:15-16,74-76` 以 `DashboardProFeatureGate` 包裹管理内容。
- **列表/创建：A。** `src/app/api/pages/route.ts:7-18,21-37` 在 GET/POST 中执行 session + `requireProFeature("pages")`，随后 schema 校验和 `listStorePages/createStorePage`。
- **更新/删除及编辑器保存：A。** `src/app/api/pages/[id]/route.ts:12-40,43-61` 的 PATCH/DELETE 先服务端 license 检查，再做用户/store/environment 归属校验和持久化；`src/app/dashboard/pages/PageEditor.tsx:43-104` 仅调用这些 API，绕过 UI 仍会 403。
- **数据模型/slug/status：A。** `src/lib/store-pages.ts:22-153` 实现列表、slug 规范化/保留路径/重复校验、创建更新删除；统一 `feature_records` schema 见 `src/db/schema.ts:465-503`，页面记录以 `feature="pages"` 存 data。
- **编辑器入口：A。** `src/app/page-editor/new/page.tsx:6-10`、`src/app/page-editor/[id]/page.tsx:8-21` 服务端检查 session、`hasProFeature("pages")` 和归属；编辑器支持标题、slug、描述、封面、正文、发布状态及导航设置（`PageEditor.tsx:17-37,124-153,182-251`）。
- **公开页面渲染：A。** `src/app/pages/[slug]/page.tsx:20-26,37-110` 先 `hasProFeature("pages")`，未授权 `notFound()`，仅渲染 published；多店路径 `src/app/s/[slug]/[pageSlug]/page.tsx:20-50` 与根别名 `src/app/[pageSlug]/page.tsx:10-19` 同样继承门控。
- **metadata：A。** `src/app/pages/[slug]/page-metadata.utils.ts:12-17,31-52` 许可失败返回 not-found metadata 且 `robots.index=false`；根别名委托同一逻辑。

### 5.2 D：通用 API 有意分流

`src/app/api/features/[feature]/route.ts:48-73,76-99` 明确在 `!isDashboardFeatureKey(feature) || feature === "pages"` 时返回 404；Pages 走专用 `/api/pages`，并非占位或漏实现。核心 pages/CMS 未发现 B/C。

## 6. `multi_store`（多店铺）

### 6.1 核心能力：A

- 创建/列表：`src/app/api/stores/route.ts:15-23,25-49` 真实读取店铺；已有店铺时创建新店在 `:32-36` 调 `requireProFeature("multi_store")`，即首店免费、额外店 PRO。
- 核心存储与切换：`src/lib/stores.ts:138-198` 创建 slug、写入 stores 并同步 active/primary；`:201-284` activate/deactivate/reactivate/setPrimary；`:287-379` 更新名称、域名、slug。不是占位。
- 其他操作门控：`src/app/api/stores/[id]/route.ts:52-87` 对非当前店修改在 `:64-67` 要求 multi_store；`activate/deactivate/primary/reactivate` 路由（各 `route.ts:13`）调用真实 stores 函数并做归属校验。Dashboard `src/app/dashboard/stores/StoresWorkspace.tsx:24-56,98-120` 调真实 API，UI 不是安全边界但 API 是。
- Schema：`src/db/schema.ts:28-110` 有 userId、slug 唯一索引、domain、isActive 等；没有 `store_limit` 字段或硬编码数量上限。策略不是数量限制，而是“首店免费、额外店需要 PRO”。

### 6.2 D：附属域名能力差异

域名规范化及更新在 `src/app/api/stores/[id]/route.ts:7,68-72` 存在；但代码树中没有独立 `store-domain-redirect.ts` 文件。故域名字段/更新链路为 A，独立 redirect 中间件作为附属缺口记 D，不应把整个 multi-store 判 C。

## 7. `private_github`

### 7.1 端到端能力：A（有门控覆盖边界）

- **设置/仓库列表：A。** `src/app/api/github/settings/route.ts:15-31` PATCH 与 `src/app/api/github/repos/route.ts:8-18` GET 先 `requireProFeature("private_github")`；后者解密连接 token、列出私有仓库并标记 admin（`:21-38`）。
- **OAuth 连接：A，callback 覆盖需注意。** `src/app/api/github/oauth/start/route.ts:13-35` 做 session、PRO、加密配置、state cookie 和授权跳转；`src/app/api/github/oauth/callback/route.ts:25-108` 校验 state/code、兑换 token、要求 repo scope（`:53-68`）、读取 viewer、加密保存连接并绑定店铺（`:71-98`）。流程真实可执行，依赖 GitHub client 与 `ENCRYPTION_SECRET`。但 callback 本身没有显式 `requireProFeature`，若构造合法 state/code 直达 callback，理论上可能绕过 start 的门控，记录为边界风险而非把 OAuth 判 C/B 整体。
- **产品字段/仓库 admin 校验：A。** `src/app/api/products/route.ts:71-72,112-133`、`src/app/api/products/[id]/route.ts:253-270` 变更 GitHub owner/name 时调用 PRO 和 `validateGitHubProductRepository`；`src/lib/github-products.ts:11-90` 校验 seller 连接、仓库 admin、买家用户名/公开邮箱及 identity。
- **支付后邀请与撤销：A。** `src/lib/github-access.ts:110-169` 的 `grantGitHubOrderAccess` 在 `:115` 以 `hasProFeature("private_github")` 拦截，调用 GitHub collaborator invitation 并记录状态；支付触发点为 `src/app/api/payments/paypal/capture-order/route.ts:22,45-49`、`src/lib/stripe-order.ts:10,33-37`、`src/lib/commerce-features.ts:18,185`；撤销/同步在 `github-access.ts:172-300`。
- **客户主动申请：A（DELETE 例外）。** POST `src/app/api/customer/orders/[id]/github-access/route.utils.ts:15-52` 有 session 和 `requireProFeature`；DELETE `:55-73` 未显式 PRO 检查，虽仍受订单/交付关联数据约束，属轻微门控覆盖不一致。
- **数据/UI：A。** products GitHub 字段见 `src/db/schema.ts:208-209`，orders 交付状态见 `:260-299`，连接及加密 token 见 `:412-421`；Dashboard 页面见 `src/app/dashboard/settings/github/page.tsx:48-160`。

## 8. 未门控入口、真实缺失与风险清单

1. **必须修复的明确 B：** `src/app/api/features/campaigns/[id]/recipients/route.ts:6-21` 与 `src/app/api/features/campaigns/[id]/test/route.ts:6-16` 缺少 `email_campaigns` 检查；建议入口和核心函数双重防线。
2. **真实 C：** automations 除 abandoned checkout 外没有通用 workflow/trigger/action 模型或执行路由，不能按通用 automation 宣称已实现。
3. **架构/附属 D：** affiliates、pages 使用通用 `feature_records` 或专用路由分流；multi-store 缺少独立 redirect 文件。这些不等于核心 PRO 功能缺失。
4. **覆盖不一致边界：** `src/app/api/github/oauth/callback/route.ts` 未显式 PRO；客户 GitHub revoke DELETE（`route.utils.ts:55-73`）未显式 PRO。建议补门控或在底层函数确认 license，防止直达入口。
5. scheduler/worker 的受控 secret 与 worker license 检查不可移除：campaign scheduler 通过受控 send API；automations、affiliates worker 已显式 `workerHasProFeature`。

## 最终回答

Paymug 的六项 PRO 清单**并非全部占位，也并非全部只是前端加锁**：Pages/CMS、Affiliates、Multi-store、Private GitHub 以及 Email campaigns 的主要 CRUD/发送链路都有真实后端实现和服务端 license 门控，属于 A；abandoned checkout automation 也属于 A。另一方面，Email campaigns 的收件人预览和测试邮件是已实现但后端入口缺少 PRO 检查的 B，可被绕过；通用 automation workflow 在代码层面没有实现，属于 C。Affiliate/Pages 的通用表或路由 404 是架构选择，multi-store 的独立域名 redirect 是附属 D；Private GitHub callback 与撤销 DELETE 是应补强的门控边界。