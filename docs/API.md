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
