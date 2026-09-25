# Affiliates（联盟营销）PRO 功能审计

审计结论按 A=后端完整实现且服务端 license 门控、B=后端实现但仅前端加锁、C=代码层面未实现、D=其他。代码行号以当前源码为准。

## 总体结论

Affiliates 并非占位功能：联盟申请、审批数据、追踪点击、归因、订单佣金、仪表盘聚合、客户门户和双周 payout report 均有真实实现。关键 API 在服务端统一调用 `requireProFeature("affiliates")`，通用 feature API 亦通过 `getDashboardFeatureProRequirement` 门控；公共页面/重定向及 worker 也有服务端门控。因此核心能力归类 **A**，未发现仅靠 UI 锁定即可绕过的后端接口（B）。

## 逐功能结论

| 子功能 | 分类 | 证据与理由 |
|---|---|---|
| PRO license 定义及 dashboard 路径门控 | A | `src/lib/app-license.config.ts:7-20` 将 `affiliates` 纳入 PRO 特性并标注 “Affiliate system and portal”；`25-34` 将 `/dashboard/affiliates` 映射到该特性。`src/lib/pro-feature-access.ts:8-17` 无 license 返回 403；`:19-24` 对任意 `affiliate*` feature 推导 affiliates 要求。 |
| 联盟申请（公开 storefront） | A | `src/app/api/stores/[id]/affiliates/route.ts:26-34` POST 首先 `requireProFeature`，然后检查 `store.affiliatesEnabled`；`:43-113` 读取重复申请、生成 code、写入 `feature_records(feature='affiliates')`，并触发站内通知与申请/店主邮件。页面 `src/app/s/[slug]/affiliates/page.tsx:47-55` 同时检查店铺开关和 `hasProFeature`。 |
| Affiliate 管理 API / dashboard 数据 | A | `src/app/api/features/[feature]/route.ts:48-72` GET 与 `:76-89` POST 均在解析 feature 后调用 `requireProFeature`；affiliate GET 使用 `listAffiliateDashboardRecords`。`:97-113` 为 affiliate 自动写入 `storeId/trackingPath`。聚合实现见 `src/lib/affiliate-dashboard.ts:7-71`，按 affiliate、click、referral、payout 计算数量和收益。 |
| 申请人设置 referral username | A | `src/app/api/customer/affiliates/[id]/route.ts:25-31` PATCH 先服务端门控；`:39-69` 校验当前客户邮箱、active 状态及 code 唯一性；`:71-79` 更新 code/trackingPath/usernameSetAt，不能重复设置。 |
| 点击追踪和 cookie 归因 | A | 产品入口 API `src/app/api/affiliate/track/route.ts:14-16` 服务端门控，`:27-50` 检查已发布产品、店铺开关、有效 affiliate 后写入 `affiliate-clicks`；`:54-76` 设置 HttpOnly 30 天 cookie。公共短链 `src/app/r/[storeSlug]/[code]/route.ts:14-31` 同样在重定向前调用 `hasProFeature`，`:37-56` 查找 affiliate 并记录点击，`:61-83` 按 first/last click 更新 cookie。核心查找也在 `src/lib/commerce-features.ts:93-117` 检查 license、店铺开关和 active code。 |
| 订单转化、佣金计算及 recurring/one-time 规则 | A | `src/lib/commerce-features.ts:214-218` 仅在 `hasProFeature('affiliates')` 时进入；`:219-240` 加载 affiliate/store、去重 referral 并校验 `affiliatesEnabled` 与佣金周期；`:240-259` 写入 `affiliate-referrals`，保存金额、佣金、类型、周期和客户邮箱。schema 店铺佣金字段见 `src/db/schema.ts:54-71`，订单 affiliateId 见 `:275`。 |
| 店主 payout 结算 | A | `src/lib/affiliate-payouts.ts:9-40` 按已批准 referral 金额更新 paid/payoutId/paidAt；`:42-68` 对 payout report 关联 referral 批量结算。API 层入口位于 `src/app/api/features/[feature]/route.ts`（affiliate feature 的操作先走 PRO 门控）。 |
| 双周 payout report worker | A | `src/worker/affiliate-payout-reports.ts:35-41` 入口调用 `workerHasProFeature(database, 'affiliates')`，无 license 直接返回 0；`:42-72` 查询 affiliate/referral/payout 和已启用店铺，`:78-131` 过滤未支付 referral、计算双周金额，`:132-161` 插入 `affiliate-payouts` 并给 referral 写 payoutReportId。 |
| 客户 Affiliate 门户（申请状态、链接、分析、payout） | A | `src/lib/customer-affiliate-portal.ts:19-23` 数据加载首行服务端 license 门控；`:50-124` 按客户订单/订阅找到所属店铺，构建 available/pending/rejected/active 状态；`:126-189` 聚合 click/referral/commission/payout、转化率、时间序列和近期购买。页面 `src/app/customer/affiliate/page.tsx:6-11` 要求客户会话，无项目则重定向；UI 组件包括 `CustomerAffiliatePortal.tsx`、`CustomerAffiliateAnalytics.tsx`、`CustomerAffiliatePayoutsPortal.tsx`、`CustomerAffiliateProductsPortal.tsx`。 |
| 公开 affiliates 首页 | A | `src/app/affiliates/page.tsx:11-16` 找到启用店铺后复用公开联盟页；复用页面 `src/app/s/[slug]/affiliates/page.tsx:50-53` 仍执行 `store.affiliatesEnabled` + `hasProFeature` 服务端检查，不是仅 UI 锁定。 |
| 联盟邮件/通知 | A | `src/lib/affiliate-application-email.ts:7-14`、`src/lib/affiliate-application-email-template.ts:6-28` 真实生成申请确认邮件；`src/lib/affiliate-decision-email.ts:7-14`、`src/lib/affiliate-decision-email-template.ts:5-41` 真实生成审批结果邮件，并由申请 API 触发。 |
| affiliate_* 数据 schema | D（实现采用通用记录表） | `src/db/schema.ts:54-71` 是店铺联盟开关/佣金字段，`:275` 是订单 affiliateId；联盟实体和 clicks/referrals/payouts 不是独立 `affiliate_*` SQL 表，而是 `feature_records.feature` 值（配置见 `src/lib/feature-records.config.ts:10`，读写见 `src/lib/commerce-features.ts:104-107,157-168,221-259`）。因此不存在独立 affiliate 表并不表示功能缺失。 |

## B/C 检查

- **未发现 B**：公开申请、点击追踪、customer username PATCH、dashboard feature GET/POST、店主设置 PATCH 均在 API 函数内调用 `requireProFeature`；公共页、短链和 customer portal 也有服务器检查。绕过前端后直接调用接口仍会收到 403（无 license）。
- **未发现 C**：邮件模板、追踪 cookie、订单归因/佣金、客户统计、payout worker 都是可执行实现而非 TODO/空占位。`affiliate-settings.utils.ts` 提供佣金计算与 cookie-store 匹配辅助；`affiliate-dashboard.ts` 和 `customer-affiliate-portal.ts` 提供实际聚合。

## 注意事项

联盟数据依赖通用 `feature_records`，故审计或迁移时应按 feature 值 `affiliates`、`affiliate-clicks`、`affiliate-referrals`、`affiliate-payouts` 查询，而不能只搜索独立 affiliate 表。店铺必须显式 `affiliatesEnabled`，即使拥有 PRO license 也不会公开申请或生成佣金。
