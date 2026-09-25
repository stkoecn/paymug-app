import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs";

// Find the D1 sqlite file under .wrangler/state/v3/d1/miniflare-D1DatabaseObject/
const d1Dir = path.resolve(".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
const files = fs.readdirSync(d1Dir).filter((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite");

if (files.length === 0) {
  console.error("No D1 database found in", d1Dir);
  process.exit(1);
}

const dbPath = path.join(d1Dir, files[0]);
console.log("Using local D1 database:", dbPath);
const db = new DatabaseSync(dbPath);

const user = db.prepare("SELECT * FROM users LIMIT 1").get();
const store = db.prepare("SELECT * FROM stores LIMIT 1").get();

if (!user || !store) {
  console.error("No user or store found. Please complete /setup first.");
  process.exit(1);
}

console.log(`Found store: ${store.name} (${store.id}), user: ${user.name} (${user.id})`);

const now = new Date().toISOString();

// 1. Create Product Categories
const categories = [
  {
    id: randomUUID(),
    name: "Developer Tools",
    slug: "developer-tools",
    description: "开发套件、脚手架与开源工具",
    sort_order: 1,
  },
  {
    id: randomUUID(),
    name: "Software & Apps",
    slug: "software-apps",
    description: "独立客户端软件、AI 效率扩展与桌面应用",
    sort_order: 2,
  },
  {
    id: randomUUID(),
    name: "Templates & UI Kits",
    slug: "templates-ui-kits",
    description: "Tailwind CSS 页面模版与组件库",
    sort_order: 3,
  },
  {
    id: randomUUID(),
    name: "E-Books & Tutorials",
    slug: "ebooks-tutorials",
    description: "出海实战电子书与独立开发者指南",
    sort_order: 4,
  },
];

const insertCategory = db.prepare(`
  INSERT OR REPLACE INTO product_categories 
  (id, user_id, store_id, name, slug, description, sort_order, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const cat of categories) {
  insertCategory.run(
    cat.id,
    user.id,
    store.id,
    cat.name,
    cat.slug,
    cat.description,
    cat.sort_order,
    now,
    now
  );
  console.log(`  + Category created: ${cat.name}`);
}

// 2. Define Sample Products
const sampleProducts = [
  {
    name: "SaaS Boilerplate Pro (Next.js 16 + Cloudflare)",
    slug: "saas-boilerplate-pro",
    description: "生产就绪的 Full-Stack SaaS 开发套件，内置身份认证、D1/SQLite 数据库、Stripe/PayPal 支付与邮件自动化，助你极速出海上线业务。",
    price: 4900, // $49.00
    categoryIndex: 0,
    billing_type: "one_time",
    generate_license: 0,
    custom_amount_enabled: 0,
    delivery_content: `感谢购买 SaaS Boilerplate Pro！
代码仓库地址：https://github.com/stkoecn/saas-starter-pro
在线部署文档：https://docs.stkoe.cn/saas-boilerplate
私有仓库邀请：请在订单详情页绑定你的 GitHub 账号，系统将在 1 分钟内自动邀请进入仓库。`,
  },
  {
    name: "Cursor AI 开发者效能提速插件 (Pro License)",
    slug: "cursor-ai-productivity-pro",
    description: "专为全栈工程师设计的 AI 提效套件。支持多模型无缝切换、常用 Prompt 资产库管理与实时代码审查，一键提效 300%。",
    price: 2900, // $29.00
    categoryIndex: 1,
    billing_type: "one_time",
    generate_license: 1,
    license_type: "standard",
    license_seat_limit: 3,
    custom_amount_enabled: 0,
    delivery_content: `感谢支持正版软件！
软件下载地址：https://assets.stkoe.cn/releases/cursor-ai-pro-latest.zip
激活说明：您的 License Key 已在上方自动生成，打开软件设置 -> 许可证，输入激活码即可完成 3 台设备的永久授权。`,
  },
  {
    name: "全栈出海与独立开发盈利指南 (PDF + Notion 库)",
    slug: "indie-hacker-growth-blueprint",
    description: "超过 10 万字实战总结：从 0 到 1 构建出海微型 SaaS，覆盖冷启动获客、定价模型、合规收款与海外 SEO 增长全套方法论。",
    price: 1900, // $19.00
    categoryIndex: 3,
    billing_type: "one_time",
    generate_license: 0,
    custom_amount_enabled: 0,
    delivery_content: `感谢购买本指南！
Notion 知识库在线复制：https://notion.so/stkoe/indie-growth-blueprint-2026
高清 PDF 完整版下载：https://assets.stkoe.cn/books/indie-hacker-guide-v2.pdf`,
  },
  {
    name: "Tailwind CSS 极简后台仪表盘模版 (Dashboard UI)",
    slug: "tailwind-admin-dashboard-template",
    description: "纯 Tailwind CSS v4 打造的现代后台管理模板，包含 40+ 业务常用数据图表与表单组件，响应式适配移动端与暗黑模式。支持随意赞赏定价！",
    price: 1200, // $12.00
    categoryIndex: 2,
    billing_type: "one_time",
    generate_license: 0,
    custom_amount_enabled: 1, // Pay what you want!
    delivery_content: `感谢支持！
UI 源码包 (ZIP)：https://assets.stkoe.cn/templates/tailwind-dashboard-v1.2.zip
Figma 设计源文件：https://figma.com/@stkoe/tailwind-dashboard-pro`,
  },
  {
    name: "独立开发者每月闭门周刊与 VIP 交流社群",
    slug: "indie-creator-monthly-club",
    description: "每月精选 4 期全球独立开发者真实盈利项目复盘，探讨前沿 AI 工具与变现逻辑，并享有专属 Discord 深度交流社群席位。",
    price: 900, // $9.00 / month
    categoryIndex: 3,
    billing_type: "subscription",
    interval_unit: "month",
    interval_count: 1,
    generate_license: 0,
    custom_amount_enabled: 0,
    delivery_content: `欢迎加入 VIP 创作者俱乐部！
专属 Discord 社群邀请：https://discord.gg/stkoe-indie-creators
每月周刊归档阅读：https://club.stkoe.cn/archive`,
  },
];

const insertProduct = db.prepare(`
  INSERT OR REPLACE INTO products (
    id, user_id, store_id, category_id, environment, name, slug, description,
    price, currency, status, hide_from_storefront, delivery_content, product_files,
    generate_license, license_type, license_update_period_count, license_seat_limit,
    billing_type, custom_amount_enabled, interval_unit, interval_count, trial_days,
    purchase_count, options, bundles, transaction_fee_type, transaction_fee_value,
    created_at, updated_at
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?
  )
`);

const insertProductCategoryProduct = db.prepare(`
  INSERT OR REPLACE INTO product_category_products (category_id, product_id, created_at)
  VALUES (?, ?, ?)
`);

// Insert products for both sandbox (current active) and live environments
const environments = ["sandbox", "live"];

for (const env of environments) {
  console.log(`\nInserting products for [${env}] environment:`);
  for (const item of sampleProducts) {
    const prodId = randomUUID();
    const category = categories[item.categoryIndex];
    // Add env prefix to slug for live to avoid confusion
    const slug = env === "live" ? `${item.slug}-live` : item.slug;

    insertProduct.run(
      prodId,
      user.id,
      store.id,
      category.id,
      env,
      item.name,
      slug,
      item.description,
      item.price,
      "USD",
      "published",
      0, // not hidden
      item.delivery_content,
      "[]",
      item.generate_license,
      item.license_type || "standard",
      1,
      item.license_seat_limit || 1,
      item.billing_type,
      item.custom_amount_enabled,
      item.interval_unit || null,
      item.interval_count || 1,
      0, // trial days
      0, // purchase count
      "[]",
      "[]",
      "fixed",
      0,
      now,
      now
    );

    insertProductCategoryProduct.run(category.id, prodId, now);
    console.log(`  + [${env}] ${item.name} ($${(item.price / 100).toFixed(2)})`);
  }
}

console.log("\n🎉 Successfully seeded sample products and categories!");
