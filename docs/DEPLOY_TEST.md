# 测试环境部署（无 Docker）

目标为阿里云 Linux，具体 ECS/RDS、CPU、域名和证书申请完成后填写。部署包可先在 Mac 本地生成；不能把 Mac 的 node_modules 复制到 Linux。

## 生成产物

```sh
pnpm install --frozen-lockfile
pnpm package:web
pnpm package:server
```

`artifacts/tyde-outside-web-0.1.0.tar.gz` 包含静态资源和 Nginx 示例；`artifacts/tyde-outside-server-0.1.0.tar.gz` 包含编译后的后端、共享包、迁移、原始 lockfile 与部署模板，不含秘密、数据库或开发机运行依赖。旁边 `.sha256` 用于校验。安装依赖时仍需目标机网络；此交付不是无网络全离线镜像。

## 后端

1. 准备 Node 24、pnpm 11.23.0、PostgreSQL 18（或兼容版本），创建独立测试数据库与仅用于项目的用户。
2. 解压后端包到 `/opt/tyde-outside`（示例路径）；以非 root 用户管理运行进程。
3. 在该目录执行 `pnpm install --prod --filter @tyde-outside/server... --frozen-lockfile`。
4. 复制 `apps/server/.env.example` 为 `.env`，设置权限 0600，并填写下表配置。
5. 执行 `pnpm --filter @tyde-outside/server db:generate`，在目标 OS 生成 Prisma 引擎。
6. 执行 `pnpm --filter @tyde-outside/server db:deploy`，应用提交的迁移。变更已有环境前先备份，不执行 `migrate reset` 或 `db push`。
7. 在 `apps/server` 执行 `node --env-file=.env dist/main.js` 验证启动，然后使用 `deploy/tyde-outside.service.example` 配置 systemd。

| 配置             | 测试环境设置                                                     |
| ---------------- | ---------------------------------------------------------------- |
| APP_ENV          | `test`（允许显式 mock；production 会拒绝启动）                   |
| NODE_ENV         | 进程使用 `production`，与 APP_ENV 区分                           |
| HOST / PORT      | 默认 `127.0.0.1` / `3000`，同机 Nginx 代理                       |
| DATABASE_URL     | 测试库真实连接串，密码中的特殊符号需 URL 编码                    |
| SMS_PROVIDER     | `mock`                                                           |
| CODE_HMAC_SECRET | 至少 32 个随机字符；例如本机 Node crypto 生成后安全填入          |
| WEB_ORIGINS      | 真实 `https://测试域名`，不带路径和结尾斜线；多个以逗号分隔      |
| COOKIE_SECURE    | `true`                                                           |
| TRUST_PROXY      | 同机 Nginx 时 `127.0.0.1/32,::1/128`，其他拓扑按可信代理地址填写 |
| LOG_LEVEL        | `info`                                                           |

Prisma CLI 放在服务端生产依赖中用于迁移和目标平台生成；不得为缩小包而移除必需 CLI 后继续声称可部署。`pnpm-workspace.yaml` 的生产允许脚本与依赖覆盖需一同保留。

## Vercel 构建排障

### Web

从完整仓库导入项目，Framework Preset 选择 `Vite`，Root Directory 设为 `apps/web`，开启 **Include source files outside of the Root Directory in the Build Step**，让构建可以读取 `packages/` 与根配置。该选项见 [Vercel Monorepos FAQ](https://vercel.com/docs/monorepos/monorepo-faq)。使用 Node.js 24，Install Command 为 `pnpm install --frozen-lockfile`（保留开发依赖），Build Command 为 `pnpm run build`，Output Directory 为 `dist`。

Web 的 `build` 会依次编译 shared、platform，再执行 Web 类型检查与 Vite 构建；仓库根目录的 `pnpm build:web` 调用同一流程。这两个共享包的导出指向 `dist`，仅安装依赖不会生成产物，缺少产物会导致 `Cannot find module '@tyde-outside/shared'` / `@tyde-outside/platform` 及后续属性类型错误。无需提交 `dist`，也不要将构建命令覆盖为单独的 `vite build`。

Vercel 静态部署不会使用 `vite.config.ts` 的开发 / preview 代理。`apps/web/vercel.json` 已将 `/api/:path*` 转发到固定后端域名 `https://tyde-outside-server.vercel.app/api/:path*`，保留 `/api/` 前缀。后端迁移域名时同步修改该配置，避免使用每次部署生成的专属地址。

当前 Web 固定域名为 `https://tyde-outside-eva-y.vercel.app`。在后端 Vercel 项目的环境变量中设置 `WEB_ORIGINS=https://tyde-outside-eva-y.vercel.app,https://tyde-outside-server.vercel.app`（同时允许 Web 与后端 Swagger 调试）和 `COOKIE_SECURE=true`，保存后重新部署后端。提交转发配置并部署 Web 后，从 Web 域名访问 `/api/v1/health/live`、`/api/v1/health/ready` 和 `/api/v1/docs/` 验收，再验证登录、刷新恢复会话与退出。新增允许的源时使用逗号分隔，不带路径或结尾斜线。

### Server

从完整仓库导入项目，Root Directory 设为 `apps/server`，并开启包含 Root Directory 之外源码的选项；server 依赖 `packages/shared`、`packages/config` 和仓库根配置，不能只上传 `apps/server`。使用 Node.js 24，Install Command 为 `pnpm install --frozen-lockfile`，Build Command 为 `pnpm run build`，安装时保留开发依赖。

server 的 `build` 会依次编译 shared、执行 `prisma generate`、编译 server。仓库根目录执行 `pnpm build:server` 使用同一流程。不要把构建命令覆盖为单独的 `tsc`：缺少 shared 产物会报 `Cannot find module '@tyde-outside/shared'`；缺少 Prisma Client 会引发 `User`、Prisma 错误类型缺失及事务参数隐式 `any` 等连锁错误。该构建流程不执行数据库迁移。

按 [Vercel Fastify 文档](https://vercel.com/docs/frameworks/backend/fastify)，平台要求可识别的服务入口。`src/app.ts` 直接导入 `fastify` 并创建实例，复用 `src/application.ts` 的配置与路由装配，等待插件就绪后默认导出底层 Node HTTP server，由 Vercel 管理监听。入口只间接引用 Fastify 会报 `No entrypoint found which imports fastify`；只导出 `createApp` 工厂会报 `Invalid export found`。本地/独立服务继续通过 `src/main.ts` 监听端口。Framework Preset 选择 `Fastify`，不要把 `dist` 当作静态站点的 Output Directory；部署后以健康检查接口验收，根路径 `/` 没有业务页面。

运行环境需配置上表中的数据库、密钥、HTTPS 源与 Cookie 等变量，测试部署使用 `APP_ENV=test`、`SMS_PROVIDER=mock`；当前 `APP_ENV=production` 会被拒绝启动。数据库必须能从 Vercel 访问，先对目标测试库执行迁移，再验收 live / ready 接口。Web 仍需同源 `/api` 代理。

## Web 与 HTTPS

把 Web 包的 `web/` 内容部署到 Nginx 静态根目录，按实际域名、证书和目录修改 `nginx.conf.example`。保留 `/api/` 路径转发至后端，不剥离 `/api/v1`。Web 使用 hash 路由，无需 history fallback。

```sh
nginx -t
# 配置校验通过后由运维加载 Nginx 配置
curl --fail https://test.example.com/api/v1/health/live
curl --fail https://test.example.com/api/v1/health/ready
```

HTTPS 测试环境的网页与桌面可连接同一域名：网页经 `/api` 同源代理，桌面 main 直接请求该域名 `/api/v1`。不要为了桌面而启用任意 CORS。仅开放必要网络入口，数据库不对测试人员电脑直接暴露。

## Swagger 文档验收

部署后访问 `https://真实测试域名/api/v1/docs/`；现有 `/api/` 代理会同时转发 UI、静态资源和 OpenAPI JSON/YAML，无需增加独立代理路径。插件为 Swagger 页面设置 CSP；保留响应头并确认浏览器控制台没有资源加载错误。

```sh
curl --fail https://test.example.com/api/v1/docs/json
curl --fail https://test.example.com/api/v1/docs/yaml
```

文档端点随服务启动即可访问，不要求数据库已就绪，也未单独设置登录门槛。需要限制测试文档访问时，在网关对整个 `/api/v1/docs` 路径及其子路径统一设置访问控制。Swagger UI 调试 POST 必须从 `WEB_ORIGINS` 中的同源 HTTPS 页面发起；Cookie 按当前 `COOKIE_SECURE` 配置自动处理。完整说明见 [API 文档说明](API.md)。

## 桌面分发

Mac：`TYDE_API_BASE_URL=https://真实测试域名 pnpm package:mac`。

Windows PowerShell：先 `$env:TYDE_API_BASE_URL='https://真实测试域名'`，再 `pnpm package:win`。

运行 `node scripts/checksums.mjs release`，把安装包、SHA256SUMS 和 `docs/INSTALL_TRIAL.md` 一起交付。没有测试环境时可以打本地包检查安装和页面，但跨电脑完整登录需先有可达后端。

## 验收与更新

- Web 和两种桌面系统分别验证新账号注册、老账号登录、重启恢复、退出和网络失败。
- live 成功、ready 失败表示服务进程存活但数据库未就绪，不能当作部署成功。
- 日志通过 systemd journal 或进程 stdout 查看；请求编号用于关联错误，不记录请求体、验证码或会话令牌。
- 试用期间可执行 `pnpm db:cleanup` 清理过期记录；此源码命令需要开发依赖。部署包直接运行 `node --env-file=.env dist/cleanup.js`（在 apps/server 目录）。
- 更新前备份数据库与当前版本，应用迁移再切换服务；回退前检查迁移兼容性，不能承诺任意数据库变更可直接回滚。

所有 example 域名、目录和配置均为占位；本文不表示已完成阿里云部署。
