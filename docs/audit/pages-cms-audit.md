# Pages 与 CMS PRO 功能审计

审计范围：页面数据模型、编辑/管理 API、编辑器与 Dashboard、公开页面渲染及 metadata、license 门控。分类：A=实现完整且服务端门控；B=后端实现但仅前端加锁；C=未实现；D=其他。

## 总结

Pages/CMS 不是占位功能：页面 CRUD、草稿/发布、slug 校验、导航位置、封面及富文本内容均有实现，且保存/删除 API 在服务端调用 `requireProFeature("pages")`。公开页面在服务端渲染入口同样检查 `hasProFeature("pages")`，无授权直接 `notFound()`，因此已发布页面不会绕过 license 被访问。总体结论为 **A（完整实现 + 服务端门控）**。Dashboard 门控属于额外的 UI Gate，但不是唯一防线。

## 证据与逐功能分类

### 1. 页面 PRO 注册与 Dashboard 门控 — A

* `src/lib/app-license.config.ts:7-14` 将 `pages` 列入 `proFeatures`，`:16-23` 标签为 “Pages and CMS”；`:25-35` 将 `/dashboard/pages` 映射到 `pages`。
* `src/app/dashboard/layout.tsx:15-16,74-76` 获取 license，并以 `DashboardProFeatureGate` 包裹全部 Dashboard 内容；因此管理 UI 对未授权用户加锁。
* 但关键 API 不依赖 UI：服务端路由单独执行 license 检查（见下）。

### 2. 页面列表/创建 API — A

`src/app/api/pages/route.ts:7-18` 的 GET 先验证 session，再于 `:10-11` 执行 `requireProFeature("pages")`，之后调用 `listStorePages`。POST 同样在 `:21-25` 检查 session 与 license，`:26-37` 校验 `storePageSchema` 并调用 `createStorePage`。未授权直接返回 403，不能仅通过绕过前端创建或读取页面。

### 3. 单页更新/删除（编辑器保存接口）— A

`src/app/api/pages/[id]/route.ts:12-20` PATCH 在读取页面之前调用 `requireProFeature("pages")`；`:21-28` 校验页面归属（用户、active store、environment），`:29-40` schema 校验后调用 `updateStorePage`。DELETE 在 `:43-61` 同样先做 session 与 `requireProFeature`（`:47-50`），再校验归属后删除。因此 `PageEditor` 的 POST/PATCH/DELETE 保存接口不是仅前端加锁，未授权直接 API 调用也会 403，判定 A。

`src/app/dashboard/pages/PageEditor.tsx:43-92` 的 save 调用 `/api/pages` 或 `/api/pages/:id`（`:56-71`），`:73-81` 处理接口响应；`:94-104` 删除调用 DELETE。前端没有自行实现数据持久化，后端门控有效。

### 4. 页面数据核心库与存储模型 — A

`src/lib/store-pages.ts:22-40` 将通用 `feature_records` 映射为 StorePage（title、description、slug、coverImageUrl、content、navigation、status、时间戳）。列表/按 slug 查询在 `:43-70`；slug 规范化、保留路径及重复校验在 `:72-91`。创建 `:93-120`、更新 `:122-147`、删除 `:149-153` 均实际调用 feature-records 持久化函数。

`src/db/schema.ts:465-481` 定义 `feature_records` 表（user/environment/feature/title/subtitle/status/data/timestamps），`:483-503` 定义相关索引；页面记录使用 `feature = "pages"` 并把 storeId、slug、正文等保存于 data（`store-pages.ts:105-117`）。没有独立 `pages` 表，但这是统一 feature-records 设计，不是缺失实现。

### 5. 编辑器与 Dashboard 页面管理 UI — A（服务端页面入口 + API 门控）

`src/app/page-editor/new/page.tsx:6-10` 要求 session，且 `hasProFeature("pages")` 失败时 redirect `/dashboard/pages`；`src/app/page-editor/[id]/page.tsx:8-21` 同样检查 session/license，并校验页面属于当前用户、store、environment 后渲染编辑器。Dashboard 列表 `src/app/dashboard/pages/page.tsx:8-15` 读取当前用户页面，`:26-31` 提供新建入口，`:49-82` 展示状态/导航并链接编辑器。`dashboard/pages/[id]/page.tsx:4-6` 与 `dashboard/pages/new/page.tsx:3-5` 是到真正 editor 的重定向。编辑器具备标题、slug、描述、封面、正文、发布状态和 top/footer/none 导航设置（`PageEditor.tsx:17-37,124-153,182-251`）。

### 6. 公开页面发布与渲染 — A（明确服务端门控）

主路径 `src/app/pages/[slug]/page.tsx:20-26` 在读取 store 前执行 `hasProFeature("pages")`，失败调用 `notFound()`；`:37-45` 读取并仅接受 `published` 页面，`:42` 对不存在/草稿返回 404，`:53-110` 完整渲染标题、描述、封面、富文本和菜单。故未授权无法访问已发布页面，不存在“仅前端加锁”的后端绕过。

多店铺路径 `src/app/s/[slug]/[pageSlug]/page.tsx:20-30` 先定位 store/category，页面分支同样在 `:30` 检查 `hasProFeature("pages")`；`:43-50` 查询并仅渲染 published。根路径别名 `src/app/[pageSlug]/page.tsx:10-19` 将非分类 slug 转发到主页面渲染器，因此继承上述服务端门控。

注意：多店铺路径在 `:26-28` 对产品分类先返回 `StoreCategoryPage`，这是产品分类功能，不应误判为 Pages PRO 绕过；仅页面 slug 分支受 pages 门控。

### 7. 公开 metadata 与 license 门控 — A

`src/app/pages/[slug]/page-metadata.utils.ts:12-17` 在生成 metadata 前检查 `hasProFeature("pages")`，未授权返回 title “Page not found” 且 `robots.index=false`；`:31-38` 仅为已发布页面生成 metadata，`:40-52` 构造描述、canonical、OG 图片及 keywords。根别名使用 `src/app/[pageSlug]/page-metadata.utils.ts:1-26` 委托同一 metadata 逻辑。因此 SEO metadata 与页面 serving 均有服务端门控。

### 8. 通用 features API 的 pages 路由 — D（显式排除，非缺失）

`src/app/api/features/[feature]/route.ts:48-73` 与 `:76-99` 对通用 feature API 先可解析 PRO 需求，但明确 `!isDashboardFeatureKey(feature) || feature === "pages"` 时返回 404。Pages 使用专用 `/api/pages` 路由（其 CRUD 更严格并带 store/environment/slug 校验），因此通用路由排除是有意架构选择，不能判为未实现。分类 D（架构分流），专用 API 结论仍为 A。

## 结论表

| 子功能 | 分类 | 结论 |
|---|---|---|
| PRO 注册、Dashboard `/dashboard/pages` gate | A | 有 license 配置及服务端 Dashboard Gate |
| 列表/创建 `/api/pages` | A | session + `requireProFeature("pages")`，schema 与持久化完整 |
| 更新/删除 `/api/pages/[id]` | A | PATCH/DELETE 均服务端 license + 归属校验 |
| 编辑器保存/删除 | A | UI 调专用 API；API 本身受 403 门控，不可绕过 |
| 页面核心库/数据库 | A | `store-pages.ts` + `feature_records` 实际 CRUD、slug/status 等完整 |
| 公开页面（主路径、根别名、多店路径） | A | serving 前先 `hasProFeature`; 未授权 `notFound`，草稿也 404 |
| 页面 metadata | A | metadata 工具显式 license 检查并隐藏 robots |
| `/api/features/[feature]` 的 pages | D | 有意返回 404，Pages 走专用 `/api/pages`，不是占位 |

未发现代码层面缺失（C）或仅前端加锁导致后端可绕过（B）的 Pages/CMS 子功能。
