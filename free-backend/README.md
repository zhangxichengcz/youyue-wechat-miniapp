# 免费预约后台

使用 Cloudflare Workers Free、D1 Free 与每分钟定时任务。接口通过微信登录和签名会话识别用户，预约、改期与提醒状态保存在数据库中。

## 通过网页部署

按 [网页部署步骤](网页部署步骤.md) 创建数据库、执行 schema-console.sql、部署 worker-dashboard.mjs，并配置 DB、Secret、微信模板和定时任务。无需额外部署工具。

## 使用部署工具

本机安装 Node.js，进入此目录：

```text
npm install
npx wrangler login
```

在 wrangler.json 填入自己的数据库 ID、AppID、真实消息模板 ID 和字段编号。确认账号套餐是 Free，再执行：

```text
npm run init:db
npm run deploy
npx wrangler secret put WX_APP_SECRET
npx wrangler secret put SESSION_SECRET
```

SESSION_SECRET 使用自己生成的至少 32 字符随机密钥，只保存为 Secret。此目录中的演示配置不能直接替代真实账号和数据库编号。

## 手机验证

访问实际生产地址 /health，应看到 configured=true、remindersConfigured=true。这只证明配置项已存在。还需验证普通手机网络可达、微信 request 域名接受、实际微信登录和订阅消息送达。

默认 Workers 地址如果不可达，可先验证 [Pages 入口](../free-entry/网页部署步骤.md)，通过 Service binding 使用同一后台。保持原后台定时器，双方订阅提醒不依赖用户持续打开小程序。

提醒在开始前 24 小时发送；确认授权时不足一天则在后续扫描尽快发送。取消会停止未发出的任务；已发送消息不能撤回。改期需要对方确认，未发提醒跟随新时间，已发提醒需要重新授权。

免费服务有请求、CPU、数据库和存储限额；微信平台另有账号、域名、认证及类目条件。不升级付费套餐并不保证每个账号和网络环境都满足真实使用条件。

源码：core.mjs 业务规则，auth.mjs 微信登录和会话，reminders.mjs 消息发送，worker.mjs 接口与定时入口，schema.sql 数据库约束。修改模块后，在仓库根目录运行 npm run prepare:free 更新网页部署单文件。

参考：[Workers 配额](https://developers.cloudflare.com/workers/platform/pricing/)、[D1 配额](https://developers.cloudflare.com/d1/platform/pricing/)。
