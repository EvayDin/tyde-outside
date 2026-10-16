# tyde

项目原名为 `tyde-outside`。为兼容已有环境，数据库名与角色名、已部署的 Vercel 域名及桌面应用标识 `app.tydeoutside.desktop` 保持原值。

React + Electron + Fastify + PostgreSQL 的 pnpm Monorepo。Web 与桌面共用 `apps/web`，首期实现大陆手机号验证码登录、首次补资料注册、持久会话和退出。

## 环境

- Node.js 24（基线 24.19.0），pnpm 11.23.0。使用 `nvm use` 切换 Node；不要自动升级 pnpm 主版本。
- 原生 PostgreSQL，当前开发使用 Postgres.app PostgreSQL 18。不需要 Docker 或 Podman。
- 首次依赖安装需要 npm 网络；Electron 安装与打包还会下载二进制。
- Mac 包在 macOS 构建；Windows 包优先在 Windows x64 构建。用户安装客户端无需这些开发工具。

## 首次运行（Mac）

先安装 [Postgres.app](https://postgresapp.com/)，然后在项目根目录执行：

```sh
pnpm install
pnpm db:local:start
pnpm setup:local
pnpm db:deploy
```

`db:local:start` 使用 Postgres.app 的二进制，在本项目 `.local/postgres` 下创建独立数据库实例，仅监听回环地址 5432，数据不提交 Git。若 Postgres.app 或其他数据库已占用 5432，请选择一种实例运行方式，不要同时启动两个实例。

`setup:local` 创建 `tyde_outside_dev` 角色、开发库和专用自动化测试库，生成随机凭据到 `apps/server/.env` 与 `.env.test`（权限 0600）。它不会覆盖已有 `.env` 或重置已有角色密码。已有数据库时可自行复制 `.env.example` 并配置；特殊 PostgreSQL 路径通过 `PG_BIN` / `PSQL_BIN` 指定。

分别打开终端：

```sh
# 终端 1：独立后端
pnpm dev:server

# 终端 2：Web
pnpm dev:web

# 终端 3：Electron（自动启动或复用 5174 端口的桌面页面服务）
pnpm dev:electron
```

Web 地址：<http://127.0.0.1:5173>。当前注册登录迁移仅覆盖后端，Web/Electron 原认证流程尚未适配。请先通过 Swagger 或 API 客户端联调，接口字段、默认执行专家规则及迁移步骤见 [认证后端上下文](docs/AUTH_BACKEND.md)。开发/测试 mock 验证码仍为字符串 **095270**（保留前导零）。

Electron 连接 Vercel 测试后端时，退出旧客户端后运行 `pnpm dev:electron:test`，无需启动本地后端。该命令加载 `apps/electron/config/test.env`，目标为 `https://tyde-outside-server.vercel.app`；shell 中已有的 `TYDE_API_BASE_URL` 优先于文件配置，切换时请检查是否有遗留变量。

`pnpm dev:electron` 也读取 Web 的 `API_PROXY_TARGET` 配置（shell 优先于 `apps/web/.env.local`），通过 Electron main 连接对应后端；显式设置的 `TYDE_API_BASE_URL` 优先级最高。桌面页面固定使用 `http://127.0.0.1:5174`，与 Web 的 5173 端口独立，可同时开发，无需为桌面接受自签名证书。

Web 通过 `API_PROXY_TARGET` 切换后端：默认连接 `http://127.0.0.1:3000`；运行 `API_PROXY_TARGET=https://aact.pw pnpm dev:web` 可连接 Vercel，无需启动本地后端或数据库。也可在 `apps/web/.env.local` 中设置 `API_PROXY_TARGET=https://tyde-outside-server.vercel.app`，之后直接运行 `pnpm dev:web`；

mock 不会发送短信或验证真实号码归属，请用约定的测试号码。默认生产模式禁止 mock，真实短信后续在 `apps/server/src/modules/auth/sms.ts` 接入。

## 前后端合并部署

阿里云部署执行 `pnpm package:server`，生成包含 Web 静态资源的后端包。Fastify 直接提供根路径页面和 `/api/v1/*`，HTTPS 使用 `deploy/nginx-server.conf.example` 将全部请求代理至后端，不需要单独部署前端。`pnpm build:server` 会先构建 Web，再构建 API。

Vercel 使用现有后端项目统一发布 Web 页面和 API：push 源码后自动构建，不提交前端打包产物。Root Directory 保持 `apps/server`，其 `vercel.json` 调用根目录的 `pnpm build:vercel`，生成 `apps/server/public` 静态资源及后端产物。部署后同一域名的 `/` 为 Web 页面，`/api/v1/*` 为 API。

首次切换需在控制台开启 Root Directory 之外源码访问、关闭 Skip unaffected projects，并将页面访问域名加入 `WEB_ORIGINS`。完整设置、验收与旧前端项目下架顺序见 [Vercel 合并部署说明](docs/DEPLOY_TEST.md#vercel-前后端合并部署)。本地 Web / Electron 开发命令保持原用法。

## API 文档（Swagger）

后端启动后访问 <http://127.0.0.1:3000/api/v1/docs/>，或通过 Web 开发代理访问 <http://127.0.0.1:5173/api/v1/docs/>。

- OpenAPI JSON：`/api/v1/docs/json`；YAML：`/api/v1/docs/yaml`。
- 文档覆盖认证和健康检查接口，由 Fastify 路由 schema 动态生成。
- 浏览器调试 POST 时，当前文档页面的源地址必须包含在 `WEB_ORIGINS` 中；默认本地配置使用 Web 5173 地址调试。

完整请求示例、双端认证方式和 schema 维护约定见 [API 文档说明](docs/API.md)。

## 验证

```sh
pnpm test:core
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
```

本机一键验证：首次运行 `pnpm exec playwright install chromium` 安装浏览器，然后 `pnpm verify:local`。该命令依次执行全部检查、迁移和 Web / Electron 操作，保存 JSON 结果与截图。某一步失败并修正后可用 `pnpm verify:local --resume` 从失败步骤继续；此前通过项会沿用原记录。

集成测试会清空专用测试库中的项目表，必须使用 `.env.test` 且库名以 `_test` 结尾。先迁移测试库，再执行：

```sh
cd apps/server
node --env-file=.env.test node_modules/prisma/build/index.js migrate deploy
cd ../..
pnpm test:integration
```

集成测试覆盖真实 PostgreSQL 注册、密码/短信登录、验证码场景隔离、并发与重放、刷新令牌、重置密码下线和组织资料。实际执行记录见 [验证记录](docs/VERIFICATION.md)。

```sh
pnpm build:web
pnpm build:server
pnpm build:electron
pnpm package:web
pnpm package:server
pnpm package:mac
pnpm package:win
node scripts/checksums.mjs release
```

本机后端配置完成、当前系统安装包构建后，可运行 `pnpm test:packaged` 检查打包后的本地页面、API 桥接和安全隔离；该检查不启动 Vite。它默认用于连接本机后端的包，远程环境包须另行实际联调。

- Web / 后端部署包在 `artifacts/`，桌面安装包在 `release/`。
- 每次进入打包阶段会自动清理同类型的旧产物（包括旧版本、改名前的包和对应临时目录）；Mac、Windows、Web、后端相互保留。桌面打包成功后自动更新安装说明、SHA-256 与交付清单。Mac 发 `release/` 根目录最新的 `.dmg`，Windows 发 `.exe`，不需要自行压缩 `.app`。打包阶段失败后可能留下不完整输出，应重新成功打包后再分发；需要归档的旧包请提前移出这些输出目录。同一工作区请串行打包。
- Mac 为 universal DMG，覆盖 Apple Silicon 与 Intel；Windows 为 x64 NSIS EXE。
- 未设置后端地址的桌面包连接安装者本机 `127.0.0.1:3000`，仅供本地联调。测试服务器上线后设置 `TYDE_API_BASE_URL` 再打包：

```sh
# macOS
TYDE_API_BASE_URL=https://test.example.com pnpm package:mac
```

```powershell
# Windows PowerShell
$env:TYDE_API_BASE_URL = 'https://test.example.com'
pnpm package:win
```

`test.example.com` 是占位符，必须替换。前端构建不会嵌入后端密钥；Web 使用同源 `/api` 代理，桌面由 main 固定请求可信后端。安装包中的 React 静态资源来自同一个 `apps/web/dist`。

后端包包含 Web 资源，不包含开发机 `node_modules`，须在 Linux 目标机安装锁定依赖并生成目标平台 Prisma client。[测试部署说明](docs/DEPLOY_TEST.md)包含迁移、Nginx、systemd 与健康检查；[试用安装说明](docs/INSTALL_TRIAL.md)包含 Mac / Windows 授信步骤。

## 目录与工程边界

| 路径              | 职责                                     |
| ----------------- | ---------------------------------------- |
| apps/web          | 唯一 React 前端、中文 Ant Design 页面    |
| apps/electron     | 安全窗口、受限 IPC、加密保存会话、安装包 |
| apps/server       | Fastify 认证、数据库与限流               |
| packages/shared   | 类型、schema、常量和 IPC 契约            |
| packages/platform | Web fetch / Electron preload 的统一接口  |
| packages/config   | TypeScript / ESLint 配置                 |

完整设计见 [PROJECT_DESIGN.md](PROJECT_DESIGN.md)。`.env`、数据库数据、令牌和打包结果不会提交 Git。

## 常见问题

- pnpm 11 使用 `pnpm-workspace.yaml` 的 `allowBuilds`，不要改回旧 `onlyBuiltDependencies`。白名单只允许 Electron、Prisma、esbuild 的必需脚本，未使用的 Squirrel 打包脚本被禁用。
- electron-builder 固定为 26.15.3，其依赖链支持 npm 发布的 rebuild / node-gyp；不需要关闭 `blockExoticSubdeps` 或覆盖不兼容的 rebuild 主版本。
- `renderer config is missing` 是 electron-vite 对省略 renderer 配置的提示；本项目只让它构建 main / preload，React 由 Web 工程独立构建。
- 首次配置错误时后端明确退出；数据库不可用时 ready 接口返回 503，不会模拟认证成功。
- 开发端口被占用时先检查服务，不自动变更端口。停止项目数据库：`pnpm db:local:stop`；此命令保留所有数据。
- Windows 只做客户端验收不需要数据库；若要用 Windows 打包，只需源码、Node、pnpm，运行 `pnpm install` 后执行打包命令。
