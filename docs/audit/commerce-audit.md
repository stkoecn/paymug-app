# Commerce PRO 功能审计

## Multi-store（多店铺）

**结论：A（服务端完整实现且有 PRO 门控）。**

- 创建/查询 API：`src/app/api/stores/route.ts:15-23` 返回活动店铺及用户店铺列表；`25-49` 在已有店铺时调用 `requireProFeature("multi_store")`（32-36），因此新增第二店铺有服务端门控。
- 核心创建与切换：`src/lib/stores.ts:138-198` 生成 slug、写入 `stores` 并同步 users.activeStoreId/primaryStoreId；`201-217` activate；`219-257` deactivate（禁止停用最后一个活动店铺并选择替代店）；`260-284` reactivate/setPrimary；`287-379` 更新名称、域名、slug 等。这不是占位逻辑。
- 其他店铺操作也保护到服务端：`src/app/api/stores/[id]/route.ts:52-87` 非当前店铺修改要求 `requireProFeature("multi_store")`（64-67）；激活/停用/重新激活/primary 路由调用 stores 核心函数并验证用户归属。公开 affiliate 申请在 `src/app/api/stores/[id]/affiliates/route.ts:26-34` 强制 `requireProFeature("affiliates")`，并按 storeId 写入申请（43-113）。
- Schema：`src/db/schema.ts:28-110` 的 stores 表含 userId、slug 唯一索引、domain、isActive、凭据来源等；users 的 activeStoreId/primaryStoreId 用于切换。未发现 `store_limit` 字段或硬编码数量上限；限制策略是“首店免费，创建额外店铺需 PRO”，而不是数量 limit。
- Dashboard UI：`src/app/dashboard/stores/StoresWorkspace.tsx:24-56` 通过 POST `/api/stores` 创建、调用 `/activate` 切换；`98-120` 提供 Add another store 表单。UI 本身没有可靠的 license 判定，但 API 门控不可绕过，故归 A。
- 域名/商店路由：`src/app/api/stores/[id]/route.ts:7,68-72` 规范化域名后持久化；当前代码树未找到 `store-domain-redirect.ts` 文件（无该实现文件），但域名字段与更新链路已存在，缺失独立 redirect 中间件应作为 D/附带缺口记录。

## Private GitHub（私有仓库交付）

**结论：A（端到端后端实现且关键入口均服务端 PRO 门控；运行仍依赖 GitHub OAuth/加密环境配置）。**

- 设置与仓库 API：`src/app/api/github/settings/route.ts:15-31` PATCH 首先 `requireProFeature("private_github")`；`src/app/api/github/repos/route.ts:8-18` GET 同样门控，再解密连接 token、列出私有仓库并标记 admin 权限（21-38）。
- OAuth 流程：`src/app/api/github/oauth/start/route.ts:13-35` 会话校验、PRO 门控、检查 ENCRYPTION_SECRET、生成 state cookie 并重定向授权；`src/app/api/github/oauth/callback/route.ts:25-108` 校验 state/code、兑换 token、要求 repo scope（53-68）、读取 viewer、加密保存连接并绑定活动店铺凭据（71-98），异常阶段记录并重定向错误。OAuth 是实际流程而非占位；是否可运行取决于 GITHUB_CLIENT_ID/SECRET、ENCRYPTION_SECRET 等配置（`src/app/dashboard/settings/github/page.tsx:68-73,95-127`）。注意 callback 本身未显式 `requireProFeature`，但 start/settings/repos 等入口有门控；理论上直接构造 callback 可触发 OAuth 存储，属于门控覆盖不完全的边界风险。
- 产品字段校验：`src/app/api/products/route.ts:71-72,112-133` 以及 `[id]/route.ts:253-270` 对 GitHub owner/name 变更调用 `requireProFeature("private_github")` 和 `validateGitHubProductRepository`；`src/lib/github-products.ts:11-39` 验证 seller 连接及 admin repository，`41-90` 校验购买者用户名/公开邮箱并解析 GitHub identity。
- 订单交付：`src/lib/github-access.ts:110-169` `grantGitHubOrderAccess` 要求产品仓库、买家 username，并在 115 行 `hasProFeature("private_github")` 服务端拦截；获取连接后调用 GitHub collaborator invitation 并记录 invited/existing 状态。支付完成路径明确触发：`src/app/api/payments/paypal/capture-order/route.ts:22,45-49`、`src/lib/stripe-order.ts:10,33-37`、`src/lib/commerce-features.ts:18,185`。撤销及许可证同步在 `github-access.ts:172-300` 实现。
- 客户主动申请 API：`src/app/api/customer/orders/[id]/github-access/route.utils.ts:15-52` POST 会话校验并 `requireProFeature("private_github")`（21-22），调用 `inviteCustomerGitHubAccess`；DELETE 撤销（55-73）未显式 PRO 检查，但底层订单/交付逻辑仍校验关联数据。
- Schema 与 UI：`src/db/schema.ts:208-209` products.githubRepoOwner/Name；`260-299` orders 保存仓库、买家 username、invitation/status/error/timestamps；`412-421` githubConnections 保存加密 token、scope、账号。Dashboard GitHub 页面 `src/app/dashboard/settings/github/page.tsx:48-93,132-160` 展示 OAuth 配置、连接状态和授权入口，配套 `GitHubCallbackSettingsForm` 调 settings API。

### 子功能分类摘要

| 子功能 | 分类 | 依据 |
|---|---|---|
| 多店创建/切换/停用/主店 | A | API + `lib/stores.ts` 完整实现；新增店及非当前店修改服务端 `multi_store` 门控 |
| 多店 schema / store limit | D | stores 表完整；未发现 `store_limit` 数量限制字段，采用额外店 PRO 策略 |
| 多店 Dashboard | A | UI 调用真实 API，安全性由 API 门控保证 |
| 域名更新 | A | route 更新并规范化 domain；独立 `store-domain-redirect.ts` 文件缺失（该附属能力为 D） |
| GitHub OAuth / 连接 / 仓库列表 | A（边界见上） | state、scope、token 加密、连接持久化均实现；入口 PRO 门控，callback 直达门控覆盖不完整 |
| 私有仓库产品字段校验 | A | products API 服务端 PRO + repository admin 校验 |
| 购买后 GitHub 邀请/撤销 | A | 支付路径触发，`grantGitHubOrderAccess` 服务端 `hasProFeature`，状态持久化与撤销完整 |
| 客户订单 GitHub 申请 | A | POST 服务端 `requireProFeature`；DELETE 缺少显式门控，属于轻微覆盖不一致 |
