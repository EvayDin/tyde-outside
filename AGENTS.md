# tyde 架构速览

> 供 Codex 开发新需求时快速定位。按当前实现整理，架构或模块入口变化时同步更新本文。

## 仓库与提交的强制约束

- 严禁在仓库内容或提交内容中包含任何前雇主或第三方组织的非公开信息，以及用户明确禁止出现的组织名称或相关标识。约束文档本身同样适用，不得记录这些名称、标识或其编码形式。
- 检查不区分英文大小写，涵盖受限名称、缩写、拼写变体、域名、URL、邮箱、包名、命名空间、镜像地址及内部服务标识；禁止通过拆分、编码、别名或改名绕过限制。
- 禁止引入、复制、引用或依赖任何前雇主或第三方组织的内部包、SDK、组件、工具、脚本、私有仓库或内部服务，包括直接依赖、传递依赖、开发依赖及构建依赖。替换名称不能使内部实现或依赖合规；必须移除或改用公开可用且来源明确的实现。
- 约束覆盖源码、注释、界面文案、文件与目录名、文档、测试与夹具、配置、环境变量示例、依赖清单、锁文件、生成文件、静态资源、交付产物，以及提交信息和 PR 标题、描述。迁移或复制外部内容前必须先清理相关标识与内部依赖。
- 每次交付或提交前，必须检查本次变更及仓库当前文件的内容、路径、依赖清单和锁文件，并核查拟使用的提交信息与 PR 文案；文本需依据用户明确的限制进行不区分大小写的搜索，二进制资源与产物需检查可提取文本及元数据，依赖需确认来源并排查内部传递依赖。发现违规项必须先修复并复查；无法确认来源或无法消除时停止交付、提交和发布，并向用户说明阻塞原因，不得默默放行。

## 项目概况

pnpm Workspace Monorepo，TypeScript + ESM，3 个应用、3 个共享包。
Web 与 Electron 共用一份 React 前端，连接独立 Fastify 后端；后端是按业务模块组织的单体。
当前前端：认证入口提供“验证码登录 / 密码登录”双页签，默认验证码登录；密码提交仅提示暂未开放。开发环境使用本地验证码 mock，输入固定码后按新账号进入个人资料页，不依赖后端或数据库；生产构建保留实际发送适配。真实登录与资料提交尚未开放，不创建模拟会话或账号，不自动请求会话或健康接口。后端现有能力：大陆手机号验证码认证、新用户补资料注册、恢复会话、退出。真实短信尚未接入，其余 API 适配保留供后续联调。

技术栈：Node.js 24、pnpm 11、React 19、Vite、Tailwind CSS 4、shadcn/ui、React Query、TanStack Router、React Hook Form、Electron 38、Fastify 5、Prisma 6、PostgreSQL。精确版本见各 `package.json` 与 `pnpm-lock.yaml`。

## 模块边界与入口

| 路径                           | 职责与关键入口                                                                                                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/src`                 | 唯一业务 UI。`app/App.tsx` 管理 TanStack Router Hash 路由、认证入口与个人资料页；`app/providers/index.tsx` 配置 React Query；`components/ui/` 为 shadcn 基础组件，`styles/global.css` 定义 Tailwind 主题；`modules/auth/` 放认证页面 |
| `apps/web/src/services/api.ts` | 页面调用入口，开发环境覆盖本地验证码发送，生产构建导出 `platform.auth`；`hooks/useSession.ts` 用 React Query 的 `['session']` 管理会话查询                                                                                           |
| `packages/platform/src`        | 双端适配。`index.ts` 根据 `window.tydeDesktop` 选择 Web fetch（`web.ts`）或桌面 bridge（`electron.ts`），通过 `capabilities` 声明实际已实现的平台能力                                                                                |
| `packages/shared/src`          | 公共 DTO、TypeBox 请求 schema、API 常量、错误类型与 bridge 契约在 `index.ts`；IPC 通道在 `ipc.ts`                                                                                                                                    |
| `apps/electron/src`            | `main/index.ts` 启动与静态资源协议；`main/windows.ts` 安全窗口；`preload/index.ts` 暴露受限 bridge；`main/ipc/index.ts` 校验并调用后端                                                                                               |
| `apps/electron/src/main`       | `transport.ts` 发 HTTP 请求；`session.ts` 加密持久化令牌；`config.ts` 校验可信后端地址                                                                                                                                               |
| `apps/server/src`              | `main.ts` 本地/独立服务启动；`app.ts` 为 Vercel 默认导出 HTTP server；`application.ts` 装配 Fastify、Prisma、路由、统一错误与健康检查；`config/index.ts` 校验环境变量；`docs.ts` 注册 Swagger                                        |
| `apps/server/src/modules/auth` | `auth.routes.ts` 处理 HTTP、Cookie、客户端类型；`auth.service.ts` 处理认证、事务、限流；`security.ts` 放安全规则；`sms.ts` 放短信 provider                                                                                           |
| `apps/server/prisma`           | `schema.prisma` 定义数据模型，`migrations/` 管理数据库变更                                                                                                                                                                           |
| `packages/config`              | 共用 TypeScript / ESLint 配置                                                                                                                                                                                                        |
| `scripts/`、`deploy/`          | 本地数据库、验证、打包脚本及 Nginx / systemd 部署模板                                                                                                                                                                                |

## 请求与会话链路

```text
React 页面 → services/api → packages/platform
  Web      → 同源 fetch /api/v1 → Vite（开发）或 Nginx（部署）代理 ┐
  Electron → window.tydeDesktop → preload → IPC → main HTTP 请求 ┴→ Fastify 路由 → Service → Prisma → PostgreSQL
```

- API 前缀为 `/api/v1`。认证接口：POST `/auth/code`、`/auth/verify`、`/auth/register`、`/auth/logout`；GET `/auth/me`。健康检查：GET `/health/live`、`/health/ready`。
- 验证通过后，老用户直接获得会话；新用户得到短期 `registrationToken`，补齐唯一英文用户名与姓名后创建账号和会话。
- 会话是随机不透明令牌，绝对有效期 30 天，数据库仅存摘要；Web 与桌面会话独立，退出只撤销当前会话。
- Web 通过 HttpOnly、SameSite=Lax Cookie 认证，远程环境要求 HTTPS + Secure Cookie；服务端校验来源。
- 桌面 main 以 Bearer 认证，用 Electron `safeStorage` 加密保存令牌，按后端地址隔离；令牌不会返回 renderer。
- 数据表：`User`（账号）、`VerificationChallenge`（验证码挑战）、`RegistrationGrant`（注册凭证）、`Session`（会话）、`AuthRateLimit`（持久化限流）。验证码消费与注册依赖事务和数据库锁保证并发一致性。

## 开发新需求时

- 前后端协作以 shared 类型/schema 和当前 API 契约为准；具体开发范围与人员分工由当前任务确定。
- UI 放 `apps/web/src/modules/<业务>/`，路由接入 `app/App.tsx`；后端模块放 `apps/server/src/modules/<业务>/`，在 `application.ts` 装配。
- Swagger UI 为 `/api/v1/docs/`，JSON/YAML 在其下的 `/json`、`/yaml`；插件必须先于业务路由注册。新增接口补齐 summary、operationId、tags、请求与响应 schema，认证响应 schema 位于 `auth.schema.ts`；维护说明见 `docs/API.md`。
- 涉及双端 API 时同步维护：shared 类型/schema → server 路由与 service → platform Web/桌面适配 → Electron preload 与 IPC → 页面调用。
- UI 统一通过平台适配层访问业务能力；Electron 只承担桌面能力，不复制 React 页面、不内嵌业务后端。
- Web 与 Electron 只维护 `apps/web` 这一份组件、路由和业务逻辑；优先复用 `components/ui/`，不再引入 Ant Design 或另一套路由。按钮尺寸通过公共 `size` 变体管理。
- 认证页当前采用满页浅青背景与右侧白色悬浮卡片。桌面左侧沿用 main 的英文引导、中文主标题与辅助说明层级，使用当前的潮汐主题文案、协作说明和欢迎语。手机端使用相同背景与白卡，隐藏左侧文案。
- 资料页使用 20px 标题并收紧顶部间距，分为“基础信息”（密码、确认密码）与“个人信息”（姓名、昵称、身份证号、邮箱）两段，保留全部字段与校验；375px 宽手机保持两列，仅宽度不超过 360px 时改为单列，手机卡片左右内边距为 16px。初始、校验错误和提交提示状态以在 1280×720 桌面及典型 375px 宽手机视口内单页完整展示为目标，手机和矮窗仍保留自然滚动，不隐藏溢出内容。
- 优先复用现有通用 UI、主题变量和基础样式，认证展示组件放 `modules/auth/components/`。页面控制器通过 `services/api.ts` 发送验证码，其余操作保留本地交互；验证码与密码交互保持现有流程，不迁入旧接口、会话 store 或上传服务。
- 认证页不自动恢复会话、不发起健康检查；只在用户点击获取验证码且手机号校验通过后调用 `api.sendCode`。`services/api.ts` 仅在 `import.meta.env.DEV` 为真时覆盖发送方法，本地返回 mock 结果、固定验证码 `095270`、5 分钟有效期与 60 秒重发间隔，不执行 fetch、IPC 或数据库操作；生产构建继续使用实际平台适配，按后端结果处理发送、重发间隔和限流，只有返回 `mode: 'mock'` 时展示固定测试验证码。真实登录与资料提交仍未开放，不调用验证、注册或会话接口，不模拟账号或会话创建；不得在生产环境使用 mock 登录或注册成功兜底。
- `/auth` 提供“验证码登录 / 密码登录”双页签，默认验证码登录，不提供角色或独立注册页签。首次打开密码页即在表单底部展示“还没有账号？”及公共 Button 小尺寸链接样式的“验证码注册”入口，无需填写密码或提交表单。密码表单必填校验通过并提交后，只显示“密码登录暂未开放，请使用验证码登录或注册。”；不调用密码认证接口、不模拟成功或账号错误。点击“验证码注册”保留手机号，清空密码、验证码、错误、提示与本地验证码挑战，切回验证码页签并聚焦验证码输入框，不自动发送验证码。
- 开发环境先获取本地验证码，再输入 `095270` 点击继续，校验当前手机号和 5 分钟有效期后按新账号进入 `/register`；错误码、未获取、换号或过期均不能通过，刷新或离开登录页清空本地挑战。生产构建的继续操作仍提示未开放，后续真实流程需按后端返回区分新老账号。资料页不重复填写手机号或验证码，不提供角色、组织注册或材料上传，最终提交仍提示未开放。输入只留在组件内存，刷新或离开当前页面清空。个人资料字段不等同于当前后端 DTO，联调前先与后端同学对齐。
- 桌面专有入口依据 `platform.capabilities` 显示；只登记已实现的能力，相关路由与调用也须检查可用性。`isElectron` 用于端标识，不能代替能力或业务权限校验。
- 当前后端 API 是唯一联调契约，不依赖原 tyde-web 的 Java 服务；未实现的业务接口先与后端同学约定 shared 类型/schema，再实现双端适配，不接入旧后端或在生产页面模拟成功。
- 新增 IPC 使用明确通道和固定后端路径，保留来源及参数校验；preload 的 IPC 常量从 `@tyde/shared/ipc` 导入。
- 保持 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`；不向 renderer 暴露任意 URL 请求、文件系统或完整 `ipcRenderer`。
- 数据结构变更同时更新 Prisma schema 与迁移。服务端密钥留在后端 `.env`，不进入前端构建、桌面资源或日志。
- 前端本地验证码 mock 仅在开发模式启用，生产构建必须保留实际平台适配，不允许在网络失败时回退为 mock。后端当前仅允许开发/测试 mock 短信，固定验证码是字符串 `095270`；后端 `production` 模式被配置校验阻止启动。接入真实短信需同时调整 provider 和配置校验。

## 常用命令与验证

在仓库根目录执行，使用 Node.js 24 与 pnpm 11；本地数据库为原生 PostgreSQL。

| 场景                  | 命令                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------- |
| 首次准备              | `pnpm install` → `pnpm db:local:start` → `pnpm setup:local` → `pnpm db:deploy`           |
| 开发（分别启动）      | `pnpm dev:server`、`pnpm dev:web`、`pnpm dev:electron`                                   |
| 静态检查              | `pnpm typecheck`、`pnpm lint`、`pnpm format:check`                                       |
| 核心 / 服务端单测     | `pnpm test:core`、`pnpm test`                                                            |
| 前端双端契约回归      | `pnpm test:frontend`，验证开发本地 mock 与生产双端请求契约，使用隔离接口替身，无需数据库 |
| 数据库集成 / 双端 E2E | `pnpm test:integration`、`pnpm test:e2e`，环境准备见 README                              |
| 构建                  | `pnpm build:web`、`pnpm build:server`、`pnpm build:electron`                             |
| 打包                  | `pnpm package:web`、`pnpm package:server`、`pnpm package:mac`、`pnpm package:win`        |

默认端口：Web 3001、API 3000、PostgreSQL 5432。集成测试会清表，只能连接 `.env.test` 指定且库名以 `_test` 结尾的专用测试库。
修改后按影响范围验证；认证改动关注双端恢复/退出、过期、重放、限流与并发。测试位置：`tests/security.test.mjs`、`apps/server/tests/`、`tests/e2e/`。

## 按需补充上下文

先按上面的入口读取本次需求涉及的文件，无需常规全仓扫描或加载完整设计。

- 环境准备、具体运行/验证步骤：`README.md`。
- 详细业务规则、设计决策与历史方案：`PROJECT_DESIGN.md`，仅在需求涉及相应内容时查阅；区分设计约定与当前实现。
- 部署与安装：`docs/DEPLOY_TEST.md`、`docs/INSTALL_TRIAL.md`；历史验证结果：`docs/VERIFICATION.md`。
- Web / 后端产物在 `artifacts/`，桌面安装包在 `release/`；这些目录及 `dist/`、`out/`、`.local/`、`node_modules/` 不是业务源码入口。
- 打包阶段通过 `scripts/lib/package-artifacts.mjs` 按平台/类型清理旧产物，保留其他交付类型和测试报告；桌面打包成功后自动生成校验与交付清单。不要将清理改为整体删除 `release/` 或 `artifacts/`。
