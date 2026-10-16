# 注册登录后端迁移上下文

## 约定与范围（2026-10-16）

- 用户负责后端，本次仅修改 `apps/server`、后端需要的共享 DTO/schema 和 Markdown 文档；不修改 Web、Electron、平台适配层或前端 E2E。
- 旧接口来源：`../tyde-core/src/main/java/com/tyde/platform/module/auth/controller/{AuthController,SmsAuthController}.java`，请求/响应字段来自同模块 `dto/`，用户响应来自 `module/user/dto/UserDTO.java`。
- 保持旧接口名称、路径和字段名；不再要求选择身份。注册固定写入 `EXPERT`，登录也固定使用执行专家身份。为兼容旧调用保留可选 `role` / `roles` 字段，传其他已知角色也不改变最终身份。
- 当前按旧接口保留个人和组织注册；账号类型 `accountType` 与业务角色不同。组织注册是否保留曾询问用户，尚未得到明确选择，因此沿用旧接口能力。
- 沿用新项目 Fastify + Prisma + PostgreSQL，不复制 Spring/Redis 基础设施；新旧项目数据库和令牌不互通。

## 接口契约

前缀 `/api/v1`；成功 HTTP 200，响应 `{ "code": 200, "message": "操作成功", "data": ... }`。错误同样使用 `code/message/data`，`data` 为 null；常见业务码 400/401/403/404/409/413/500/503，频率限制 4292（HTTP 429，含 `Retry-After`）。

| 方法与路径                  | 请求字段                                                    | 成功 data        |
| --------------------------- | ----------------------------------------------------------- | ---------------- |
| POST `/auth/sms/send`       | `phone`, `scene`（`login` / `register` / `reset_password`） | 字符串发送提示   |
| POST `/auth/register`       | 见下文                                                      | 用户资料 UserDTO |
| POST `/auth/login`          | `account`, `password`, 可选 `role`                          | LoginResponse    |
| POST `/auth/sms/login`      | `phone`, `code`, 可选 `role`                                | LoginResponse    |
| POST `/auth/refresh`        | `refreshToken`                                              | 新 LoginResponse |
| POST `/auth/password/reset` | `phone`, `code`, `newPassword`                              | null             |
| POST `/auth/logout`         | 无请求体；可携带当前认证凭据                                | null             |
| GET `/users/me`             | 当前认证凭据                                                | 用户资料 UserDTO |

注册必填字段：`accountType`、`password`、`confirmPassword`、`realName`、`phone`、`code`。
可选字段：`roles`、`nickname`、`idCardNo`、`orgPosition`、`email`、`organization`。

`accountType` 为 `INDIVIDUAL` / `ORGANIZATION`。昵称默认真实姓名。个人账号忽略组织信息；组织账号要求 `organization.name`，组织内身份默认 `OWNER`，可沿用 `ADMIN` / `MEMBER`。
组织信息保留字段 `name`、`unifiedCreditCode`、`businessLicense`（`objectKey` / `uploadToken`）、`description`、`logoUrl`、`expertiseTags`。**营业执照凭证认领依赖尚未接入，目前提交该字段会返回明确的 400 错误，不会伪造成功或保存未经校验的文件引用。**

LoginResponse 字段严格使用 `accessToken`、`refreshToken`、`tokenType`（`Bearer`）、`expiresIn`（秒）。注册仅创建账号并返回资料，不自动登录；未注册手机号短信登录返回 401，不自动创建账号。

UserDTO 使用 `id`、`uid`、`accountType`、`phone`、`nickname`、`realName`、`idCardNo`、`idVerified`、`avatarUrl`、`bio`、`role`、`roles`、`selectedRole`、`hasExpertManagementRole`、`status`、`creditScore`、`lastLoginAt`、`lastLoginIp`、`organization`、`createdAt`、`updatedAt`。手机号和身份证号脱敏。新项目 `id` 仍为 UUID 字符串，时间仍为 ISO 8601；字段名沿用旧项目，不承诺旧数据库主键类型或日期格式兼容。

## 安全与实现入口

- `packages/shared/src/auth.ts`：新增请求 schema 与兼容 DTO。原 `index.ts` 中的前端 DTO 暂时保留，新增导出不会改变前端现有类型。
- `auth.routes.ts`：路由、Cookie、客户端类型、来源校验。
- `auth.service.ts`：场景化验证码、注册、密码/短信登录、刷新、重置、资料查询及退出。
- `password.ts`：Node 内置 scrypt、独立随机盐和恒定时间摘要比较；不存储明文密码。
- `auth.schema.ts`：Swagger 元数据和响应序列化。
- `application.ts`：认证错误的 Result 包装、敏感字段日志脱敏。
- `prisma/schema.prisma` 和 `20261016000000_legacy_auth/migration.sql`：持久化字段和迁移。

短信仍为开发/测试 mock，固定字符串验证码 `095270`，有效期 5 分钟；真实短信未接入，现有配置继续禁止 mock 生产启动。验证码按 `phone + scene` 隔离；发送冷却和发送限流跨场景共用，错误次数持久化，成功消费一次。注册、验证码消费、重置密码及刷新使用事务和手机号 advisory lock。

令牌仍采用新项目的随机不透明值，数据库只存摘要，默认有效 30 天；并非旧项目 JWT。刷新后原访问/刷新令牌对失效；重置密码撤销全部会话；普通退出撤销当前会话。沿用新项目 Web/桌面会话独立的行为，不迁移旧项目单会话踢号与角色切换功能。

Web 使用 HttpOnly Cookie；有 Origin 的写请求必须来自 `WEB_ORIGINS`。桌面使用 `X-Tyde-Client: desktop` 与 Bearer，禁止 Origin、Cookie 和浏览器 fetch 头。无浏览器头、Cookie 和客户端声明的 API 调试请求按 Bearer 客户端处理，因此旧式 API 客户端无需额外自定义头。

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

2026-10-16 已通过：`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm test`（6 项）、`pnpm test:core`（11 项）及 `git diff --check`。数据库集成与前端 E2E 未执行，原因见下文。

- `pnpm typecheck`：全仓类型检查。
- `pnpm lint`：静态检查。
- `pnpm test`：服务端安全、Swagger 契约与静态页面路由测试。
- `pnpm test:core`：核心安全测试。
- `pnpm test:integration`：真实 PostgreSQL 注册、场景隔离、错误次数、并发注册、刷新重放、重置下线、组织注册和来源校验。要求专用 `.env.test`，库名以 `_test` 结尾且 `TEST_DATABASE_RESET=true`，执行前对该专用测试库应用迁移。

当前工作区只有远程开发 `.env`，无 `.env.test`。未对远程开发库执行迁移或清表；尝试创建独立临时 PostgreSQL 时，环境禁止 `shmget`，数据库初始化失败。因此数据库集成测试尚未执行，后续需要在允许启动 PostgreSQL 的环境验证。原前端 E2E 保持不变，不适用于本次迁移后的认证契约。
