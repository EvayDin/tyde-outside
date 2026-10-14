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

# 终端 3：Electron（自动复用本项目 Web 服务，未启动则自动启动）
pnpm dev:electron
```

Web 地址：<http://127.0.0.1:5173>。输入有效大陆手机号，点击获取验证码，固定输入 **095270**（保留前导零）。新用户填写唯一英文用户名与多语言姓名，老用户直接登录。欢迎页显示姓名和当前手机号。Web 与桌面账号互通，各自会话有效 30 天，退出只撤销当前会话。

mock 不会发送短信或验证真实号码归属，请用约定的测试号码。默认生产模式禁止 mock，真实短信后续在 `apps/server/src/modules/auth/sms.ts` 接入。

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

集成测试覆盖真实 PostgreSQL 注册、会话、双端登录/退出、验证码限流与重放、用户名冲突及并发验证。实际执行记录见 [验证记录](docs/VERIFICATION.md)。

## 构建与交付

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

后端包不包含开发机 `node_modules`，须在 Linux 目标机安装锁定依赖并生成目标平台 Prisma client。[测试部署说明](docs/DEPLOY_TEST.md)包含迁移、Nginx、systemd 与健康检查；[试用安装说明](docs/INSTALL_TRIAL.md)包含 Mac / Windows 授信步骤。

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
