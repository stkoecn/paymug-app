# Paymug Pro 许可与门控机制审计

## 1. 许可数据模型与状态机

`src/db/schema.ts:392-410` 定义单行 `app_licenses`（固定 id=`paymug-pro`）：加密密钥及前缀、唯一 `instanceId`、`status`（active/invalid/expired/deactivated）、plan、JSON features、过期时间、最近验证时间、错误与时间戳。无记录即 free。

`src/lib/app-license.ts` 的 `mapLicenseRow`（34-54）把数据库行映射为状态：过期时间已到时 state=expired；仅 status=active 且未过期、features 非空才 `pro=true`/plan=pro，否则 free。`getAppLicenseStatus`（107-179）每 6 小时缓存验证；调用权威服务失败时，active 且最近验证不超过 7 天允许离线宽限，否则 state=invalid、pro=false。注意 schema 没有 free 状态，free 是“无记录/映射后的 plan”，deactivated 在本地删除后也回到 free。

## 2. 激活、验证、停用链路

- 本地入口 `src/app/api/license/route.ts:14-17,19-37,40-49`：GET/POST/DELETE 均要求登录；POST 校验 key 后调用 `activateAppLicense`，DELETE 调用停用。
- `src/lib/app-license.ts:60-105` 通过 HTTPS POST `/v1/licenses/{activate|validate|deactivate}` 调用权威 API，携带产品 ID、实例 ID、实例 URL和版本。
- 激活 `activateAppLicense`（181-216）复用/生成 instance UUID，要求权威响应 valid，使用加密 key upsert `app_licenses` 并立即读取状态。
- 验证 `getAppLicenseStatus`（107-179）写回 status/plan/features/expires/lastValidated/error；网络失败按 7 天离线宽限处理。
- 停用（218-235）先通知权威服务，finally 删除本地 app_licenses 行。
- 权威端 `src/lib/app-license-authority.ts`：查找 live featureRecords license（27-45）；状态计算（47-57）将非 active 映射 invalid、过期映射 expired；激活（78-162）校验产品/环境、席位上限并记录 appActivations；验证（164-209）要求实例已激活后复用激活逻辑；停用（211-255）按产品及 instanceId 移除激活记录。
- 权威 API 路由不需要用户会话（服务间接口）：`src/app/api/v1/licenses/activate/route.ts:4-9`、`validate/route.ts:4-9`、`deactivate/route.ts:4-10`；请求格式校验在 `license-route.utils.ts`。

## 3. 六项 PRO 功能与 Dashboard 映射

`src/lib/app-license.config.ts:7-14` 清单：`email_campaigns`、`automations`、`affiliates`、`pages`、`multi_store`、`private_github`；标签在 16-23。Dashboard 前缀映射在 25-35：campaigns→email_campaigns、automations→automations、affiliates→affiliates、pages→pages、stores→multi_store、settings/github→private_github。`src/lib/pro-feature-access.ts:8-17` 的 `requireProFeature` 统一返回 403；dashboard 辅助映射仅识别 campaigns/affiliate*/pages（19-26），未覆盖 automations、stores、github，说明前端路由守卫不能单独替代 API 门控。

## 4. Worker 门控

`src/worker/app-license.ts:3-30` 直接查询 app_licenses；要求 status=active、存在 last_validated_at、未过期、距验证不超过 7 天，再解析 features 并匹配功能；任一步失败返回 false。调用点仅两处：`src/worker/checkout-reminders.ts:28` 门控 `automations`；`src/worker/affiliate-payout-reports.ts:39` 门控 `affiliates`。因此 worker 任务不会仅依赖前端锁。

## 5. 服务端 requireProFeature 覆盖清单

以下为代码中所有调用（文件:行号）：

- `src/app/api/affiliate/track/route.ts:15` affiliates
- `src/app/api/customer/affiliates/[id]/route.ts:29` affiliates
- `src/app/api/customer/orders/[id]/github-access/route.utils.ts:21` private_github
- `src/app/api/dashboard/environment/copy/route.ts:19` email_campaigns
- `src/app/api/features/[feature]/route.ts:57,85` 动态 proFeature
- `src/app/api/features/[feature]/[id]/route.ts:57,296` 动态 proFeature
- `src/app/api/features/[feature]/import/route.ts:27` 动态 proFeature
- `src/app/api/features/campaigns/[id]/send/route.ts:23` email_campaigns
- `src/app/api/github/oauth/start/route.ts:16` private_github
- `src/app/api/github/repos/route.ts:11` private_github
- `src/app/api/github/settings/route.ts:18` private_github
- `src/app/api/pages/route.ts:10,24` pages
- `src/app/api/pages/[id]/route.ts:18,49` pages
- `src/app/api/products/route.ts:113` private_github（生成/校验私有 GitHub 商品）
- `src/app/api/products/[id]/route.ts:263` private_github
- `src/app/api/settings/automations/route.ts:14` automations
- `src/app/api/settings/growth/route.ts:41,45` affiliates、email_campaigns
- `src/app/api/stores/route.ts:34` multi_store
- `src/app/api/stores/[id]/route.ts:65` multi_store
- `src/app/api/stores/[id]/activate/route.ts:13` multi_store
- `src/app/api/stores/[id]/deactivate/route.ts:13` multi_store
- `src/app/api/stores/[id]/primary/route.ts:13` multi_store
- `src/app/api/stores/[id]/reactivate/route.ts:13` multi_store
- `src/app/api/stores/[id]/affiliates/route.ts:30` affiliates

动态 features 路由依赖 `proFeature` 映射，覆盖 email campaigns/automations/affiliates/pages 等 feature 记录操作；所有列出的专属 API 均在处理前检查许可。

## 6. 未受门控入口与风险

通过对 `src/app/api/**/route.ts` 的调用点检索，未发现明显绕过上述 PRO 业务的同名 API；GitHub、页面、商店、活动、affiliate、automation 入口均有服务端检查。需要重点关注两类边界：

1. `src/app/api/features/*` 是动态 feature 名称，门控安全性取决于 `proFeature` 解析；任何未被映射为 PRO 的名称可能走免费路径，应继续审查该映射实现及 feature 白名单。
2. Worker 只有 checkout-reminders 与 affiliate-payout-reports 两个调用点；若未来新增 PRO 定时任务而忘记调用 `workerHasProFeature`，不会自动获得门控。当前检索未发现第三个 worker 入口。

总体结论：许可基础设施在服务端和 worker 均实施实际门控，非纯前端锁；状态验证含 6 小时缓存和 7 天离线宽限。`app_licenses` 的状态枚举含 deactivated，但停用流程删除记录，实际运行态主要为 active/expired/invalid/free（free 为无记录语义）。
