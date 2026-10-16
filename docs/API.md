# API 与 Swagger 使用说明

运行 `pnpm dev:server` 后访问 `http://127.0.0.1:3000/api/v1/docs/`。OpenAPI JSON/YAML 分别位于 `/api/v1/docs/json` 和 `/api/v1/docs/yaml`；文档读取不依赖数据库。

认证后端已按 `tyde-core` 的接口路径与字段迁移，注册和登录固定为执行专家 `EXPERT`，不要求选择身份。完整字段、联调示例、迁移说明和已知依赖见 [认证后端上下文](AUTH_BACKEND.md)。本次仅改后端，Web/Electron 仍为旧流程，尚需独立适配。

| 方法与路径（前缀 `/api/v1`） | 用途                           |
| ---------------------------- | ------------------------------ |
| POST `/auth/sms/send`        | 按 `scene` 发送验证码          |
| POST `/auth/register`        | 注册并返回用户资料             |
| POST `/auth/login`           | 手机号 / 邮箱 / uid + 密码登录 |
| POST `/auth/sms/login`       | 手机号 + 验证码登录            |
| POST `/auth/refresh`         | 轮换访问和刷新令牌             |
| POST `/auth/password/reset`  | 验证码重置密码并全端下线       |
| POST `/auth/logout`          | 撤销当前会话                   |
| GET `/users/me`              | 当前用户资料                   |
| GET `/health/live`           | 存活状态                       |
| GET `/health/ready`          | 数据库就绪状态                 |

认证成功统一 HTTP 200，使用 `{code: 200, message: "操作成功", data: ...}`。登录 data 包含 `accessToken/refreshToken/tokenType/expiresIn`，注册返回 UserDTO，退出与重置返回 null。失败使用 `code/message/data`，限流 HTTP 429 携带 `Retry-After`。健康检查保留原 `status` 结构。

Swagger 的 Try it out 会真实执行注册、登录、重置和退出。浏览器页面来源须加入 `WEB_ORIGINS`；Web 登录自动建立 HttpOnly Cookie。`COOKIE_SECURE=true` 时使用 HTTPS 与 `__Host-tyde_session`，否则使用 `tyde_session`。

API 客户端可直接通过 Bearer 认证；Electron 使用 `X-Tyde-Client: desktop`。桌面传输不能带 Origin、Cookie 或 sec-fetch-*，Cookie 与 Authorization 也不能混用。

```sh
curl http://127.0.0.1:3000/api/v1/users/me \
  -H 'Authorization: Bearer <accessToken>'
```

维护入口：请求 schema 与 DTO 在 `packages/shared/src/auth.ts`；响应与路由元数据在 `apps/server/src/modules/auth/auth.schema.ts`；Swagger 插件注册在 `apps/server/src/docs.ts`，须先于业务路由。新增接口维护唯一 operationId、summary、tags、请求与响应 schema；响应 schema 会影响实际序列化，必须验证字段完整性。

## Swagger 文档标准

后续新增、迁移和修改的后端接口统一遵循本标准。Swagger 必须能让调用方直接理解字段与使用条件；中文说明写进实际 JSON Schema/OpenAPI，TypeScript/Java 注释或独立 Markdown 不能替代它。

1. **接口级说明**：提供中文 `summary` 和 `description`、唯一 `operationId`、业务 `tags`；说明用途、认证方式、前置条件、关键副作用、幂等/重复调用及已知限制。HTTP 方法、路径和字段名保持迁移约定。
2. **每个字段都有中文含义**：请求 body、path/query/header 参数、响应包装和业务数据都要写中文 `description`。对象本身、对象内部字段、数组及数组项递归补齐，不能只写 string/integer 或把字段名翻译成同名英文。无请求体的接口明确说明即可，不编造参数。
3. **取值与业务规则**：枚举逐值解释，例如 `INDIVIDUAL=个人、ORGANIZATION=组织`；说明实际默认行为、格式/长度、数值单位、日期格式/时区、脱敏和 null/空数组的意义。`required` 由实际 schema 声明；条件必填在字段和接口说明写清，例如组织账号必须填写 `organization.name`。不要为了展示默认值给 schema 添加会改变 AJV 入参的 `default`。
4. **枚举可读性**：普通字符串枚举优先输出 `type: string` + `enum`，避免把每个字面量展开为一层 `anyOf`。保留现有合法取值、TypeScript 类型推导和验证语义；只有真实联合结构才使用 `oneOf/anyOf`。
5. **完整示例**：每个有请求体的接口至少一个可通过实际 schema 校验的请求示例；个人/组织等主要分支分别给示例。成功响应提供实际结构示例，失败响应说明 HTTP 状态、业务码、中文原因和必要响应头（例如 `Retry-After` 单位为秒）。示例里的密码、令牌、手机号和证件均为演示值，不能使用环境密钥或真实用户数据。
6. **文档与当前实现一致**：字段未接入、固定值、兼容字段被忽略、暂不支持的分支必须明确说明，不能把规划能力写成已上线。注册 `roles` 可省略且固定 EXPERT、组织注册提交 `businessLicense` 当前返回 400 等限制需在页面直接可见。
7. **响应 schema 保真**：响应 schema 会影响 Fastify 序列化。给原自由对象补嵌套字段时核验字段与 null 不丢失；文档补充不得暗改校验、字段名、HTTP 状态或业务行为。发现业务差异按迁移任务另外记录。
8. **交付验收**：查看生成的 `/api/v1/docs/json`，检查中文字段说明、嵌套结构、枚举和完整示例确实存在；示例通过实际请求校验；验证响应序列化及现有契约不变。`apps/server/tests/docs.test.ts` 已递归检查当前请求/响应字段的中文说明，并校验示例与枚举、组织响应字段保留；有 path/query/header 或新响应结构时扩展相应检查。不能仅靠 schema 源码有注释就通过验收。

TypeBox 示例：

```ts
const body = Type.Object(
  {
    phone: Type.String({
      pattern: '^1[3-9][0-9]{9}$',
      description: '中国大陆手机号，11 位数字，不含 +86。',
      examples: ['13812345678'],
    }),
  },
  {
    additionalProperties: false,
    description: '请求用途、前置条件和关键限制。',
    examples: [{ phone: '13812345678' }],
  },
);
```

请求标准入口 `packages/shared/src/auth.ts`，响应与错误说明范例 `apps/server/src/modules/auth/auth.schema.ts`。字段说明修改与接口代码一同交付，不要求调用方另找字段中文对照表。
