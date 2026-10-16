# 测试环境部署（无 Docker）

阿里云 Linux 使用包含 Web 的后端包部署，Vercel 使用同一套合并构建。具体 ECS/RDS、CPU、域名和证书申请完成后填写。部署包可先在 Mac 本地生成；不能把 Mac 的 node_modules 复制到 Linux。

## 生成产物

```sh
pnpm install --frozen-lockfile
pnpm package:server
# 仅在需要独立静态站点交付时另行执行：
# pnpm package:web
```

`artifacts/tyde-server-0.1.0.tar.gz` 包含编译后的后端、Web 静态资源（`apps/server/public`）、共享包、迁移、原始 lockfile 与部署模板，不含秘密、数据库或开发机运行依赖。阿里云部署只需这个包，不需要另传 Web 包。可选的 `artifacts/tyde-web-0.1.0.tar.gz` 仍用于独立静态站点交付。旁边 `.sha256` 用于校验。安装依赖时仍需目标机网络；此交付不是无网络全离线镜像。

## 后端

1. 准备 Node 24、pnpm 11.23.0、PostgreSQL 18（或兼容版本），创建独立测试数据库与仅用于项目的用户。
2. 解压后端包到 `/opt/tyde`（示例路径）；以非 root 用户管理运行进程。
3. 在该目录执行 `pnpm install --prod --filter @tyde/server... --frozen-lockfile`。
4. 复制 `apps/server/.env.example` 为 `.env`，设置权限 0600，并填写下表配置。
5. 执行 `pnpm --filter @tyde/server db:generate`，在目标 OS 生成 Prisma 引擎。
6. 执行 `pnpm --filter @tyde/server db:deploy`，应用提交的迁移。变更已有环境前先备份，不执行 `migrate reset` 或 `db push`。
7. 在 `apps/server` 执行 `node --env-file=.env dist/main.js` 验证启动，然后使用 `deploy/tyde.service.example` 配置 systemd。该进程同时提供 Web 与 API，Web 资源路径相对于编译模块解析，不依赖启动工作目录。
8. 使用 `deploy/nginx-server.conf.example` 配置 HTTPS，把全部路径代理至 `127.0.0.1:3000`。无需独立静态站点目录；保留 `/api/v1` 前缀。页面域名须加入 `WEB_ORIGINS`。
9. 验证 HTTPS 根路径登录页、JS/CSS、live / ready、Swagger，以及登录、刷新恢复和退出。缺少页面时检查是否使用完整后端包，不要只复制 `dist`。

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

## Vercel 前后端合并部署

保留现有后端 Vercel 项目（`tyde-outside-server`），由同一次部署发布 Web 静态资源与 Fastify API。浏览器访问同一个域名的 `/` 和 `/api/v1/*`，不再需要独立 Web 项目的跨项目转发。Electron 继续连接该域名的 API。

### 一次性项目设置

在现有后端项目的 Settings 中确认以下设置；代码无法代替控制台修改 Root Directory、Git 关联或环境变量。

| 设置                                                                 | 值                                                |
| -------------------------------------------------------------------- | ------------------------------------------------- |
| Git Repository / Production Branch                                   | 关联本仓库与实际发布分支，保持 Git 自动部署开启   |
| Root Directory                                                       | `apps/server`                                     |
| Include source files outside of the Root Directory in the Build Step | 开启；构建需要 `apps/web`、`packages/` 与根配置   |
| Node.js Version                                                      | `24.x`                                            |
| Framework Preset                                                     | `Fastify`                                         |
| Output Directory                                                     | 关闭 Override，使用 Fastify 默认静态目录 `public` |
| Skip deployment / Skip unaffected projects                           | 关闭，确保仅修改 Web 也会触发合并部署             |

`apps/server/vercel.json` 随代码指定 Install Command 为 `pnpm install --frozen-lockfile`，Build Command 为 `pnpm --dir ../.. build:vercel`，并用 `outputDirectory: null` 恢复框架默认输出设置。控制台 Output Directory 同样建议关闭 Override，不显式指定 `public` 或 `dist`：Fastify 构建器会在显式输出目录中寻找后端入口，而 `public` 仅包含前端资源，会导致入口检测失败。默认情况下 Vercel 会收集 `public` 静态资源，同时从 `src/app.ts` 构建 API。清理旧的构建覆盖配置，部署日志应执行上述合并命令，而不是旧的 `pnpm run build`。`ignoreCommand: exit 1` 表示继续构建，避免旧的 Ignored Build Step 只检查后端变更；它不能代替关闭控制台的 Skip unaffected projects。

安装需保留开发依赖，不要使用 `--prod`。完整仓库可访问选项见 [Vercel Monorepos FAQ](https://vercel.com/docs/monorepos/monorepo-faq)，构建跳过机制见 [Vercel Monorepos](https://vercel.com/docs/monorepos)。

### 构建与请求路由

在仓库根目录可执行与 Vercel 相同的构建：

```sh
pnpm build:vercel
```

`build:vercel` 调用与阿里云交付相同的 `pnpm build:server`。该命令先编译 shared、platform、检查 Web 类型，再让 Vite 将 Web 输出到 `apps/server/public`；随后编译 shared、生成 Prisma Client、编译后端。Vite 每次清理专用输出目录，避免旧资源残留。该目录已从 Git、ESLint 和 Prettier 检查中忽略，只提交源码、锁文件与构建配置。普通 `pnpm build:web` 仍输出 `apps/web/dist`，供 Electron 与独立 Web 交付使用。

Vercel 从 `public` 发布静态资源，Fastify 继续通过 `src/app.ts` 默认导出的 HTTP server 处理 API。`/` 显式重写到 `/index.html`；页面采用 HashRouter，无需全路径 SPA fallback，未知 API 不会变成 HTML 页面。入口 HTML 每次使用前重新验证缓存，Vite 带内容摘要的 `/assets/*` 资源允许长期缓存。Fastify 部署入口约束见 [Vercel Fastify 文档](https://vercel.com/docs/frameworks/backend/fastify)。

```text
同一个 Vercel 项目、同一个域名
  /、/index.html、/assets/* → Web 静态资源
  /api/v1/*               → Fastify Function
```

阿里云的独立入口 `src/main.ts` 在 API 装配后注册 `src/web.ts`，直接托管同一个 `public` 目录；Vercel 的 `src/app.ts` 不注册这一静态插件，由平台托管资源。本地未构建 Web 时 `pnpm dev:server` 可仅启动 API；存在构建产物时也能访问根路径页面。

### 环境变量与迁移

沿用后端数据库与密钥配置，设置 `APP_ENV=test`、`SMS_PROVIDER=mock`、`COOKIE_SECURE=true`。`WEB_ORIGINS` 必须包含用户实际访问页面的完整 HTTPS 源，例如 `https://tyde-outside-server.vercel.app`；如使用 `https://aact.pw` 等自定义域名，也须逐个加入。保留仍在使用的 HTTPS 本地开发源，多个地址以逗号分隔，不带路径或结尾斜线。

Preview 部署要进行登录联调时，也需显式允许其实际源地址；不自动放行任意 Preview 域名。环境变量变化后重新部署。当前 `APP_ENV=production` 会被配置校验拒绝，Vercel 的 Production 发布环境仍使用上述测试业务配置。

数据库必须能从 Vercel 访问，发布前对目标库执行已有迁移。合并构建不执行数据库迁移，也不将后端 `.env` 复制到 Web 产物；后端密钥不得改为 `VITE_*` 环境变量。

### 切换与验收

1. 提交并 push 源码到发布分支，确认现有后端项目自动执行合并构建。
2. 访问后端固定域名 `/`，确认显示登录页，浏览器 Network 中 JS/CSS 成功加载，API 请求访问同域 `/api/v1/*`。
3. 验证 `/api/v1/health/live`、`/api/v1/health/ready`、`/api/v1/docs/` 与 `/api/v1/docs/json`。ready 必须成功；未知 `/api/v1/not-found` 应返回 404，不能返回 Web HTML。
4. 验证验证码登录、新用户注册、刷新恢复、退出；验证 Electron 仍可登录并恢复会话。
5. 再提交一次仅修改 Web 源码的变更，确认也能触发后端项目自动部署并更新页面。
6. 如需保留原 Web 自定义域名，先迁移至合并项目并更新 `WEB_ORIGINS`、验证登录；完成后再由项目管理员下架原独立 Web 项目。原 `*.vercel.app` 项目域名不能当作自定义域名直接迁移。

`apps/web/vercel.json` 是原独立 Web 项目的过渡配置，合并项目不会读取它；在旧项目下架前保留，便于切换期间继续使用。现有 Web 会话 Cookie 属于原域名，改用后端域名后通常需要重新登录。

## Web 与 HTTPS

默认的阿里云合并部署使用 `deploy/nginx-server.conf.example`：Nginx 终止 HTTPS，所有请求转发给同一个 Fastify 服务。入口 HTML 重新验证缓存，`/assets/*` 使用长期缓存；缺失页面或 API 返回 404，不做全路径 HTML 回退。

如果需要分开交付，仍可使用原独立静态站点方式：把 Web 包的 `web/` 内容部署到 Nginx 静态根目录，按实际域名、证书和目录修改 `nginx.conf.example`。保留 `/api/` 路径转发至后端，不剥离 `/api/v1`。Web 使用 hash 路由，无需 history fallback。

```sh
nginx -t
# 配置校验通过后由运维加载 Nginx 配置
curl --fail https://test.example.com/api/v1/health/live
curl --fail https://test.example.com/api/v1/health/ready
```

HTTPS 环境的网页与桌面连接同一域名：合并部署中页面和 API 均由同一后端提供，桌面 main 直接请求该域名 `/api/v1`。不要为了桌面而启用任意 CORS。仅开放必要网络入口，数据库不对测试人员电脑直接暴露。

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
