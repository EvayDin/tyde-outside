# tyde 架构速览

> 供 Codex 开发新需求时快速定位。按当前实现整理，架构或模块入口变化时同步更新本文。

## 仓库与提交的强制约束

- 严禁在仓库内容或提交内容中包含任何前雇主或第三方组织的非公开信息，以及用户明确禁止出现的组织名称或相关标识。约束文档本身同样适用，不得记录这些名称、标识或其编码形式。
- 检查不区分英文大小写，涵盖受限名称、缩写、拼写变体、域名、URL、邮箱、包名、命名空间、镜像地址及内部服务标识；禁止通过拆分、编码、别名或改名绕过限制。
- 禁止引入、复制、引用或依赖任何前雇主或第三方组织的内部包、SDK、组件、工具、脚本、私有仓库或内部服务，包括直接依赖、传递依赖、开发依赖及构建依赖。替换名称不能使内部实现或依赖合规；必须移除或改用公开可用且来源明确的实现。
- 约束覆盖源码、注释、界面文案、文件与目录名、文档、测试与夹具、配置、环境变量示例、依赖清单、锁文件、生成文件、静态资源、交付产物，以及提交信息和 PR 标题、描述。迁移或复制外部内容前必须先清理相关标识与内部依赖。
- 每次交付或提交前，必须检查本次变更及仓库当前文件的内容、路径、依赖清单和锁文件，并核查拟使用的提交信息与 PR 文案；文本需依据用户明确的限制进行不区分大小写的搜索，二进制资源与产物需检查可提取文本及元数据，依赖需确认来源并排查内部传递依赖。发现违规项必须先修复并复查；无法确认来源或无法消除时停止交付、提交和发布，并向用户说明阻塞原因，不得默默放行。
- 本机规则词表存放于仓库根目录的 `commit-policy.json`，该文件必须保持 Git 忽略，仅供本机校验，不得暂存或提交。

## 项目概况

pnpm Workspace Monorepo，TypeScript + ESM，3 个应用、3 个共享包。
Web 与 Electron 共用一份 React 前端，连接 Fastify 后端；后端是按业务模块组织的单体。后端部署包包含 Web，由 Fastify 统一托管页面与 API；Vercel 使用现有后端项目统一发布。本地仍可分别启动。
当前前端：认证入口提供“验证码登录 / 密码登录”双页签，默认验证码登录；认证接口通过平台适配访问现有后端。短信登录按后端结果区分已有账号与待注册账号；待注册账号在内存中携带手机号、一次性注册凭证进入个人资料页，注册成功后返回密码登录。登录、注册页不主动查询当前用户；工作台与个人中心启动时查询。仅 Vite 开发模式默认由 services/api.ts 返回固定当前用户，VITE_MOCK_CURRENT_USER=false 关闭，生产构建的基础查询始终真实；认证写请求和退出仍访问后端，失败不回退为模拟成功。后端现有能力：密码/短信登录、个人/组织注册、一次性注册凭证、刷新令牌、密码重置、退出、昵称查重、当前用户资料更新，以及上传台账和 OSS 文件接口。真实短信尚未接入；验证规则由后端管理，固定测试码统一定义在 shared 的 `MOCK_SMS_CODE`，后端 `MOCK_CODE` 与前端展示共用该值；页面不另行定义验证码，只在真实发码成功后保留服务端提示并展示测试码，已含验证码时不重复追加。

登录后工作台 `/` 与个人中心 `/profile` 共用 `layouts/WorkspaceLayout.tsx` 顶栏及账户菜单，可从工作台和账户菜单进入个人中心及退出。个人中心位于 `modules/profile/`，分为概览、个人资料与账户安全，默认进入概览，通过现有 `GET /users/me` 读取资料；尚未接入 main 已有的 `POST /users/me/update` 真实写操作。资料编辑、头像更换/清除及登录态改密仍使用 Web / Electron 共用的客户端 `updateProfilePreview` 内存 mock，资料/安全面板明确提示“前端演示”，刷新或退出后清空演示结果；不上传头像、不修改真实密码或撤销真实会话，不持久化密码原文。此演示在开发和构建版均可用，与仅 Vite 开发模式的当前用户预览相互独立。工作台尚未接入项目、排班和申请业务。

工作台顶栏高 64px，账户菜单保留 44px 点击区域。个人中心不单独显示“个人中心”标题，内容距顶栏 16px，昵称作为页面主标题，工作台沿用原内容间距。个人中心为最大 1200px 的个人主页布局：桌面左侧 248px 资料栏展示大圆头像、已有个人资料及有数据时的当前组织，右侧使用横向概览/资料/安全导航；手机为上下排列。`modules/profile/ProfileCharts.tsx` 提供标注“示例数据”的考勤/报量热力图与能力雷达，未来日期不编造报量；项目、个人日志、个人标签及社交功能尚未接入，整块隐藏。按钮使用公共 `settings` / `account` 尺寸；全局根字号为 12px，相关布局使用明确 px。

技术栈：Node.js 24、pnpm 11、React 19、Vite、Tailwind CSS 4、shadcn/ui、React Query、TanStack Router、React Hook Form、Electron 38、Fastify 5、Prisma 6、PostgreSQL。精确版本见各 `package.json` 与 `pnpm-lock.yaml`。

## 模块边界与入口

| 路径                                    | 职责与关键入口                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src`                          | 唯一业务 UI。`app/App.tsx` 管理 TanStack Router Hash 路由、认证入口与个人资料页；`app/providers/index.tsx` 配置 React Query；`components/ui/` 为 shadcn 基础组件，`styles/global.css` 定义 Tailwind 主题；`modules/auth/` 放认证页面                                                                                                                                                                             |
| `apps/web/src/services/api.ts`          | 页面调用入口，基于 `platform.auth`；仅 Vite 开发模式默认 mock 当前用户，`VITE_MOCK_CURRENT_USER=false` 关闭，生产基础查询始终真实；个人中心修改由客户端内存 mock 叠加，不发起真实写请求；`hooks/useSession.ts` 用 React Query 的 `['session']` 管理当前用户；网络或 HTTP 5xx 错误每 3 秒自动重查（后台允许，可能被浏览器节流），成功或 401 后停止，其他 4xx 与响应格式异常保留手动重试，仅重查会话，不重放写请求 |
| `packages/platform/src`                 | 双端适配。`web.ts` 提供双端共用 HTTP 适配器，`index.ts` 为桌面注入可信 API 源和跨源 Cookie 策略，通过 `capabilities` 声明实际已实现的平台能力                                                                                                                                                                                                                                                                    |
| `packages/shared/src`                   | 唯一后端认证 DTO/schema 在 `auth.ts`；API 常量、错误类型、页面 AuthApi 与仅含公开运行配置的 bridge 契约在 `index.ts`；IPC 通道在 `ipc.ts`                                                                                                                                                                                                                                                                        |
| `apps/electron/src`                     | `main/index.ts` 启动与静态资源协议；`main/windows.ts` 安全窗口；`preload/index.ts` 暴露受限 bridge；`main/ipc/index.ts` 校验来源并返回公开 API 源                                                                                                                                                                                                                                                                |
| `apps/electron/src/main`                | `config.ts` 校验可信后端地址；`index.ts` 按后端源隔离持久 Chromium Cookie 并限制可信 API CSP                                                                                                                                                                                                                                                                                                                     |
| `apps/server/src`                       | `main.ts` 本地/独立服务启动；`app.ts` 为 Vercel 默认导出 HTTP server；`application.ts` 装配 Fastify、Prisma、路由、统一错误与健康检查；`config/index.ts` 校验环境变量；`docs.ts` 注册 Swagger；`web.ts` 统一托管构建后的 Web 静态资源                                                                                                                                                                            |
| `apps/server/src/modules/auth`          | `auth.routes.ts` 处理 HTTP、Cookie、客户端类型及昵称/资料接口；`auth.service.ts` 处理认证、资料事务、昵称去重与限流；`security.ts` 放安全规则；`password.ts` 放密码哈希；`sms.ts` 放短信 provider                                                                                                                                                                                                                |
| `apps/server/src/modules/files`         | `object-storage.ts` 使用公开的 ali-oss SDK，为对象统一添加 `tyde/` 物理前缀，分离服务端读写与外网签名端点；`file-registry.service.ts` 管理上传台账、一次性认领与清理；`file.routes.ts` 注册上传、鉴权代理、签名链接及删除接口；`file-validation.ts` 校验类型/内容/大小。已认领项目/考试附件读取待业务权限接入。                                                                                                  |
| `apps/server/src/modules/organizations` | `organization.routes/service/schema.ts` 接入组织资料；`member.service/schema.ts` 接入成员列表、版本编辑与角色转让，写操作锁组织行；`organization-approval.service.ts` 与 `approval.schema.ts` 接入退出/审批；`departure.service.ts` 处理到期离职与待补偿记录；`member-import.parser/service/routes.ts` 与 `import.schema.ts` 接入模板/导入，首次登录事务激活待激活关系。项目成员能力仍待回补。                   |
| `apps/server/src/modules/approval`      | `approval.service.ts` 管理审批流程、节点、配置与操作日志，由组织审批接口调用。                                                                                                                                                                                                                                                                                                                                   |
| `apps/server/prisma`                    | `schema.prisma` 定义数据模型，`migrations/` 管理数据库变更                                                                                                                                                                                                                                                                                                                                                       |
| `packages/config`                       | 共用 TypeScript / ESLint 配置                                                                                                                                                                                                                                                                                                                                                                                    |
| `scripts/`、`deploy/`                   | 本地数据库、验证、打包脚本及 Nginx / systemd 部署模板                                                                                                                                                                                                                                                                                                                                                            |

## 请求与会话链路

```text
React 页面 → services/api → packages/platform
  Web      → 同源 fetch /api/v1 → Vite（开发）或部署服务同域路由 ┐
  Electron → 页面 fetch 可信 API 源（独立持久 Cookie）          ┴→ Fastify 路由 → Service → Prisma → PostgreSQL
```

- API 前缀 `/api/v1`。当前后端认证接口：POST `/auth/sms/send`、`/auth/register`、`/auth/login`、`/auth/sms/login`、`/auth/refresh`、`/auth/password/reset`、`/auth/logout`；GET `/users/me`、`/users/nickname/check`；POST `/users/me/update`。健康检查：GET `/health/live`、`/health/ready`。
- main 已提供本人资料更新，注册昵称全局唯一；头像 URL、简介、实名状态与更新人持久化，更新密码会撤销全部会话。个人中心暂未接入这些真实写操作，仍使用上文客户端内存演示。现有资料接口只接收头像字符串，不做上传台账认领、旧头像释放或读取授权；登录态改密后保留当前会话的语义仍不具备。
- 后端认证使用 `code/message/data` 包装；注册返回用户资料，已注册登录返回 `accessToken/refreshToken/tokenType/expiresIn`；未注册手机号短信登录返回 `status=registration_required/registrationToken/expiresAt`，填写资料后使用凭证注册（10 分钟有效，与注册验证码二选一），不提前创建用户或会话。`role/roles` 可省略，服务端固定为 EXPERT；个人/组织账号类型使用 `accountType`。
- 后端会话使用随机不透明令牌，数据库仅存摘要，默认 30 天。刷新令牌轮换；Web 与桌面会话独立，退出撤销当前会话，重置密码撤销全部会话。
- Web 使用 HttpOnly、SameSite=Lax Cookie 与来源校验；远程环境要求 HTTPS + Secure Cookie。可信桌面来源使用 SameSite=None+Secure Cookie、精确凭据 CORS 与 OPTIONS，DESKTOP_ORIGINS 默认 tyde-app://app，开发回环源须显式配置。Chromium 按 API 源隔离持久 Cookie；非浏览器客户端继续使用原有 Bearer 契约及来源限制。
- 前端平台适配使用上述后端路径及 `code/message/data` 包装。两端页面通过 fetch 使用 HttpOnly 会话 Cookie，登录 JSON 仍包含令牌对；刷新令牌只留在适配器内存，不写页面存储。GET/HEAD 不加自定义客户端头以避免额外预检，写请求使用 X-Tyde-Client: web；IPC 仅返回公开运行配置，不处理认证或业务 HTTP。认证请求遇到 401 最多尝试一次刷新及重试，同一轮刷新合并并发请求；退出不能被晚到刷新重新登录。
- Web 与 Electron 开发/安装包 F12 Network 可查看真实业务 HTTP。Electron 保持 sandbox/contextIsolation/webSecurity，页面不能调用通用 IPC HTTP、文件系统或完整 ipcRenderer。
- 数据表：`User`、`Organization`、`VerificationChallenge`、`RegistrationGrant`、`Session`、`AuthRateLimit`、`UploadedFile`、`UserOrgRel`、`ApprovalProcess`、`ApprovalConfig`、`ApprovalFlow`、`ApprovalNode`、`ApprovalActionLog`、`OrganizationDeparture`、`MemberImportReceipt`。`RegistrationGrant` 复用于一次性注册凭证并保留历史数据，新凭证摘要带用途隔离。验证码消费、注册、刷新与重置依赖事务和数据库锁。
- 组织资料、成员列表/编辑/角色、退出/审批和成员模板/导入接口已由 main 接入。组织权限来自 `UserOrgRel`，版本更新、角色转让和审批依赖事务及组织行锁；项目成员能力待后续模型补齐，成员项目数暂为 null，非 null projectId 返回 503。
- 成员导入使用公开 SheetJS 0.20.3，最多 500 人；`MemberImportReceipt` 提供 24 小时事务幂等。首次密码/短信登录条件激活待激活组织关系。到期离职入口为 `pnpm --filter @tyde/server organizations:departures`，每日调度尚未配置。
- 本次同步保留 main 的 `20261019010000_user_profile`、`20261019020000_organization_memberships`、`20261019030000_approvals`、`20261019040000_member_imports` 四项迁移文件；仅同步源码不执行数据库迁移，部署或联调须另行确认目标库已应用。
- 组织注册营业执照通过上传台账一次性认领，与验证码消费、组织和用户创建同事务；`businessLicenseUrl` 返回 objectKey，未提交为 null。文件存储默认关闭；启用 OSS 时服务端读写使用 `OSS_ENDPOINT`，客户端下载使用 `OSS_PUBLIC_ENDPOINT`，对象统一设为私有且禁止覆盖。独立存储验证命令：`pnpm --filter @tyde/server storage:verify`。已认领项目/考试附件读取仍待业务权限接入。详情见 `docs/API.md`、`docs/AUTH_BACKEND.md` 与部署说明。

## 开发新需求时

- 当前 UI 任务只负责 Web、Electron 和必要客户端适配；同步 main 已有后端代码不属于自行扩展业务。以后端现有 API 和 shared DTO/schema 为准；不得自行新增后端业务接口、修改 Prisma schema 或数据库迁移。用户已授权的后端例外仅为支撑 Electron 页面直接 HTTP 的最小来源/CORS/Cookie 适配，不扩展个人资料业务。已有接口按当前契约对接，剩余语义缺口先列清单并与后端确认，不提前把设计写成已实现契约。个人中心当前只使用客户端 `ProfilePreviewInput` 和 `updateProfilePreview` 演示，不改 shared 后端 DTO，不将模拟保存视为真实写入。
- UI 放 `apps/web/src/modules/<业务>/`，路由接入 `app/App.tsx`；后端模块放 `apps/server/src/modules/<业务>/`，在 `application.ts` 装配。
- Swagger UI 为 `/api/v1/docs/`，JSON/YAML 在其下的 `/json`、`/yaml`；插件必须先于业务路由注册。新增接口补齐 summary、operationId、tags、请求与响应 schema，认证请求 schema 位于 `packages/shared/src/auth.ts`，响应 schema 位于 `auth.schema.ts`；维护说明见 `docs/API.md`。
- Swagger 字段说明是新增/修改接口的必交付项：所有请求、响应、嵌套对象、数组项及参数均需中文 `description`，枚举逐值解释，说明条件必填/默认行为/单位/格式/null，并提供真实可校验示例；未接入和占位能力如实标注。常规枚举使用 `type: string` + `enum`，避免无必要的 `anyOf`。完整规则和验收要求见 `docs/API.md` 的“Swagger 文档标准”。
- 已有 API 的客户端变更同步维护 platform Web/桌面适配、Electron preload/受限 IPC 与页面调用；新增后端 DTO/schema、路由、service 和数据库变更由后端负责人实现。
- UI 统一通过平台适配层访问业务能力；Electron 只承担桌面能力，不复制 React 页面、不内嵌业务后端。
- Web 与 Electron 只维护 `apps/web` 这一份组件、路由和业务逻辑；优先复用 `components/ui/`，不再引入 Ant Design 或另一套路由。按钮尺寸通过公共 `size` 变体管理。
- 认证页当前采用满页浅青背景与右侧白色悬浮卡片。桌面左侧沿用 main 的英文引导、中文主标题与辅助说明层级，使用当前的潮汐主题文案、协作说明和欢迎语。手机端使用相同背景与白卡，隐藏左侧文案。
- 资料页使用 20px 标题并收紧顶部间距，分为“基础信息”（密码、确认密码）与“个人信息”（姓名、昵称、身份证号、邮箱）两段，保留全部字段与校验；375px 宽手机保持两列，仅宽度不超过 360px 时改为单列，手机卡片左右内边距为 16px。初始、校验错误和提交提示状态以在 1280×720 桌面及典型 375px 宽手机视口内单页完整展示为目标，手机和矮窗仍保留自然滚动，不隐藏溢出内容。
- 优先复用现有通用 UI、主题变量和基础样式，认证展示组件放 `modules/auth/components/`。页面只通过 `services/api.ts` 调用平台能力；不重新引入旧认证契约、前端本地验证码 mock 或上传服务。
- 登录、注册页不主动查询 `/users/me`；工作台与个人中心启动时查询，关闭开发预览 mock 或生产构建时恢复真实会话。不自动发起健康检查。发码只在点击且手机号校验通过后请求 `/auth/sms/send`，使用 `scene=login`。当前后端成功 data 为“验证码已发送，请注意查收”，不另设验证码、短信模式或成功重发间隔字段；页面保留服务端提示，并在成功后展示与后端 mock 共用的 shared 常量 `MOCK_SMS_CODE`，不在页面另行写死验证码，提示已含该验证码时不重复追加。接入真实短信时同步移除固定测试码提示；不根据输入本地判定验证成功，也不猜测成功倒计时。HTTP 429 时使用后端 `Retry-After` 禁止重发。失败显示后端错误或网络错误，不显示测试码、不回退到模拟成功。
- `/auth` 提供“验证码登录 / 密码登录”双页签，默认验证码登录，不提供角色或独立注册页签。密码页首次打开即展示“验证码注册”，无需提交。密码与短信提交分别请求 `/auth/login` 与 `/auth/sms/login`；登录后重新获取用户资料再进入欢迎页。验证码注册保留手机号、清空密码与验证码并聚焦验证码输入框，不自动发码。
- 短信登录只有后端返回 `registration_required` 才进入 `/register`。手机号、registrationToken、expiresAt 仅放跨页内存，不进 URL 或持久化存储；凭证过期、刷新、直接访问或离开资料页后须重新验证。资料页不重复填写手机号或验证码，不提供角色、组织注册或材料上传；提交固定 `accountType=INDIVIDUAL` 与后端 DTO 字段。注册成功只创建账号，前端返回密码页并提示登录，不模拟会话。表单密码、姓名、昵称、身份证与邮箱校验和后端规则保持一致。
- 桌面专有入口依据 `platform.capabilities` 显示；只登记已实现的能力，相关路由与调用也须检查可用性。`isElectron` 用于端标识，不能代替能力或业务权限校验。
- 当前后端 API 是唯一联调契约，不依赖原 tyde-web 的 Java 服务；未实现的业务接口先与后端同学约定 shared 类型/schema，再实现双端适配，不接入旧后端，认证失败不模拟成功；个人中心临时演示按上文独立处理。
- IPC 仅用于公开运行配置和已实现的桌面系统能力，不转发业务 HTTP；保留来源及参数校验，不暴露通用 HTTP / 任意 URL 能力。preload 的 IPC 常量从 `@tyde/shared/ipc` 导入。
- 保持 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`；不向 renderer 暴露任意 URL 请求、文件系统或完整 `ipcRenderer`。
- 数据结构变更同时更新 Prisma schema 与迁移。服务端密钥留在后端 `.env`，不进入前端构建、桌面资源或日志。
- 开发和生产前端共用平台适配；当前用户查询的开发例外为 `import.meta.env.DEV && import.meta.env.VITE_MOCK_CURRENT_USER !== 'false'` 时固定当前用户查询，仅用于页面预览。设置 `VITE_MOCK_CURRENT_USER=false` 并重启开发服务恢复真实查询；生产构建的认证与当前用户基础查询始终真实，不允许网络失败时回退为 mock。个人中心的修改演示仅叠加同一用户的内存结果，刷新、退出或更换账号时清空，不影响真实认证。后端当前仅允许开发/测试 mock 短信，`security.ts` 的 `MOCK_CODE` 引用 shared 的 `MOCK_SMS_CODE`，页面发码成功后展示同一测试码；后端 `production` 模式被配置校验阻止启动。短信提供方由后端配置决定，接入真实短信需同时调整 provider、配置校验并移除测试码提示。

## 常用命令与验证

在仓库根目录执行，使用 Node.js 24 与 pnpm 11；开发连接 `.env` 指定的远程 PostgreSQL，需要本机数据库时单独准备。

| 场景                  | 命令                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| 首次准备              | `pnpm install`，配置 `apps/server/.env` 并确认目标库已应用现有迁移                                |
| 本地一键开发          | `pnpm dev:local`：读取 `.env` 的远程开发库配置，启动本机后端及 Electron；Ctrl+C 清理本次进程      |
| 开发（分别启动）      | `pnpm dev:server`、`pnpm dev:web`、`pnpm dev:electron`                                            |
| 静态检查              | `pnpm typecheck`、`pnpm lint`、`pnpm format:check`                                                |
| 提交校验              | `pnpm prepare` 安装 Husky；`pnpm check:staged` 检查索引；`pnpm check:message <文件>` 检查提交信息 |
| 核心 / 服务端单测     | `pnpm test:core`、`pnpm test`                                                                     |
| 前端双端契约回归      | `pnpm test:frontend`，验证开发/生产真实请求契约与 Web/Electron 会话，使用隔离接口替身，无需数据库 |
| 数据库集成 / 双端 E2E | `pnpm test:integration`、`pnpm test:e2e`，环境准备见 README                                       |
| 构建                  | `pnpm build:web`、`pnpm build:server`、`pnpm build:electron`、`pnpm build:vercel`                 |
| 打包                  | `pnpm package:web`、`pnpm package:server`、`pnpm package:mac`、`pnpm package:win`                 |

`pnpm build:server` 统一构建 Web 到 `apps/server/public` 并构建后端；`pnpm package:server` 将两者放进同一个后端包。独立入口 `main.ts` 与 Vercel 入口 `app.ts` 均通过 `web.ts` 托管页面；本地未构建 Web 时仅提供 API。HTTPS 部署可使用 `deploy/nginx-server.conf.example` 将全部路径转发至后端。

`dev:local` 使用忽略的 `apps/server/.env` 数据库配置，文件中的值覆盖 shell 同名配置，支持远程开发库并拒绝 `_test` 库；不启动本机 PostgreSQL、不初始化数据库或自动迁移，目标库迁移由维护者另行执行。后端端口必须空闲，避免复用连接旧库的服务；切换配置先停止原启动命令并退出 Electron，再重启。PostgreSQL 工具支持显式 `PG_BIN` / `PSQL_BIN`，否则查找 Postgres.app、Homebrew PostgreSQL 18 与 PATH。macOS 再次启动 Electron 会重开已关闭窗口或恢复隐藏、最小化窗口；并发启动只创建一个主窗口。

Electron 的 `package:mac` / `package:win` 通过 `scripts/prepare-electron.mjs` 将可信 API 源写入安装包运行配置，默认 `https://aact.pw`，可用 `TYDE_API_BASE_URL` 覆盖。本地开发仍默认连接本机后端。

Vercel 项目 Root Directory 为 `apps/server`，`apps/server/vercel.json` 调用根目录 `build:vercel`（复用 `build:server`）。`web.ts` 枚举 Web 目录以供 Vercel 文件追踪包含全部资源。`apps/server/public` 是忽略的构建产物；普通 Web / Electron 构建仍使用 `apps/web/dist`。控制台须开启根目录之外源码访问、关闭 Skip unaffected projects，并将页面源加入 `WEB_ORIGINS`。详细设置见 `docs/DEPLOY_TEST.md`。

默认端口：Web 3001、Electron 开发页面 5174、API 3000、PostgreSQL 5432。Web 与 Electron 开发/安装包 F12 Network 可查看真实业务 HTTP；普通开发命令不开启主进程 inspector，需要主进程 JavaScript 调试时显式运行 `dev:electron:inspect` 或 `dev:electron:test:inspect`，额外启用 `--inspect=9229` 与 `--experimental-network-inspection`。集成测试会清表，只能连接 `.env.test` 指定且库名以 `_test` 结尾的专用测试库。
Web 通过 `API_PROXY_TARGET`（shell 优先于 `apps/web/.env.local`）选择后端；默认使用本地 HTTP，HTTPS 后端自动启用自签名 HTTPS 并监听 `https://localhost:3001`，后端 `WEB_ORIGINS` 必须包含该来源。Electron 开发页面独立使用 `http://127.0.0.1:5174`，需加入后端 DESKTOP_ORIGINS；可信 API 源依次取 `TYDE_API_BASE_URL`、Web 的 `API_PROXY_TARGET` 配置、本地后端。
Git 的 `pre-commit` 先通过 `scripts/check-commit-policy.mjs` 检查整个暂存索引的路径和文本，再用 lint-staged 只读检查暂存文件的 ESLint / Prettier；`commit-msg` 检查提交信息。规则默认读取仓库根目录已被 Git 忽略的 `commit-policy.json`，也可通过 `TYDE_COMMIT_POLICY_FILE` 指定其他本机文件，`terms` 为非空字符串数组；默认文件缺失时跳过受限内容检查，不影响其他开发者提交及 ESLint / Prettier 校验，现存配置无效、规则为空或显式指定文件缺失时拒绝提交。词表仅用于本机，不随 Git 分发，不得暂存或提交。自动守卫仅覆盖字面匹配和可解码文本；`pnpm-lock.yaml` 的 `packages` 下 `resolution.integrity` 仅对算法、长度与 Base64 格式均合法的摘要载荷避免随机字面误报，其余原文照常检查。二进制内容、编码变体及依赖来源仍须执行上面的完整交付核查。安装入口为 `scripts/install-hooks.mjs`，生产 / CI / 无 Git 的部署目录跳过；全量类型检查和业务测试不在提交钩子中执行。
修改后按影响范围验证；认证改动关注双端恢复/退出、过期、重放、限流与并发。测试位置：`tests/security.test.mjs`、`apps/server/tests/`、`tests/e2e/`。

## 按需补充上下文

先按上面的入口读取本次需求涉及的文件，无需常规全仓扫描或加载完整设计。

- 环境准备、具体运行/验证步骤：`README.md`。
- 详细业务规则、设计决策与历史方案：`PROJECT_DESIGN.md`，仅在需求涉及相应内容时查阅；区分设计约定与当前实现。
- 部署与安装：`docs/DEPLOY_TEST.md`、`docs/INSTALL_TRIAL.md`；历史验证结果：`docs/VERIFICATION.md`。
- Web / 后端产物在 `artifacts/`，桌面安装包在 `release/`；这些目录及 `dist/`、`out/`、`.local/`、`node_modules/` 不是业务源码入口。
- 打包阶段通过 `scripts/lib/package-artifacts.mjs` 按平台/类型清理旧产物，保留其他交付类型和测试报告；桌面打包成功后自动生成校验与交付清单。不要将清理改为整体删除 `release/` 或 `artifacts/`。
