# tyde 架构速览

> 供 Codex 开发新需求时快速定位。按当前实现整理，架构或模块入口变化时同步更新本文。

## 项目概况

pnpm Workspace Monorepo，TypeScript + ESM，3 个应用、3 个共享包。
Web 与 Electron 共用一份 React 前端，连接 Fastify 后端；后端是按业务模块组织的单体。阿里云后端包包含 Web，由 Fastify 直接托管；Vercel 在现有后端项目中统一发布静态资源与 API。本地可分别启动。
真实短信尚未接入。

技术栈：Node.js 24、pnpm 11、React 19、Vite、Ant Design 6、React Query、React Router、Electron 38、Fastify 5、Prisma 6、PostgreSQL。精确版本见各 `package.json` 与 `pnpm-lock.yaml`。

## 模块边界与入口

| 路径                           | 职责与关键入口                                                                                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src`                 | 唯一业务 UI。`app/App.tsx` 管理 HashRouter 与登录守卫；`app/providers/index.tsx` 配置 React Query、中文 Ant Design；`modules/auth/` 放认证页面                                                |
| `apps/web/src/services/api.ts` | 页面调用入口，当前导出 `platform.auth`；`hooks/useSession.ts` 用 React Query 的 `['session']` 管理会话查询                                                                                    |
| `packages/platform/src`        | 双端适配。`index.ts` 根据 `window.tydeDesktop` 选择 Web fetch（`web.ts`）或桌面 bridge（`electron.ts`）                                                                                       |
| `packages/shared/src`          | 公共 DTO、TypeBox 请求 schema、API 常量、错误类型与 bridge 契约在 `index.ts`；IPC 通道在 `ipc.ts`                                                                                             |
| `apps/electron/src`            | `main/index.ts` 启动与静态资源协议；`main/windows.ts` 安全窗口；`preload/index.ts` 暴露受限 bridge；`main/ipc/index.ts` 校验并调用后端                                                        |
| `apps/electron/src/main`       | `transport.ts` 发 HTTP 请求；`session.ts` 加密持久化令牌；`config.ts` 校验可信后端地址                                                                                                        |
| `apps/server/src`              | `main.ts` 本地/独立服务启动；`app.ts` 为 Vercel 默认导出 HTTP server；`application.ts` 装配 Fastify、Prisma、路由、统一错误与健康检查；`config/index.ts` 校验环境变量；`docs.ts` 注册 Swagger |
| `apps/server/src/modules/auth` | `auth.routes.ts` 处理 HTTP、Cookie、客户端类型；`auth.service.ts` 处理认证、事务、限流；`security.ts` 放安全规则；`sms.ts` 放短信 provider                                                    |
| `apps/server/prisma`           | `schema.prisma` 定义数据模型，`migrations/` 管理数据库变更                                                                                                                                    |
| `packages/config`              | 共用 TypeScript / ESLint 配置                                                                                                                                                                 |
| `scripts/`、`deploy/`          | 本地数据库、验证、打包脚本及 Nginx / systemd 部署模板                                                                                                                                         |

## 请求与会话链路

```text
React 页面 → services/api → packages/platform
  Web      → 同源 fetch /api/v1 → Vite（开发）或 Nginx（独立部署）代理 / Vercel 同域路由 ┐
  Electron → window.tydeDesktop → preload → IPC → main HTTP 请求 ┴→ Fastify 路由 → Service → Prisma → PostgreSQL
```

- API 前缀 `/api/v1`。认证接口沿用旧项目：POST `/auth/sms/send`、`/auth/register`、`/auth/login`、`/auth/sms/login`、`/auth/refresh`、`/auth/password/reset`、`/auth/logout`；GET `/users/me`。健康检查保持 `/health/live`、`/health/ready`。
- 认证使用旧项目 `code/message/data` 包装；注册返回用户资料，登录返回 `accessToken/refreshToken/tokenType/expiresIn`。`role/roles` 可省略，服务端统一固定 EXPERT。个人/组织账号类型仍使用 `accountType`。
- 会话使用新项目随机不透明令牌，数据库仅存摘要，默认 30 天。刷新令牌轮换；Web 与桌面会话独立，退出撤销当前会话，重置密码撤销全部会话。
- Web 使用 HttpOnly、SameSite=Lax Cookie 与来源校验；远程环境要求 HTTPS + Secure Cookie。桌面 main 使用 Bearer。无浏览器头和 Cookie 的普通 API 客户端无需额外客户端头。
- 原前端仍使用 `/auth/code`、`/auth/verify`、`/auth/me` 与注册凭证流程；这部分未迁移，与新后端不兼容，需要后续前端任务对接。
- 数据表：`User`、`Organization`、`VerificationChallenge`、`Session`、`AuthRateLimit`；原 `RegistrationGrant` 表保留历史数据。验证码消费、注册、刷新与重置依赖事务和数据库锁。
- 组织注册营业执照的一次性凭证认领依赖尚未接入，提交 `businessLicense` 会明确报错。迁移与验证限制见 `docs/AUTH_BACKEND.md`。

## 开发新需求时

- UI 放 `apps/web/src/modules/<业务>/`，路由接入 `app/App.tsx`；后端模块放 `apps/server/src/modules/<业务>/`，在 `application.ts` 装配。
- Swagger UI 为 `/api/v1/docs/`，JSON/YAML 在其下的 `/json`、`/yaml`；插件必须先于业务路由注册。新增接口补齐 summary、operationId、tags、请求与响应 schema，认证请求 schema 位于 `packages/shared/src/auth.ts`，响应 schema 位于 `auth.schema.ts`；维护说明见 `docs/API.md`。
- Swagger 字段说明是新增/修改接口的必交付项：所有请求、响应、嵌套对象、数组项及参数均需中文 `description`，枚举逐值解释，说明条件必填/默认行为/单位/格式/null，并提供真实可校验示例；未接入和占位能力如实标注。常规枚举使用 `type: string` + `enum`，避免无必要的 `anyOf`。完整规则和验收要求见 `docs/API.md` 的“Swagger 文档标准”。
- 涉及双端 API 时同步维护：shared 类型/schema → server 路由与 service → platform Web/桌面适配 → Electron preload 与 IPC → 页面调用。
- UI 统一通过平台适配层访问业务能力；Electron 只承担桌面能力，不复制 React 页面、不内嵌业务后端。
- 新增 IPC 使用明确通道和固定后端路径，保留来源及参数校验；preload 的 IPC 常量从 `@tyde/shared/ipc` 导入。
- 保持 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`；不向 renderer 暴露任意 URL 请求、文件系统或完整 `ipcRenderer`。
- 数据结构变更同时更新 Prisma schema 与迁移。服务端密钥留在后端 `.env`，不进入前端构建、桌面资源或日志。
- 当前仅允许开发/测试 mock 短信，固定验证码是字符串 `095270`；`production` 模式被配置校验阻止启动。接入真实短信需同时调整 provider 和配置校验。

## 常用命令与验证

在仓库根目录执行，使用 Node.js 24 与 pnpm 11；本地数据库为原生 PostgreSQL。

| 场景                  | 命令                                                                              |
| --------------------- | --------------------------------------------------------------------------------- |
| 首次准备              | `pnpm install` → `pnpm db:local:start` → `pnpm setup:local` → `pnpm db:deploy`    |
| 开发（分别启动）      | `pnpm dev:server`、`pnpm dev:web`、`pnpm dev:electron`                            |
| 静态检查              | `pnpm typecheck`、`pnpm lint`、`pnpm format:check`                                |
| 核心 / 服务端单测     | `pnpm test:core`、`pnpm test`                                                     |
| 数据库集成 / 双端 E2E | `pnpm test:integration`、`pnpm test:e2e`，环境准备见 README                       |
| 构建                  | `pnpm build:web`、`pnpm build:server`、`pnpm build:electron`、`pnpm build:vercel` |
| 打包                  | `pnpm package:web`、`pnpm package:server`、`pnpm package:mac`、`pnpm package:win` |

`pnpm build:server` 统一构建 Web 到 `apps/server/public` 及后端；`pnpm package:server` 将两者放进一个后端包。独立入口 `main.ts` 通过 `web.ts` 托管页面，未构建 Web 时本地可仅提供 API。阿里云 HTTPS 使用 `deploy/nginx-server.conf.example` 全路径转发。

Vercel 项目 Root Directory 为 `apps/server`，`apps/server/vercel.json` 调用根目录 `build:vercel`（复用 `build:server`），Vercel 的 `app.ts` 与独立 `main.ts` 均注册 `web.ts`，由 Fastify 提供页面与 API。`web.ts` 直接枚举 Web 目录以保证 Vercel 文件追踪包含全部资源，不依赖平台静态路由或根路径重写。`apps/server/public` 为忽略的构建产物；普通 Web / Electron 构建仍使用 `apps/web/dist`。控制台须开启根目录之外源码访问、关闭 Skip unaffected projects，保证仅改 Web 也会部署；页面源须加入 `WEB_ORIGINS`。详细切换步骤见 `docs/DEPLOY_TEST.md`。

默认端口：Web 5173、API 3000、PostgreSQL 5432。集成测试会清表，只能连接 `.env.test` 指定且库名以 `_test` 结尾的专用测试库。
Web 使用 `API_PROXY_TARGET`（shell 或 `apps/web/.env.local`，shell 优先）选择后端，统一运行 `pnpm dev:web`；默认本地 HTTP 后端，HTTPS 目标自动启用自签名 HTTPS 并监听 `https://localhost:5173`。远程后端 `WEB_ORIGINS` 需包含该 HTTPS 本地来源。Electron 开发页面独立使用 `http://127.0.0.1:5174`，main 后端地址优先使用 `TYDE_API_BASE_URL`，其次复用 Web 的 `API_PROXY_TARGET` 配置，默认本地后端。
修改后按影响范围验证；认证改动关注双端恢复/退出、过期、重放、限流与并发。测试位置：`tests/security.test.mjs`、`apps/server/tests/`、`tests/e2e/`。

## 按需补充上下文

先按上面的入口读取本次需求涉及的文件，无需常规全仓扫描或加载完整设计。

- 环境准备、具体运行/验证步骤：`README.md`。
- 详细业务规则、设计决策与历史方案：`PROJECT_DESIGN.md`，仅在需求涉及相应内容时查阅；区分设计约定与当前实现。
- 部署与安装：`docs/DEPLOY_TEST.md`、`docs/INSTALL_TRIAL.md`；历史验证结果：`docs/VERIFICATION.md`。
- Web / 后端产物在 `artifacts/`，桌面安装包在 `release/`；这些目录及 `dist/`、`out/`、`.local/`、`node_modules/` 不是业务源码入口。
- 打包阶段通过 `scripts/lib/package-artifacts.mjs` 按平台/类型清理旧产物，保留其他交付类型和测试报告；桌面打包成功后自动生成校验与交付清单。不要将清理改为整体删除 `release/` 或 `artifacts/`。
