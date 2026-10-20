# tyde

项目原名为 `tyde-outside`。为兼容已有环境，数据库名与角色名、已部署的 Vercel 域名及桌面应用标识 `app.tydeoutside.desktop` 保持原值。

React + Electron + Fastify + PostgreSQL 的 pnpm Monorepo。Web 与桌面共用 `apps/web`，使用 Tailwind CSS、shadcn/ui、TanStack Router 和 React Query。认证入口提供“验证码登录 / 密码登录”双页签，默认验证码登录；认证操作均访问当前后端，支持短信或密码登录、个人注册、会话恢复及退出。前端不生成或在本地校验验证码；当前短信仅 mock，发码成功后保留服务端提示，并展示与后端共用的固定测试码。后端还提供组织注册、刷新令牌、密码重置及文件上传台账，真实短信尚未接入。后端字段和迁移说明见 [认证后端上下文](docs/AUTH_BACKEND.md)。

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

`db:local:start` 自动查找已安装的 Postgres.app、Homebrew PostgreSQL 18 或 PATH 中的 PostgreSQL 工具，在本项目 `.local/postgres` 下创建独立数据库实例，仅监听回环地址 5432，数据不提交 Git。若 Postgres.app 或其他数据库已占用 5432，请选择一种实例运行方式，不要同时启动两个实例。

`setup:local` 创建 `tyde_outside_dev` 角色、开发库和专用自动化测试库，生成随机凭据到 `apps/server/.env` 与 `.env.test`（权限 0600）。它不会覆盖已有 `.env` 或重置已有角色密码。已有数据库时可自行复制 `.env.example` 并配置；特殊 PostgreSQL 路径通过 `PG_BIN` / `PSQL_BIN` 指定。

认证操作访问真实后端，前端不生成或本地校验验证码。Vite 开发模式仅对当前用户查询提供临时页面预览：运行 `pnpm dev:web` 或 `pnpm dev:electron` 后可直接查看 `/#/` 工作台，无需后端。设置 `VITE_MOCK_CURRENT_USER=false` 并重启开发服务即可恢复真实会话查询；生产构建始终真实。登录、注册页不主动查询当前用户，发码、登录、注册和退出仍请求后端，失败不会模拟成功。连接本地后端前需完成上述数据库准备及现有迁移，再启动后端与 Web 或 Electron。短信发送当前仍由后端 mock，固定测试验证码 `095270` 统一定义在 `@tyde/shared` 的 `MOCK_SMS_CODE`；后端通过 `MOCK_CODE` 使用，前端不另行定义，只在发码成功后展示同一值。验证码有效期和校验由后端决定；接入真实短信时须同步移除固定测试码提示。

本地一键启动数据库、后端和 Electron：

```sh
pnpm dev:local
```

该命令按需初始化本地配置、应用本地开发库迁移，确认后端身份及数据库就绪后再启动客户端。Ctrl+C 只停止本次启动的开发进程，保留数据库及原有服务；Electron 正常退出或第二实例转交后，后端保留到 Ctrl+C。`dev:local` 只允许本机 5432 开发库，拒绝远程库和 `_test` 库；使用线上数据库的本地后端须自行配置忽略的 `apps/server/.env`，再分别运行下方命令。

也可分别打开终端：

```sh
# 终端 1：独立后端
pnpm dev:server

# 终端 2：Web
pnpm dev:web

# 终端 3：Electron（自动启动或复用 5174 端口的桌面页面服务）
pnpm dev:electron
```

Web 地址：<http://127.0.0.1:3001>。认证入口默认打开“验证码登录”，可切换“密码登录”，不选择角色或账号类型。两种方式分别访问后端短信登录、密码登录接口；登录成功后查询当前用户并进入欢迎页。首次打开密码页即展示“验证码注册”，点击保留手机号、清空密码和验证码、切回验证码页并聚焦输入框，不自动发码。

发码成功后保留后端实际返回的提示，并补充“测试验证码：095270”；提示已含验证码时不重复追加，失败或限流时不显示测试码。验证码校验、有效期和新老账号判断均由后端完成。当前发码响应为提示文字，不另设验证码或成功后的重发间隔字段，前端不猜测成功倒计时。限流时按 HTTP 429 的 `Retry-After` 倒计时。后端返回新账号注册指引时，手机号与一次性凭证仅在内存中传入 `/#/register`，刷新、直访或凭证过期须重新验证手机号。

资料页保留密码、确认密码、姓名、昵称、身份证号和邮箱，不重复填写手机号或验证码，不提供角色或组织注册。提交调用真实个人注册接口；注册成功后回到密码页提示登录，不自动建立会话。已登录用户刷新可通过后端恢复会话；退出请求成功后清除页面会话缓存。网络或服务错误显示实际错误，不回退为本地 mock，不自动发健康检查。

会话查询遇到网络错误或 HTTP 5xx 时，每 3 秒自动重查；后端热重载恢复后自动继续，成功或返回 401 后停止。其他 4xx 与响应格式异常保留手动重试。后台允许自动重查，但实际计时可能被浏览器节流；仅重查当前会话，不自动重放发码、登录、注册等写请求。

Electron 的 `pnpm dev:electron:test` 加载 `apps/electron/config/test.env` 指定测试后端；shell 中已有的 `TYDE_API_BASE_URL` 优先于文件配置。除开发当前用户预览外，页面通过平台适配直接 fetch 可信后端。IPC 仅返回经校验的公开 API 源；桌面使用按后端源隔离的持久 Chromium Cookie 会话，刷新令牌只保留在适配器内存。

Web 和 Electron 的当前窗口按 `F12` 可查看真实业务 HTTP；开发与本地打包资源均适用。IPC 不承载业务请求，也不提供任意 URL 请求能力。

普通开发命令不启动主进程 inspector。需要调试主进程 JavaScript 时，运行 `pnpm dev:electron:inspect`，测试后端使用 `pnpm dev:electron:test:inspect`；这两条命令额外启用 `--inspect=9229` 和 `--experimental-network-inspection`，可在 Chrome 的 `chrome://inspect` 连接 `localhost:9229`。窗口 F12 Network 不依赖主进程 inspector。

Electron 开发命令监听 main / preload 的文件变更，修改 main 后会自动重建并重启桌面窗口。开发版和安装包主窗口按 `F12` 切换开发者工具；Mac 顶部按键默认控制音量时使用 `Fn + F12`。macOS 关闭窗口后应用仍可能在后台运行，再次启动会重新打开或恢复现有窗口；完全退出可使用 Cmd+Q。

Web 通过 `API_PROXY_TARGET` 切换后端，shell 优先于 `apps/web/.env.local`；默认代理到 `http://127.0.0.1:3000`。例如运行 `API_PROXY_TARGET=https://test.example.com pnpm dev:web`，其中域名须替换为已配置的测试后端。HTTPS 目标会自动启用自签名 HTTPS，Web 地址改为 `https://localhost:3001`，后端 `WEB_ORIGINS` 须包含该来源。生产预览同样可设置 `API_PROXY_TARGET`，浏览器 Origin 由后端校验；请求失败显示实际错误。

Electron main 的后端地址依次取 `TYDE_API_BASE_URL`、shell 或 `apps/web/.env.local` 中的 `API_PROXY_TARGET`、本地后端。桌面页面独立使用 `http://127.0.0.1:5174`，可与 Web 同时开发；切换后端配置后，发码、登录、注册及会话请求均访问所选后端。

mock 不会发送短信或验证真实号码归属，请用约定的测试号码。默认生产模式禁止 mock，真实短信后续在 `apps/server/src/modules/auth/sms.ts` 接入。

## 工作台与接口边界

工作台使用公共顶栏展示账户信息，账户菜单提供退出入口。当前用户通过现有 `GET /api/v1/users/me` 读取，Vite 开发模式可使用上文的固定用户预览。资料修改、头像维护及登录态改密尚未接入。

本次维护 Web、Electron 与必要客户端适配；后端仅包含下述传输支持，数据库 schema 和迁移保持现有版本。以下能力待后端协作，路径和 DTO 尚未约定：

| 缺失能力                       | 现有接口与限制                                                                                   | 当前范围         |
| ------------------------------ | ------------------------------------------------------------------------------------------------ | ---------------- |
| 更新个人资料（身份证、简介等） | 仅有 `GET /users/me`，无资料更新接口；简介目前固定为 null                                        | 待约定接口后接入 |
| 头像关联、替换和清除           | 通用 `/files/upload` 可上传 AVATAR，但没有关联用户、认领和释放旧头像的接口；当前头像固定为 null  | 待约定接口后接入 |
| 登录态修改密码并保留当前会话   | 已有 `/auth/password/reset` 需要手机号和重置场景短信验证码，成功撤销全部会话；不等价于登录态改密 | 待约定接口后接入 |

Electron 页面直接请求可信后端，IPC 仅提供公开运行配置。按用户授权，后端仅补桌面来源校验、精确凭据 CORS / OPTIONS 和跨源 Cookie 支持，不改数据库与个人资料业务。`DESKTOP_ORIGINS` 默认仅允许 `tyde-app://app`，本地开发还需显式加入 `http://127.0.0.1:5174`；桌面使用 `SameSite=None; Secure` Cookie，普通 Web 保留原策略。远程 API 必须 HTTPS，切换此链路需更新后端并重新登录；旧主进程 Bearer 会话不迁移。

## 前后端合并部署

`pnpm build:server` 会先把 Web 构建到 `apps/server/public`，再构建 API；`pnpm package:server` 生成包含 Web 静态资源的后端包。Fastify 直接提供根路径页面和 `/api/v1/*`，HTTPS 使用 `deploy/nginx-server.conf.example` 将全部请求代理至后端。

Vercel 使用同一个后端项目统一发布页面与 API。Root Directory 保持 `apps/server`，其 `vercel.json` 调用根目录 `pnpm build:vercel`，构建时生成 Web 资源，不提交打包产物。独立后端与 Vercel 入口均通过 `web.ts` 提供静态页面。

首次配置需在控制台开启 Root Directory 之外源码访问、关闭 Skip unaffected projects，并将页面访问来源加入 `WEB_ORIGINS`。完整设置与验收见 [Vercel 合并部署说明](docs/DEPLOY_TEST.md#vercel-前后端合并部署)。统一托管沿用同一套认证接口和 Cookie；真实短信尚未接入，当前仅能在后端开发/测试模式联调。

## API 文档（Swagger）

后端启动后访问 <http://127.0.0.1:3000/api/v1/docs/>，或通过 Web 开发代理访问 <http://127.0.0.1:3001/api/v1/docs/>。

- OpenAPI JSON：`/api/v1/docs/json`；YAML：`/api/v1/docs/yaml`。
- 文档覆盖认证、文件与健康检查接口，由 Fastify 路由 schema 动态生成。
- 浏览器调试 POST 时，当前文档页面的源地址必须包含在 `WEB_ORIGINS` 中；默认本地配置使用 Web 3001 地址调试；HTTPS 后端使用对应的 `https://localhost:3001` 来源。

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

### 提交校验

开发依赖安装后，`prepare` 会配置 Husky；已有依赖、重复安装未触发脚本时，运行 `pnpm prepare` 重新启用。提交前执行：

- `pre-commit`：受限内容守卫检查整个暂存索引的路径与文本，再由 lint-staged 对暂存文件执行 ESLint 和 Prettier 检查。保留未暂存修改，不自动修复或格式化文件。
- `commit-msg`：检查提交信息中的受限内容，不额外要求提交信息格式。
- 全量类型检查、核心测试和双端回归仍按上面的命令按需执行；提交钩子不启动数据库或 Electron。

受限词规则按需保存在仓库根目录的 `commit-policy.json`，已加入 `.gitignore`，仅用于本机校验，不得暂存或提交。JSON 对象中的 `terms` 必须是非空字符串数组；也可用 `TYDE_COMMIT_POLICY_FILE` 指定其他本机文件。默认文件不存在时跳过受限内容检查，其他开发者无需配置即可提交，ESLint / Prettier 检查照常执行。文件存在但无效、规则为空，或显式指定的文件缺失时，钩子会阻止提交。具体名称、标识或其编码不得写入受版本控制的文件。

自动守卫按字面、大小写无关匹配路径、UTF-8 和带 BOM 的 UTF-16 文本。`pnpm-lock.yaml` 的 `packages` 下 `resolution.integrity` 中，算法、长度与 Base64 格式均合法的完整性摘要载荷按机器校验数据处理，避免随机字面碰撞；依赖名、地址、其他字段和注释仍照常检查。二进制只检查路径并提示人工核查。二进制文字与元数据、编码变体、内部依赖及来源仍须遵守 `AGENTS.md` 的完整交付检查，不能仅凭钩子通过判定合规。

可手动运行 `pnpm check:staged`，或用 `pnpm check:message <提交信息文件>` 检查消息。Git 客户端需能找到 Node.js 24 与 pnpm 11；使用版本管理器时，可在仓库外的 Husky 启动文件中初始化环境，见 [Husky 官方说明](https://typicode.github.io/husky/how-to.html#node-version-managers-and-guis)。生产安装、CI、设置 `HUSKY=0` 或没有 `.git` 的部署目录不安装钩子。

集成测试会清空专用测试库中的项目表，必须使用 `.env.test` 且库名以 `_test` 结尾。先迁移测试库，再执行：

```sh
cd apps/server
node --env-file=.env.test node_modules/prisma/build/index.js migrate deploy
cd ../..
pnpm test:integration
```

集成测试覆盖真实 PostgreSQL 注册、密码/短信登录、验证码场景隔离、并发与重放、刷新令牌、重置密码下线、组织资料及文件台账。实际执行记录见 [验证记录](docs/VERIFICATION.md)。

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

本机后端配置完成、显式设置 `TYDE_API_BASE_URL=http://127.0.0.1:3000` 构建当前系统安装包后，可运行 `pnpm test:packaged` 检查打包后的本地页面、API 桥接和安全隔离；该检查不启动 Vite。它默认用于连接本机后端的包，远程环境包须另行实际联调。

- Web / 后端部署包在 `artifacts/`，桌面安装包在 `release/`。
- 客户端图标位于 `apps/electron/resources/icon.png`，配套 `icon.icns`（macOS）和 `icon.ico`（Windows）；开发运行使用同一图标，已安装客户端需要重新打包安装才会更新。
- 每次进入打包阶段会自动清理同类型的旧产物（包括旧版本、改名前的包和对应临时目录）；Mac、Windows、Web、后端相互保留。桌面打包成功后自动更新安装说明、SHA-256 与交付清单。Mac 发 `release/` 根目录最新的 `.dmg`，Windows 发 `.exe`，不需要自行压缩 `.app`。打包阶段失败后可能留下不完整输出，应重新成功打包后再分发；需要归档的旧包请提前移出这些输出目录。同一工作区请串行打包。
- Mac 为 universal DMG，覆盖 Apple Silicon 与 Intel；Windows 为 x64 NSIS EXE。
- 桌面打包默认连接 `https://aact.pw`，直接运行 `pnpm package:mac` 或 `pnpm package:win` 即可。本地开发仍默认连接本机后端；如需打包连接其他后端，可通过 `TYDE_API_BASE_URL` 覆盖：

```sh
# macOS
TYDE_API_BASE_URL=https://test.example.com pnpm package:mac
```

```powershell
# Windows PowerShell
$env:TYDE_API_BASE_URL = 'https://test.example.com'
pnpm package:win
```

`test.example.com` 是占位符，必须替换。前端构建不会嵌入后端密钥；Web 使用同源 `/api` 代理，桌面页面从受限 IPC 获取可信 API 源后直接请求后端。安装包中的 React 静态资源来自同一个 `apps/web/dist`。

后端包包含 Web 资源，不包含开发机 `node_modules`，须在 Linux 目标机安装锁定依赖并生成目标平台 Prisma client。[测试部署说明](docs/DEPLOY_TEST.md)包含迁移、Nginx、systemd 与健康检查；[试用安装说明](docs/INSTALL_TRIAL.md)包含 Mac / Windows 授信步骤。

## 目录与工程边界

| 路径              | 职责                                            |
| ----------------- | ----------------------------------------------- |
| apps/web          | 唯一 React 前端、Tailwind / shadcn 页面         |
| apps/electron     | 安全窗口、公开配置 IPC、持久 Cookie、安装包     |
| apps/server       | Fastify 认证、上传台账、数据库、限流与 Web 托管 |
| packages/shared   | 类型、schema、常量和 IPC 契约                   |
| packages/platform | Web fetch / Electron preload 的统一接口         |
| packages/config   | TypeScript / ESLint 配置                        |

`.env`、数据库数据、令牌和打包结果不会提交 Git。

## 双端前端开发

- 页面、组件、Hash 路由和业务逻辑只维护在 `apps/web`；Electron 开发时加载同一 Vite 页面，打包时加载同一份 `apps/web/dist`，不另建 renderer 业务工程。
- 认证页采用满页浅青背景与右侧白色悬浮卡片。桌面左侧沿用 main 的英文引导、中文主标题与辅助说明层级，使用当前的潮汐主题文案、协作说明和欢迎语。手机端使用相同背景与白卡，隐藏左侧文案。
- 资料页使用 20px 标题并收紧顶部间距，分为“基础信息”（密码、确认密码）与“个人信息”（姓名、昵称、身份证号、邮箱）两段，保留全部字段与校验；375px 宽手机保持两列，仅宽度不超过 360px 时改为单列，手机卡片左右内边距为 16px。初始、校验错误和提交提示状态以在 1280×720 桌面及典型 375px 宽手机视口内单页完整展示为目标，手机和矮窗仍保留自然滚动，不隐藏溢出内容。
- 布局优先复用现有组件、主题变量与基础样式。页面控制器统一通过 `services/api.ts` 调用平台适配，除开发当前用户预览外均访问现有真实后端；短信 mock 只在后端执行，页面不创建本地验证码挑战或模拟验证成功。
- 登录、注册页不自动查询当前用户；工作台启动时查询，关闭开发预览或生产构建时恢复真实会话。不自动发起健康检查。开发与生产均请求 `/api/v1/auth/sms/send` 等当前接口；Web 使用同源 Cookie，Electron 页面使用跨源 Cookie 请求可信后端。发码成功显示后端文案，限流倒计时取 `Retry-After`，不会在请求失败时模拟验证码、账号或会话。
- `/#/auth` 提供“验证码登录 / 密码登录”双页签，默认验证码登录，没有独立注册页签或角色选项。密码提交调用真实登录接口；首次进入密码页即提供“验证码注册”，无需先提交。点击注册入口保留手机号、清空密码与验证码并聚焦验证码输入框，不自动发送验证码。
- 短信校验和新老账号判断均由后端完成；只有返回一次性注册凭证的新手机号才进入 `/#/register`。手机号与凭证仅留内存，刷新、直访或离开资料页后须重新验证。资料页保留个人字段，固定按个人账号提交，不提供组织注册或材料上传；成功后回到密码登录并保留手机号，不自动登录。已有会话进入欢迎页，退出成功后清除页面缓存。
- 基础组件在 `apps/web/src/components/ui/`，主题变量在 `src/styles/global.css`；通过 `components.json` 配置 shadcn，源码使用 `@/` 别名。表单由 React Hook Form 管理，服务端数据由 React Query 管理。
- 页面通过 `services/api.ts` 和 `@tyde/platform` 调用当前 Fastify API。浏览器继续使用 HttpOnly Cookie，桌面由页面 fetch，使用独立 Chromium Cookie 会话；前端不改用原 tyde-web 的 Java 服务。
- 桌面专有功能通过 `platform.capabilities` 决定是否展示，Web 隐藏不支持的入口；路由与执行入口也需检查能力。当前没有需要页面调用的系统能力，`capabilities` 为空；不提前声明未实现的文件系统、托盘等能力。
- 新业务接口由后端同学实现；联调前先约定 `packages/shared` 中的 DTO/schema、错误和授权方式，前端维护 Web/Electron 适配。当前认证适配已使用 Swagger 与 `packages/shared/src/auth.ts` 中的路径和响应，不再调用旧认证契约。

无需数据库的前端回归：

```sh
pnpm test:frontend
```

该命令构建共用前端和 Electron，在 5176 启动生产预览、5177 启动开发页面。两种构建模式均使用浏览器路由替身和隔离 HTTP 服务，验证发送成功后展示共享测试码、提示去重、限流、失败提示清理及双端真实请求契约。同时覆盖注册资料页、本地校验、工作台账户菜单、键盘操作、窄屏布局和 Electron 安全隔离。回归关闭开发当前用户预览，断言不调用缺失接口、不在页面创建会话。结果与截图在 `artifacts/`。`pnpm test:e2e` 与打包 API 桥接检查已同步到当前认证契约；真实后端测试需要专用测试库，打包检查需要安装包及对应后端。隔离替身回归通过不代表远程环境联调或安装包验收已完成。

## 常见问题

- pnpm 11 使用 `pnpm-workspace.yaml` 的 `allowBuilds`，不要改回旧 `onlyBuiltDependencies`。白名单只允许 Electron、Prisma、esbuild 的必需脚本，未使用的 Squirrel 打包脚本被禁用。
- electron-builder 固定为 26.15.3，其依赖链支持 npm 发布的 rebuild / node-gyp；不需要关闭 `blockExoticSubdeps` 或覆盖不兼容的 rebuild 主版本。
- `renderer config is missing` 是 electron-vite 对省略 renderer 配置的提示；本项目只让它构建 main / preload，React 由 Web 工程独立构建。
- 首次配置错误时后端明确退出；数据库不可用时 ready 接口返回 503，不会模拟认证成功。
- 开发端口被占用时先检查服务，不自动变更端口。停止项目数据库：`pnpm db:local:stop`；此命令保留所有数据。
- Windows 只做客户端验收不需要数据库；若要用 Windows 打包，只需源码、Node、pnpm，运行 `pnpm install` 后执行打包命令。
