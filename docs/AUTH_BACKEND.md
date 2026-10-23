# 注册登录后端迁移上下文

> 2026-10-22现行规则：统一注册自带NAVIGATOR/PM/EXPERT，登录默认EXPERT，允许提交本机记住的role；API-121切换当前会话，刷新保留角色。独立创建组织API-124即ACTIVE/APPROVED、本人ACTIVE/OWNER；API-008/015返回实际会话角色、三角色和organizations数组。以下早期执行记录中的固定EXPERT、组织注册和独立授权描述仅为历史。详见[统一账号与组织创建](UNIFIED_ACCOUNTS.md)。本轮证据见[插队任务](../../backend-migration/priority-unified-accounts/todoTask.md)。

## 约定与范围（2026-10-16）

- 用户负责后端，本次仅修改 `apps/server`、后端需要的共享 DTO/schema 和 Markdown 文档；不修改 Web、Electron、平台适配层或前端 E2E。
- 旧接口来源：`../tyde-core/src/main/java/com/tyde/platform/module/auth/controller/{AuthController,SmsAuthController}.java`，请求/响应字段来自同模块 `dto/`，用户响应来自 `module/user/dto/UserDTO.java`。
- 保持旧接口名称、路径和字段名；不再要求选择身份。账号注册自带三角色，User.role兼容存储仍为EXPERT，实际角色来自Session.selectedRole；登录role选填、默认EXPERT，不含OPS。
- 当前统一注册；accountType为选填兼容字段且只接受INDIVIDUAL；不再在注册时创建组织，独立创建见POST /organizations。
- 沿用新项目 Fastify + Prisma + PostgreSQL，不复制 Spring/Redis 基础设施；新旧项目数据库和令牌不互通。

## 接口契约

前缀 `/api/v1`；成功 HTTP 200，响应 `{ "code": 200, "message": "操作成功", "data": ... }`。错误同样使用 `code/message/data`，`data` 为 null；常见业务码 400/401/403/404/409/413/500/503，频率限制 4292（HTTP 429，含 `Retry-After`）。

| 方法与路径                  | 请求字段                                                    | 成功 data                |
| --------------------------- | ----------------------------------------------------------- | ------------------------ |
| POST `/auth/sms/send`       | `phone`, `scene`（`login` / `register` / `reset_password`） | 字符串发送提示           |
| POST `/auth/register`       | 见下文                                                      | 用户资料 UserDTO         |
| POST `/auth/login`          | `account`, `password`, 可选 `role`                          | LoginResponse            |
| POST `/auth/sms/login`      | `phone`, `code`, 可选 `role`                                | LoginResponse 或注册指引 |
| POST `/auth/refresh`        | `refreshToken`                                              | 新 LoginResponse         |
| POST `/auth/password/reset` | `phone`, `code`, `newPassword`                              | null                     |
| POST `/auth/logout`         | 无请求体；可携带当前认证凭据                                | null                     |
| GET `/users/me`             | 当前认证凭据                                                | 用户资料 UserDTO         |

注册必填password、confirmPassword、realName、phone；code与registrationToken必须且只能提交一个。accountType可省略且只接受INDIVIDUAL，roles兼容忽略。昵称/身份证/邮箱仍选填，注册不能提交organization或orgPosition。

组织资料移至POST /organizations，name必填，其余字段沿原定义。组织、本人OWNER关系和营业执照认领同事务；创建即ACTIVE/APPROVED，无认证审核。营业执照仍先上传BUSINESS_LICENSE并提交objectKey/uploadToken，已认领文件仅所属组织OWNER/ADMIN可代理读取。

LoginResponse 字段严格使用 `accessToken`、`refreshToken`、`tokenType`（`Bearer`）、`expiresIn`（秒）。注册仅创建账号并返回资料，不自动登录；未注册手机号短信登录返回 HTTP 200 和 `{ status: "registration_required", registrationToken, expiresAt }`，不创建账号或登录会话、不设置登录 Cookie；客户端据此进入资料填写页。注册凭证绑定手机号、10 分钟有效、一次性使用，再次验证同手机号会使旧凭证失效；放弃填写后，下次重新获取登录验证码并验证仍返回注册指引。

UserDTO 使用 `id`、`uid`、`accountType`、`phone`、`nickname`、`realName`、`idCardNo`、`idVerified`、`avatarUrl`、`bio`、`role`、`roles`、`selectedRole`、`hasExpertManagementRole`、`status`、`creditScore`、`lastLoginAt`、`lastLoginIp`、`organization`、`createdAt`、`updatedAt`。手机号和身份证号脱敏。新项目 `id` 仍为 UUID 字符串，时间仍为 ISO 8601；字段名沿用旧项目，不承诺旧数据库主键类型或日期格式兼容。

## 验证码登录后填写资料注册

1. `POST /auth/sms/send` 提交 `{ "phone": "13812345678", "scene": "login" }`。
2. `POST /auth/sms/login` 提交 `{ "phone": "13812345678", "code": "095270" }`。已注册用户返回原 LoginResponse；新手机号返回：

```json
{
  "code": 200,
  "message": "操作成功",
  "data": {
    "status": "registration_required",
    "registrationToken": "ggggggggggggggggggggggggggggggggggggggggggg",
    "expiresAt": "2026-10-16T12:10:00.000Z"
  }
}
```

3. 前端判断 `data.status === "registration_required"`，展示表单并暂存手机号/凭证；凭证仅用于注册，不能作为登录令牌。填写后向 `POST /auth/register` 提交：

```json
{
  "accountType": "INDIVIDUAL",
  "phone": "13812345678",
  "registrationToken": "ggggggggggggggggggggggggggggggggggggggggggg",
  "realName": "小明",
  "password": "Password123",
  "confirmPassword": "Password123"
}
```

示例凭证不可实际使用，需替换为本次返回的真实值。密码/确认密码与真实姓名校验保留，账号类型不再必填，不在注册提交组织资料。`code` 和 `registrationToken` 必须且只能提交一个；原 `scene=register` 验证码注册仍保留。凭证消费和统一用户创建在同一事务内，业务失败回滚，可修正表单重试；过期/错误/手机号不匹配/已消费凭证返回 HTTP 400。注册成功仍只返回用户资料，不自动登录，随后可用注册密码登录或重新获取登录验证码。实际页面跳转和表单对接由前端任务完成，本次未改 Web/Electron。

复用既有 `RegistrationGrant` 表，无新增数据库迁移；摘要增加 `sms-registration:` 用途隔离，历史旧流程凭证不能用于此入口。过期凭证沿用现有认证清理命令。

## 安全与实现入口

- `packages/shared/src/auth.ts`：新增请求 schema 与兼容 DTO。原 `index.ts` 中的前端 DTO 暂时保留，新增导出不会改变前端现有类型。
- `auth.routes.ts`：路由、Cookie、客户端类型、来源校验。
- `auth.service.ts`：场景化验证码、注册、密码/短信登录、刷新、重置、资料查询及退出。`authenticate(token, client)` 统一验证会话有效期、撤销状态、客户端及账号状态，返回服务端身份（userId/uid/sessionId/role/clientType）；与 me 共用校验，不提供管理权限，调用方仍须验证业务权限和数据范围。
- `password.ts`：Node 内置 scrypt、独立随机盐和恒定时间摘要比较；不存储明文密码。
- `auth.schema.ts`：Swagger 元数据和响应序列化。
- `application.ts`：认证错误的 Result 包装、敏感字段日志脱敏。
- `prisma/schema.prisma` 和 `20261016000000_legacy_auth/migration.sql`：持久化字段和迁移。

用户已确认暂用开发/测试 mock 短信，固定字符串验证码 `095270`，有效期 5 分钟；真实短信未接入，现有配置继续禁止 mock 生产启动。验证码按 `phone + scene` 隔离；发送冷却和发送限流跨场景共用，错误次数持久化，成功消费一次。注册、验证码消费、重置密码及刷新使用事务和手机号 advisory lock。

令牌仍采用新项目的随机不透明值，数据库只存摘要，默认有效 30 天；并非旧项目 JWT。刷新后原访问/刷新令牌对失效；重置密码撤销全部会话；普通退出撤销当前会话。当前实现允许 Web/桌面及同客户端多个会话并存；单账号踢号、退出范围、刷新重放强制下线等兼容策略仍待用户确认，不能视为已验收。角色切换现已接入API-121，刷新保留当前角色。

Web 和 Electron 页面均使用 HttpOnly 会话 Cookie；浏览器来源须精确位于 `WEB_ORIGINS` 或 `DESKTOP_ORIGINS`。普通 Web 保持 SameSite=Lax，可信桌面来源使用 SameSite=None+Secure；服务端支持凭据 CORS、OPTIONS 预检，允许审批/导入所需的 `Idempotency-Key`，并暴露 Retry-After 与 Content-Disposition。页面写请求声明 `X-Tyde-Client: web`，GET/HEAD 省略自定义头；刷新令牌仅保留在适配器内存，IPC 只返回公开 API 源。非浏览器 API 继续支持 `X-Tyde-Client: desktop` 与 Bearer，并禁止 Origin、Cookie 和 sec-fetch-*；无浏览器头、Cookie 和客户端声明的调试请求自动按 Bearer 处理。

## 联调与数据库

先在目标环境配置数据库，并在部署代码前运行 `pnpm db:deploy`。迁移保留已有账号/会话，补充 `uid`、`realName` 和默认执行专家角色。旧验证码流程创建的账号没有密码，可走短信登录或重置密码设置密码。

示例：

```json
{ "phone": "13812345678", "scene": "register" }
```

```json
{
  "accountType": "INDIVIDUAL",
  "phone": "13812345678",
  "code": "095270",
  "password": "Password123",
  "confirmPassword": "Password123",
  "realName": "小明"
}
```

```json
{ "account": "13812345678", "password": "Password123" }
```

API 客户端登录后使用 `Authorization: Bearer <accessToken>` 调用 `/users/me`。

**前端尚未适配**：原 Web/Electron 仍调用 `/auth/code`、`/auth/verify`、`/auth/me`，并向 `/auth/register` 提交 `registrationToken/username/displayName`。这些与新后端契约不同；按用户限定，本次不修改前端，也不宣称双端登录可用。后续前端任务需单独按本文及 Swagger 对接。

## 验证

2026-10-16 最新结果：此前 Agent 服务端单测 34 项、服务端 typecheck 和改动文件 ESLint 通过；用户本机专用测试库已应用 init、legacy_auth 两个迁移，16:24:24 执行 `pnpm test:integration`，1 个文件 / 10 项全部通过，用时 3.45 秒。证据来自用户完整终端输出。开发库迁移、真实短信及 Web/Electron 联调未执行。

- `pnpm test`：服务端安全、Swagger、静态页面路由、身份校验及注册 SQL 约束回归。
- `pnpm test:integration`：真实 PostgreSQL 注册、场景隔离、错误次数、并发注册/短信消费、刷新重放、重置下线、组织原子性/回滚、禁用用户和来源/客户端隔离。读取 `.env.test`，要求库名以 `_test` 结尾且 `TEST_DATABASE_RESET=true`。

Agent 的 TCP/socket 连接受执行环境限制，数据库验证已由用户本机完成。首次 4 通过 / 6 失败的注册问题已修复并复测通过。逐接口状态、兼容差异和续做位置以 [00 认证任务](../../backend-migration/00-auth/todoTask.md) 为准；兼容策略仍待确认，不能仅据测试通过宣称旧业务完全迁移。

### 在本机终端完成认证数据库验证

在 `tyde/` 目录执行：

```sh
node scripts/verify-auth-database.mjs
```

脚本读取 `apps/server/.env` 的本地数据库连接，使用该账号连接维护库 `postgres`，创建随机命名、以 `_test` 结尾的独立测试库（无需开发库已存在），生成权限为 0600 且被 Git 忽略的 `apps/server/.env.test`，对新测试库执行 `prisma migrate deploy` 和 `pnpm test:integration`。测试会清空独立测试库业务表，开发库不清表、不应用迁移；测试库保留供检查。账号需有 CREATEDB 权限，PostgreSQL 工具默认使用 Postgres.app，可通过 `PG_BIN` 指定工具目录。已有 `.env.test` 时脚本拒绝覆盖。

若提示 permission denied to create database，请让本机数据库管理员执行以下命令后重试脚本（需管理员判断该开发账号是否应具备建库权限）：

```sql
ALTER ROLE tyde_outside_dev CREATEDB;
```

若脚本已经生成 `.env.test` 后迁移或测试失败，保留配置。修复失败原因后，在 `tyde/` 目录执行以下命令，继续使用原独立测试库：

```sh
node --env-file=apps/server/.env.test --input-type=module -e 'import { spawnSync } from "node:child_process"; process.exit(spawnSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { cwd: "apps/server", stdio: "inherit", env: process.env }).status ?? 1)'
pnpm test:integration
```

执行结果交回后再更新数据库验收状态；不要提交 `.env` 或 `.env.test`，无需发送密码。辅助脚本已由用户本机成功建库并迁移；注册修复后直接执行 `pnpm test:integration`，10/10 通过。

### 本地账号认证失败的修复

历史排障记录（已解决）：用户本机确认项目 PostgreSQL 启动成功后，验证脚本曾返回 `password authentication failed for user "tyde_outside_dev"`；此错误可能是角色不存在或本地密码与 `.env` 不一致。失败发生在 CREATE DATABASE 执行前，本次未建测试库、未生成 `.env.test`，迁移/测试未开始。切换连接地址不会同步远程账号凭据；已有 `.env` 时 `setup:local` 会拒绝覆盖配置，不适合直接重跑。

在 `tyde/` 目录通过项目 Unix socket 进入本地管理员连接（默认使用当前系统账号）：

```sh
/Applications/Postgres.app/Contents/Versions/latest/bin/psql -X -h "$PWD/.local/postgres" -d postgres
```

在 psql 内执行以下语句，缺角色时创建，已有角色时保留；为验证脚本授予本地建库权限：

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tyde_outside_dev') THEN
    CREATE ROLE tyde_outside_dev LOGIN;
  END IF;
END $$;
ALTER ROLE tyde_outside_dev LOGIN CREATEDB;
```

然后在 psql 内执行：

```text
\password tyde_outside_dev
```

按提示两次输入 `apps/server/.env` 中 DATABASE_URL 对应的密码（输入不回显），再执行 `\q` 退出，重跑 `node scripts/verify-auth-database.mjs`。该操作仅修复本地角色，不修改远程账号、不清理开发库；若其他本地程序使用该角色旧密码，需要同步其配置。若管理员连接失败，保留原配置并提供不含凭据的错误信息。Agent 本轮 TCP 和 Unix socket 均受执行环境限制，未自行操作数据库。

历史排障记录（已解决）：本地角色及密码修复后，认证错误消失；随后因开发库 `tyde_outside` 不存在而失败。辅助脚本已修正为连接维护库 `postgres` 执行建库，无需先创建开发库。直接重跑验证脚本即可；此前失败仍未创建测试库、未生成 `.env.test`、未执行迁移或测试。

### PostgreSQL 首轮验证与注册修复

用户本机已在专用库 `tyde_auth_1792138803808_563211cb_test` 成功应用两个迁移（init、legacy_auth）。首次 10 项集成测试中 4 通过、6 失败，失败集中于注册返回 500。核对发现注册将随机 UUID 直接作为 username，可能以数字开头，违反初始迁移的 `User_username_format` CHECK（须以字母开头、长度 3～32）。已将内部 username 改为 `u` 加 31 位 UUID 字符，保留完整对外 uid；不修改原约束、不新增迁移。新增首位 0–f 共 16 项回归测试，服务端单测本轮合计 34 项通过。

修复后用户本机于 2026-10-16 16:24:24 执行 `pnpm test:integration`，10 项全部通过（3.45 秒）。现有 `.env.test` 和测试库保留，无需重新建库。数据库验证已完成，兼容策略仍待确认；开发库未应用迁移。

## 核心基线交接

2026-10-16 用户授权遗留项备注后交接 01，当前任务指针已切换为文件存储与上传凭证。00 核心测试通过，完整业务验收未完成，兼容差异未自动获得接受。短信暂用 mock 095270，真实短信为上线依赖；营业执照在 01 回补，资料/组织/主管/presence 分别依赖 02/03/07/14。其余兼容决定、公共能力及联调待办见 [00 遗留项与回补条件](../../backend-migration/00-auth/todoTask.md#遗留项与回补条件)。本次仅交接，不启动 01 实现。

01最新环境补充（2026-10-19）：用户已在开发库tyde_outside应用uploaded_files迁移，解决文件上传P2021；文件HTTP入口真实OSS联调通过，详情见[01记录](../../backend-migration/01-files/todoTask.md#完成与交接记录)。以下为历史测试记录。

01 回补进展（2026-10-16）：用户本机已应用第三个迁移 `20261016010000_uploaded_files`（专用测试库，非开发库），并安装 multipart 依赖。修复大小不符测试中两个字符串同为10字节的夹具错误，改用台账大小+1；Agent先复测21项全部通过，再接入文件HTTP接口并扩展为29项集成全部通过（真实PostgreSQL+内存对象存储）。API-002营业执照上传/注册/认领/代理链路已验证；原API-002仍为部分迁移，多组织/昵称等其他回补不变。文件业务权限及真实OSS联调限制见 [01 记录](../../backend-migration/01-files/todoTask.md)。

## 02 用户资料定向回补（2026-10-19）

用户确认文件上传已联调成功，恢复02。新增匿名昵称校验及本人资料更新，API-002昵称唯一性由新增唯一索引兜底，冲突409、注册事务回滚；API-008头像/简介/实名状态读取持久化字段。姓名、邮箱仍沿用注册校验，不增加资料更新字段。固定EXPERT规则覆盖资料roles输入；改密更新和全部会话撤销同事务，锁内重验会话，Web/Electron清Cookie。实名核验、信用、多组织、主管及在线状态仍有回补，原接口保持部分迁移。

新增迁移 `20261019010000_user_profile`，开发/部署库未应用；用户本机专用测试库已成功应用，12:17:58复测41项集成全部通过（总9.31秒），此前P1001/缺列阻塞已解除。随后运行中的本地后端51项HTTP检查全部通过，覆盖昵称冲突回滚、资料保存与隔离及改密后Web/Bearer/刷新令牌失效。本轮未执行迁移或查询迁移历史；开发库迁移记录核对、部署及兼容验收保留回补，结果及续验唯一记录见[02任务](../../backend-migration/02-user-profile/todoTask.md)。补迁移和接口细节见[API文档](API.md#用户资料与昵称02)。本轮不以历史认证/文件集成通过替代新字段验收。

## 03 首批组织关系接入（2026-10-19）

组织注册在原验证码/注册凭证、用户及营业执照事务中增加`UserOrgRel`创建；沿用提交的orgPosition，默认OWNER，初始ACTIVE。新增组织查询/编辑接口按关系表授权。`20261019020000_organization_memberships`已由用户应用专用测试库；2026-10-19 13:23:17复测45项集成全部通过（测试8.63秒、总17.37秒），此前缺列/表阻塞解除；155项单测通过。开发/部署库尚未应用本次迁移，部署新代码前须迁移目标库。

03成员管理批次已将`publicUser`、API-002/008及资料更新响应切到有效多组织关系：OWNER优先，其次最早入组（null排后），排除已删除组织，读取实际position/joinStatus/组织状态；不从单组织兼容字段授权或展示。`hasExpertManagementRole`按旧SQL接实OWNER及已接单组织现任负责人分支；当前会话须EXPERT，负责人须仍有对应组织有效成员关系，有任何历史禁用旧单值回退，删除项目不计入。ADMIN本身不等于该职责；07已实现，本批3项数据库集成用户2026-10-23 11:50:17全部通过，真实HTTP/部署/完整兼容仍待验收。营业执照鉴权也读取指定组织参与状态的OWNER/ADMIN关系，离组/降权立即失效；注册成功的组织关系仍在原事务内创建。

本批180项单测及52项专用PostgreSQL+内存存储集成通过，无新增schema/迁移。审批/退出已接入组织关系状态（项目清退仍待补偿），首次登录激活/导入仍归03后续批次；开发/部署及兼容验收未执行。详细验证及恢复入口见[03记录](../../backend-migration/03-organizations/todoTask.md)。

03审批批次补充：用户已在专用测试库应用第6个迁移`20261019030000_approvals`，190项单测、63项集成通过。审批通过或合法代操作离组后，真实关系变LEFT，后续认证资料不再展示该组织、营业执照授权失效；未来PENDING_LEAVE继续保留组织参与权限，直到每日维护命令执行到期离职。部署调度尚未配置，项目清退仅持久化PENDING补偿记录，不能视为完整项目离组。认证首次激活已于后续导入批次接入并通过专用库集成，进度以03记录为准。

## 03 导入及首次登录激活（专用库集成已通过）

导入代码已创建无默认密码的个人EXPERT用户与PENDING_ACTIVATION关系；已有账号保留资料，符合无有效组织关系条件时直接ACTIVE。AuthService.issue在初次密码/SMS登录事务内、发令牌和记最近登录前条件激活所有待激活关系并版本+1；激活失败整笔回滚且不发令牌，刷新/重置本身不激活。手机号锁在外，组织锁按ID升序；导入也遵守该顺序，普通组织写操作不反向申请手机号锁。组织字段依旧按真实有效关系选择，API-002/008保留的其他兼容/项目负责人分支不变。

用户已安装SheetJS，既有203项单测通过（本次未重跑）；第7个迁移20261019040000_member_imports提供整批事务幂等回执，已由用户应用专用测试库。2026-10-19 16:26:59 Agent复跑74项集成全部通过（总23.77秒），含注入激活失败/批中写失败的真实回滚场景，此前缺表阻塞解除。默认入口已交接04；用户随后已在开发库tyde_outside应用全部7个迁移，重启后41项业务HTTP复测全部符合预期，组织注册/登录及导入首次激活通过，原注册500已消除；部署迁移及兼容验收仍待完成，唯一逐接口验收见[03记录](../../backend-migration/03-organizations/todoTask.md)。

## 历史：04独立管理授权（已被统一账号方案替代）

用户已明确管理接口纳入本后端，管理授权独立维护。认证主体、注册/登录和用户资料角色保持EXPERT；新增管理业务授权读取ManagementGrant，不读取User.role或客户端角色。当前实现NAVIGATOR/PM授权及审计运维命令，分类查询和需求方回填要求NAVIGATOR；不提供HTTP授权管理，不自动授权现有账号。撤销后旧会话下一请求即时失去对应管理权限；项目归属与任职仍须分别校验。用户回传2026-10-19 17:25:16运行80项专用库集成全部通过（总29.88秒），此前缺表阻塞解除，专用库结构已就绪；本次未另查迁移历史，开发/部署库第8迁移及环境联调仍未确认，详见[管理授权说明](MANAGEMENT_ACCESS.md)和[04任务记录](../../backend-migration/04-project-foundation/todoTask.md)。

04草稿/发布批次：API-029/030按已核实旧代码实际只要求登录及本人范围，不额外增加NAVIGATOR门槛；独立管理授权仍用于分类、需求方回填及后续原管理接口，不改变注册/登录角色。第9迁移新增项目/分类快照/附件，第10迁移将台账业务ID转字符串并保留组织UUID，用户回传2026-10-19 18:18:48运行92项集成全部通过（总36.64秒），第9/10专用库结构已就绪、原附件认领失败已解除；迁移历史未另查，开发/部署及兼容验收仍待完成。已认领项目附件仅接实独立NAVIGATOR授权的项目创建人读取，当前ASSIGNED主策略官/协作负责人的独立PM授权读取已在后续本批接入代码（102项专用库集成已通过），专家及考试附件继续403待回补，详见[项目草稿与发布](PROJECT_CREATION.md)。

04策略官批次：API-032/033以独立NAVIGATOR授权及本人已发布项目为范围，推荐候选读取独立PM授权；不回退到User.role。新增User.creditScore默认100，仅用于旧规则排序，不在资料/候选中暴露；注册、登录、用户资料角色仍固定EXPERT。任职、管理主线轮次和PENDING事件同事务；第11所需专用库结构已就绪，用户2026-10-20回传102项集成全部通过（总41.38秒），迁移历史未另查。说明见[策略官与任务基础](PROJECT_MANAGERS.md)。

04生产计划批次：API-036/037每次读取独立PM授权和当前ASSIGNED关系，协作负责人仅只读，主策略官可确认，仍不修改EXPERT注册/登录角色。用户2026-10-20回传11:59:43运行110项集成全部通过（总46.38秒），第12所需专用库结构及新增8项数据库用例已验证，迁移历史未另查；既有267项单测通过，开发/部署及兼容验收仍待完成。契约、事务与环境边界见[生产计划](PROJECT_PRODUCTION_PLANS.md)。

04项目详情批次：API-035按独立NAVIGATOR+创建人、独立PM+当前ASSIGNED主策略官/协作负责人或本人ACTIVE MEMBER授权，管理范围优先，仅专家返回生产要求；固定EXPERT、User.role、组织身份不自动授予项目范围。用户2026-10-20回传18:58:41运行118项集成全部通过（总51.06秒），第13所需专用库结构及本批业务已验证，迁移历史未另查，既有274项单测通过，开发/部署及兼容验收仍待完成；成员来源写流程及专家附件接单/准入规则仍待后续接入。见[项目详情](PROJECT_DETAILS.md)。

04组织项目统计回补（2026-10-21）：API-018改为按指定组织userOrgRelId关联的ACTIVE项目记录计数/筛选，组织管理权限及固定EXPERT不变；不把个人或其他组织项目汇总到本关系。projectId为新库32位JSON整数，空关联计数0。278项单测通过，用户2026-10-21回传122项集成全部通过（总54.60秒），原测试库阻塞解除，无新增迁移；清退/负责人/变动与事件仍保留后续回补。契约见[API说明](API.md)。

04项目列表批次：API-031/034各自要求实时独立NAVIGATOR/PM授权，按createdBy/当前ASSIGNED关系再选本用户视角快照；历史快照不授予项目范围。注册/登录仍固定EXPERT。用户2026-10-21回传130项集成全部通过，第14所需专用库结构已就绪，迁移历史未另查，286项单测通过；来源写流程/重算/事件仍待后续，详见[项目列表](PROJECT_LISTS.md)。

### 2026-10-21插队：头像台账关联

`POST /users/me/update`新增可选`avatarUploadToken`，与`avatarUrl`中的AVATAR objectKey成对关联本人登录上传；凭证与文件校验、认领、资料写入和旧头像释放在现有认证锁事务内完成。重复本人已认领头像无需新凭证；null保持、空白清空不变。头像字段不授予敏感文件权限，改密仍撤销全部会话。详见[工作台后端契约](PERSONAL_WORKBENCH.md)。本批未修改认证/注册角色和前端适配。
