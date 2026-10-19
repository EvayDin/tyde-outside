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
Web 与 Electron 共用一份 React 前端，连接 Fastify 后端；后端是按业务模块组织的单体。后端部署包包含 Web，由 Fastify 统一托管页面与 API；Vercel 使用现有后端项目统一发布。本地仍可分别启动。
当前前端：认证入口提供“验证码登录 / 密码登录”双页签，默认验证码登录；开发和生产均通过平台适配访问真实后端。短信登录按后端结果区分已有账号与待注册账号；待注册账号在内存中携带手机号、一次性注册凭证进入个人资料页，注册成功后返回密码登录。会话恢复、当前用户及退出均访问后端，页面不生成验证码或模拟账号、会话。后端现有能力：密码/短信登录、个人/组织注册、一次性注册凭证、刷新令牌、密码重置、退出、昵称查重、当前用户资料更新，以及上传台账和 OSS 文件接口。真实短信尚未接入；验证规则由后端管理，固定测试码统一定义在 shared 的 `MOCK_SMS_CODE`，后端 `MOCK_CODE` 与前端展示共用该值；页面不另行定义验证码，只在真实发码成功后保留服务端提示并展示测试码，已含验证码时不重复追加。

技术栈：Node.js 24、pnpm 11、React 19、Vite、Tailwind CSS 4、shadcn/ui、React Query、TanStack Router、React Hook Form、Electron 38、Fastify 5、Prisma 6、PostgreSQL。精确版本见各 `package.json` 与 `pnpm-lock.yaml`。

## 模块边界与入口

| 路径                                    | 职责与关键入口                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src`                          | 唯一业务 UI。`app/App.tsx` 管理 TanStack Router Hash 路由、认证入口与个人资料页；`app/providers/index.tsx` 配置 React Query；`components/ui/` 为 shadcn 基础组件，`styles/global.css` 定义 Tailwind 主题；`modules/auth/` 放认证页面                                                                                                                                                                                               |
| `apps/web/src/services/api.ts`          | 页面调用入口，两种构建均导出 `platform.auth`；`hooks/useSession.ts` 用 React Query 的 `['session']` 管理当前用户，401 表示无会话，网络或服务错误保留重试入口                                                                                                                                                                                                                                                                       |
| `packages/platform/src`                 | 双端适配。`index.ts` 根据 `window.tydeDesktop` 选择 Web fetch（`web.ts`）或桌面 bridge（`electron.ts`），通过 `capabilities` 声明实际已实现的平台能力                                                                                                                                                                                                                                                                              |
| `packages/shared/src`                   | 唯一后端认证 DTO/schema 在 `auth.ts`；API 常量、错误类型、页面 AuthApi 与不含登录令牌的 bridge 契约在 `index.ts`；IPC 通道在 `ipc.ts`                                                                                                                                                                                                                                                                                              |
| `apps/electron/src`                     | `main/index.ts` 启动与静态资源协议；`main/windows.ts` 安全窗口；`preload/index.ts` 暴露受限 bridge；`main/ipc/index.ts` 校验并调用后端                                                                                                                                                                                                                                                                                             |
| `apps/electron/src/main`                | `transport.ts` 发 HTTP 请求；`session.ts` 加密持久化令牌；`config.ts` 校验可信后端地址                                                                                                                                                                                                                                                                                                                                             |
| `apps/server/src`                       | `main.ts` 本地/独立服务启动；`app.ts` 为 Vercel 默认导出 HTTP server；`application.ts` 装配 Fastify、Prisma、路由、统一错误与健康检查；`config/index.ts` 校验环境变量；`docs.ts` 注册 Swagger；`web.ts` 统一托管构建后的 Web 静态资源                                                                                                                                                                                              |
| `apps/server/src/modules/auth`          | `auth.routes.ts` 处理 HTTP、Cookie、客户端类型及昵称/资料接口；`auth.service.ts` 处理认证、资料事务、昵称去重与限流；`security.ts` 放安全规则；`password.ts` 放密码哈希；`sms.ts` 放短信 provider                                                                                                                                                                                                                                  |
| `apps/server/src/modules/files`         | `object-storage.ts` 使用公开的 ali-oss SDK，为对象统一添加 `tyde/` 物理前缀，分离服务端读写与外网签名端点；`file-registry.service.ts` 管理上传台账、一次性认领与清理；`file.routes.ts` 注册上传、鉴权代理、签名链接及删除接口；`file-validation.ts` 校验类型/内容/大小。已认领项目/考试附件读取待业务权限接入。                                                                                                                    |
| `apps/server/src/modules/organizations` | `organization.routes/service/schema.ts` 接入组织资料；`member.service/schema.ts` 接入成员列表、版本编辑与角色转让，写操作锁组织行；`organization-approval.service.ts` 与 `approval.schema.ts` 接入退出/审批；`departure.service.ts` 处理到期离职与待补偿记录；`member-import.parser/service/routes.ts` 与 `import.schema.ts` 接入模板/导入，首次登录事务激活待激活关系。成员导入及首次激活专用库集成已通过；项目成员能力仍待回补。 |
| `apps/server/src/modules/approval`      | `approval.service.ts` 管理审批流程、节点、配置与操作日志，由组织审批接口调用。                                                                                                                                                                                                                                                                                                                                                     |
| `apps/server/prisma`                    | `schema.prisma` 定义数据模型，`migrations/` 管理数据库变更                                                                                                                                                                                                                                                                                                                                                                         |
| `packages/config`                       | 共用 TypeScript / ESLint 配置                                                                                                                                                                                                                                                                                                                                                                                                      |
| `scripts/`、`deploy/`                   | 本地数据库、验证、打包脚本及 Nginx / systemd 部署模板                                                                                                                                                                                                                                                                                                                                                                              |

## 请求与会话链路

```text
React 页面 → services/api → packages/platform
  Web      → 同源 fetch /api/v1 → Vite（开发）或部署服务同域路由 ┐
  Electron → window.tydeDesktop → preload → IPC → main HTTP 请求 ┴→ Fastify 路由 → Service → Prisma → PostgreSQL
```

- API 前缀 `/api/v1`。当前后端认证接口：POST `/auth/sms/send`、`/auth/register`、`/auth/login`、`/auth/sms/login`、`/auth/refresh`、`/auth/password/reset`、`/auth/logout`；GET `/users/me`、`/users/nickname/check`；POST `/users/me/update`。健康检查：GET `/health/live`、`/health/ready`。
- 用户资料更新仅允许本人，昵称全局唯一，`roles` 固定为 EXPERT；头像、简介、实名状态与更新人持久化。资料更新中修改密码会撤销全部会话，涉及 `20261019010000_user_profile` 迁移。
- 后端认证使用 `code/message/data` 包装；注册返回用户资料，已注册登录返回 `accessToken/refreshToken/tokenType/expiresIn`；未注册手机号短信登录返回 `status=registration_required/registrationToken/expiresAt`，填写资料后使用凭证注册（10 分钟有效，与注册验证码二选一），不提前创建用户或会话。`role/roles` 可省略，服务端固定为 EXPERT；个人/组织账号类型使用 `accountType`。
- 后端会话使用随机不透明令牌，数据库仅存摘要，默认 30 天。刷新令牌轮换；Web 与桌面会话独立，退出撤销当前会话，重置密码撤销全部会话。
- Web 使用 HttpOnly、SameSite=Lax Cookie 与来源校验；远程环境要求 HTTPS + Secure Cookie。桌面 main 使用 Bearer，以 Electron `safeStorage` 加密保存令牌，按后端地址隔离，令牌不返回 renderer。无浏览器头和 Cookie 的普通 API 客户端无需额外客户端头。
- 前端平台适配使用上述后端路径及 `code/message/data` 包装。Web 使用 HttpOnly Cookie，刷新令牌只留在平台适配器内存；Electron main 加密保管访问/刷新令牌对，IPC 返回登录状态、注册指引或用户资料，不返回登录令牌。认证请求遇到 401 最多尝试一次刷新及重试，同一轮刷新合并并发请求；退出不能被晚到刷新重新登录。
- 开发客户端的 IPC 校验后签发一次性请求票据，由 preload fetch `tyde-debug://desktop/api/v1/...`，通过 `main/development-network.ts` 校验票据、原窗口、路径、方法、来源和参数后执行真实 main HTTP 调用；当前窗口 F12 Network 可查看代理请求和不含登录令牌的 bridge 响应。票据 30 秒有效且仅可消费一次，最多等待 128 项；安装包不注册该协议，仍由 IPC 返回结果。
- 数据表：`User`、`Organization`、`VerificationChallenge`、`RegistrationGrant`、`Session`、`AuthRateLimit`、`UploadedFile`、`UserOrgRel`、`ApprovalProcess`、`ApprovalConfig`、`ApprovalFlow`、`ApprovalNode`、`ApprovalActionLog`、`OrganizationDeparture`、`MemberImportReceipt`。`RegistrationGrant` 复用于一次性注册凭证并保留历史数据，新凭证摘要带用途隔离。验证码消费、注册、刷新与重置依赖事务和数据库锁。
- 03已接入组织资料、成员列表/编辑/角色接口；`UserOrgRel`是组织权限来源，版本条件更新与角色转让在组织行锁事务内。认证资料从有效多组织关系中选OWNER优先/最早加入的组织，营业执照也按指定组织成员关系授权。`hasExpertManagementRole`当前仅实现OWNER分支，组织项目负责人待07。成员列表项目数暂为null，非null projectId明确503，待04项目成员模型回补。`20261019020000_organization_memberships`已应用专用测试库，第6个迁移20261019030000_approvals也已应用专用库；既有203项单测通过（本次未重跑）；用户已应用第7迁移20261019040000_member_imports至专用测试库，2026-10-19 16:26:59复跑74项集成全部通过（总23.77秒），03已交接04；用户随后也已在开发库应用全部7个迁移；部署库迁移和兼容验收仍待完成。
- 退出/审批API-021—024已接入，流程/节点双版本与成员/日志同事务；主管转让不自动转派已有待办。LEFT同事务写OrganizationDeparture PENDING记录，项目清退/负责人/人员变动/事件待04/07/12/14，API-021/024保留部分迁移。到期组织离职命令为 `pnpm --filter @tyde/server organizations:departures`，部署用编译入口dist/organizations-departures.js；每日上海零点调度未配置。
- 成员模板GET `/organizations/member-imports/template`和multipart导入POST `/organizations/member-imports/generate`已接入：SheetJS官方0.20.3支持XLS/XLSX，CSV/文本支持旧字段与中文/英文值；最多500人、全量错误HTTP400保留data。MemberImportReceipt提供24小时事务幂等，新增迁移20261019040000_member_imports已由用户应用专用测试库，74项集成复测全部通过，当前入口已交接04；开发库也已由用户迁移，部署库尚待迁移。导入/登录锁顺序为手机号升序→组织升序→关系；首次密码/SMS成功登录条件激活并版本+1，失败回滚且不发令牌，刷新/重置不激活。
- 组织注册营业执照通过上传台账一次性认领，与验证码消费、组织和用户创建同事务；`businessLicenseUrl` 返回 objectKey，未提交为 null。文件存储默认关闭；启用 OSS 时服务端读写使用 `OSS_ENDPOINT`，客户端下载使用 `OSS_PUBLIC_ENDPOINT`，对象统一设为私有且禁止覆盖。独立存储验证命令：`pnpm --filter @tyde/server storage:verify`。已认领项目/考试附件读取仍待业务权限接入。详情见 `docs/API.md`、`docs/AUTH_BACKEND.md` 与部署说明。

本地提交前联调补充：2026-10-19重新运行203项单测及服务端类型/ESLint检查通过；组织注册500由开发库Organization.verifyStatus缺列引起，用户应用全部7个迁移并重启后，41项业务HTTP复测全部符合预期，故障已消除。详细证据和外部提交规则缺失遗留见根目录03任务记录，默认入口仍为04。

## 开发新需求时

- 前后端协作以 shared 类型/schema 和当前 API 契约为准；具体开发范围与人员分工由当前任务确定。
- UI 放 `apps/web/src/modules/<业务>/`，路由接入 `app/App.tsx`；后端模块放 `apps/server/src/modules/<业务>/`，在 `application.ts` 装配。
- Swagger UI 为 `/api/v1/docs/`，JSON/YAML 在其下的 `/json`、`/yaml`；插件必须先于业务路由注册。新增接口补齐 summary、operationId、tags、请求与响应 schema，认证请求 schema 位于 `packages/shared/src/auth.ts`，响应 schema 位于 `auth.schema.ts`；维护说明见 `docs/API.md`。
- Swagger 字段说明是新增/修改接口的必交付项：所有请求、响应、嵌套对象、数组项及参数均需中文 `description`，枚举逐值解释，说明条件必填/默认行为/单位/格式/null，并提供真实可校验示例；未接入和占位能力如实标注。常规枚举使用 `type: string` + `enum`，避免无必要的 `anyOf`。完整规则和验收要求见 `docs/API.md` 的“Swagger 文档标准”。
- 涉及双端 API 时同步维护：shared 类型/schema → server 路由与 service → platform Web/桌面适配 → Electron preload 与 IPC → 页面调用。
- UI 统一通过平台适配层访问业务能力；Electron 只承担桌面能力，不复制 React 页面、不内嵌业务后端。
- Web 与 Electron 只维护 `apps/web` 这一份组件、路由和业务逻辑；优先复用 `components/ui/`，不再引入 Ant Design 或另一套路由。按钮尺寸通过公共 `size` 变体管理。
- 认证页当前采用满页浅青背景与右侧白色悬浮卡片。桌面左侧沿用 main 的英文引导、中文主标题与辅助说明层级，使用当前的潮汐主题文案、协作说明和欢迎语。手机端使用相同背景与白卡，隐藏左侧文案。
- 资料页使用 20px 标题并收紧顶部间距，分为“基础信息”（密码、确认密码）与“个人信息”（姓名、昵称、身份证号、邮箱）两段，保留全部字段与校验；375px 宽手机保持两列，仅宽度不超过 360px 时改为单列，手机卡片左右内边距为 16px。初始、校验错误和提交提示状态以在 1280×720 桌面及典型 375px 宽手机视口内单页完整展示为目标，手机和矮窗仍保留自然滚动，不隐藏溢出内容。
- 优先复用现有通用 UI、主题变量和基础样式，认证展示组件放 `modules/auth/components/`。页面只通过 `services/api.ts` 调用平台能力；不重新引入旧认证契约、前端本地验证码 mock 或上传服务。
- 页面启动可查询 `/users/me` 恢复真实会话，不自动发起健康检查。发码只在点击且手机号校验通过后请求 `/auth/sms/send`，使用 `scene=login`。当前后端成功 data 为“验证码已发送，请注意查收”，不另设验证码、短信模式或成功重发间隔字段；页面保留服务端提示，并在成功后展示与后端 mock 共用的 shared 常量 `MOCK_SMS_CODE`，不在页面另行写死验证码，提示已含该验证码时不重复追加。接入真实短信时同步移除固定测试码提示；不根据输入本地判定验证成功，也不猜测成功倒计时。HTTP 429 时使用后端 `Retry-After` 禁止重发。失败显示后端错误或网络错误，不显示测试码、不回退到模拟成功。
- `/auth` 提供“验证码登录 / 密码登录”双页签，默认验证码登录，不提供角色或独立注册页签。密码页首次打开即展示“验证码注册”，无需提交。密码与短信提交分别请求 `/auth/login` 与 `/auth/sms/login`；登录后重新获取用户资料再进入欢迎页。验证码注册保留手机号、清空密码与验证码并聚焦验证码输入框，不自动发码。
- 短信登录只有后端返回 `registration_required` 才进入 `/register`。手机号、registrationToken、expiresAt 仅放跨页内存，不进 URL 或持久化存储；凭证过期、刷新、直接访问或离开资料页后须重新验证。资料页不重复填写手机号或验证码，不提供角色、组织注册或材料上传；提交固定 `accountType=INDIVIDUAL` 与后端 DTO 字段。注册成功只创建账号，前端返回密码页并提示登录，不模拟会话。表单密码、姓名、昵称、身份证与邮箱校验和后端规则保持一致。
- 桌面专有入口依据 `platform.capabilities` 显示；只登记已实现的能力，相关路由与调用也须检查可用性。`isElectron` 用于端标识，不能代替能力或业务权限校验。
- 当前后端 API 是唯一联调契约，不依赖原 tyde-web 的 Java 服务；未实现的业务接口先与后端同学约定 shared 类型/schema，再实现双端适配，不接入旧后端或在生产页面模拟成功。
- 新增 IPC 使用明确通道和固定后端路径，保留来源及参数校验；preload 的 IPC 常量从 `@tyde/shared/ipc` 导入。
- 保持 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`；不向 renderer 暴露任意 URL 请求、文件系统或完整 `ipcRenderer`。
- 数据结构变更同时更新 Prisma schema 与迁移。服务端密钥留在后端 `.env`，不进入前端构建、桌面资源或日志。
- 开发和生产前端使用同一套真实平台适配，不允许在网络失败时回退为 mock。后端当前仅允许开发/测试 mock 短信，`security.ts` 的 `MOCK_CODE` 引用 shared 的 `MOCK_SMS_CODE`，页面发码成功后展示同一测试码；后端 `production` 模式被配置校验阻止启动。短信提供方由后端配置决定，接入真实短信需同时调整 provider、配置校验并移除测试码提示。

## 常用命令与验证

在仓库根目录执行，使用 Node.js 24 与 pnpm 11；本地数据库为原生 PostgreSQL。

| 场景                  | 命令                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| 首次准备              | `pnpm install` → `pnpm db:local:start` → `pnpm setup:local` → `pnpm db:deploy`                    |
| 开发（分别启动）      | `pnpm dev:server`、`pnpm dev:web`、`pnpm dev:electron`                                            |
| 静态检查              | `pnpm typecheck`、`pnpm lint`、`pnpm format:check`                                                |
| 提交校验              | `pnpm prepare` 安装 Husky；`pnpm check:staged` 检查索引；`pnpm check:message <文件>` 检查提交信息 |
| 核心 / 服务端单测     | `pnpm test:core`、`pnpm test`                                                                     |
| 前端双端契约回归      | `pnpm test:frontend`，验证开发/生产真实请求契约与 Web/Electron 会话，使用隔离接口替身，无需数据库 |
| 数据库集成 / 双端 E2E | `pnpm test:integration`、`pnpm test:e2e`，环境准备见 README                                       |
| 构建                  | `pnpm build:web`、`pnpm build:server`、`pnpm build:electron`、`pnpm build:vercel`                 |
| 打包                  | `pnpm package:web`、`pnpm package:server`、`pnpm package:mac`、`pnpm package:win`                 |

`pnpm build:server` 统一构建 Web 到 `apps/server/public` 并构建后端；`pnpm package:server` 将两者放进同一个后端包。独立入口 `main.ts` 与 Vercel 入口 `app.ts` 均通过 `web.ts` 托管页面；本地未构建 Web 时仅提供 API。HTTPS 部署可使用 `deploy/nginx-server.conf.example` 将全部路径转发至后端。

Electron 的 `package:mac` / `package:win` 通过 `scripts/prepare-electron.mjs` 将可信 API 源写入安装包运行配置，默认 `https://aact.pw`，可用 `TYDE_API_BASE_URL` 覆盖。本地开发仍默认连接本机后端。

Vercel 项目 Root Directory 为 `apps/server`，`apps/server/vercel.json` 调用根目录 `build:vercel`（复用 `build:server`）。`web.ts` 枚举 Web 目录以供 Vercel 文件追踪包含全部资源。`apps/server/public` 是忽略的构建产物；普通 Web / Electron 构建仍使用 `apps/web/dist`。控制台须开启根目录之外源码访问、关闭 Skip unaffected projects，并将页面源加入 `WEB_ORIGINS`。详细设置见 `docs/DEPLOY_TEST.md`。

默认端口：Web 3001、Electron 开发页面 5174、API 3000、PostgreSQL 5432。开发客户端 F12 Network 可筛选 `tyde-debug` 查看本地代理请求；普通开发命令不开启主进程 inspector，需要上游 Node HTTP 调试时显式运行 `dev:electron:inspect` 或 `dev:electron:test:inspect`，额外启用 `--inspect=9229` 与 `--experimental-network-inspection`。集成测试会清表，只能连接 `.env.test` 指定且库名以 `_test` 结尾的专用测试库。
Web 通过 `API_PROXY_TARGET`（shell 优先于 `apps/web/.env.local`）选择后端；默认使用本地 HTTP，HTTPS 后端自动启用自签名 HTTPS 并监听 `https://localhost:3001`，后端 `WEB_ORIGINS` 必须包含该来源。Electron 开发页面独立使用 `http://127.0.0.1:5174`，main 后端地址依次取 `TYDE_API_BASE_URL`、Web 的 `API_PROXY_TARGET` 配置、本地后端。
Git 的 `pre-commit` 先通过 `scripts/check-commit-policy.mjs` 检查整个暂存索引的路径和文本，再用 lint-staged 只读检查暂存文件的 ESLint / Prettier；`commit-msg` 检查提交信息。规则必须来自仓库外的 `~/.config/tyde/commit-policy.json` 或 `TYDE_COMMIT_POLICY_FILE`，`terms` 为非空字符串数组；缺失、无效或指向仓库内均拒绝提交，不把具体规则写回仓库。自动守卫仅覆盖字面匹配和可解码文本；`pnpm-lock.yaml` 的 `packages` 下 `resolution.integrity` 仅对算法、长度与 Base64 格式均合法的摘要载荷避免随机字面误报，其余原文照常检查。二进制内容、编码变体及依赖来源仍须执行上面的完整交付核查。安装入口为 `scripts/install-hooks.mjs`，生产 / CI / 无 Git 的部署目录跳过；全量类型检查和业务测试不在提交钩子中执行。
修改后按影响范围验证；认证改动关注双端恢复/退出、过期、重放、限流与并发。测试位置：`tests/security.test.mjs`、`apps/server/tests/`、`tests/e2e/`。

## 按需补充上下文

先按上面的入口读取本次需求涉及的文件，无需常规全仓扫描或加载完整设计。

- 环境准备、具体运行/验证步骤：`README.md`。
- 详细业务规则、设计决策与历史方案：`PROJECT_DESIGN.md`，仅在需求涉及相应内容时查阅；区分设计约定与当前实现。
- 部署与安装：`docs/DEPLOY_TEST.md`、`docs/INSTALL_TRIAL.md`；历史验证结果：`docs/VERIFICATION.md`。
- Web / 后端产物在 `artifacts/`，桌面安装包在 `release/`；这些目录及 `dist/`、`out/`、`.local/`、`node_modules/` 不是业务源码入口。
- 打包阶段通过 `scripts/lib/package-artifacts.mjs` 按平台/类型清理旧产物，保留其他交付类型和测试报告；桌面打包成功后自动生成校验与交付清单。不要将清理改为整体删除 `release/` 或 `artifacts/`。
