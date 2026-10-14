# API 与 Swagger 使用说明

后端使用 `@fastify/swagger` 9 和 `@fastify/swagger-ui` 5，生成 OpenAPI 3.0.3。版本兼容关系见 [Swagger 插件](https://github.com/fastify/fastify-swagger#compatibility)及 [UI 插件](https://github.com/fastify/fastify-swagger-ui#compatibility)。

## 访问入口

执行 `pnpm dev:server` 后：

| 地址                                 | 用途                              |
| ------------------------------------ | --------------------------------- |
| `http://127.0.0.1:3000/api/v1/docs/` | Swagger UI                        |
| `/api/v1/docs/json`                  | OpenAPI JSON，可导入 API 调试工具 |
| `/api/v1/docs/yaml`                  | OpenAPI YAML                      |

执行 `pnpm dev:web` 后也可从 `http://127.0.0.1:5173/api/v1/docs/` 访问。路径在 `/api/` 下，Vite 与部署 Nginx 均沿用现有同源代理。文档随服务启动开放，不依赖数据库连接；数据库状态仍以 `/api/v1/health/ready` 为准。

## 接口与响应

以下路径均以 `/api/v1` 为前缀，具体字段以生成的 schema 为准。

| 方法与路径            | 成功结果                                              | 业务失败                                       |
| --------------------- | ----------------------------------------------------- | ---------------------------------------------- |
| POST `/auth/code`     | 200：challengeId、expiresAt、resendAfterSeconds、mode | 400 输入错误；429 限流                         |
| POST `/auth/verify`   | 200：authenticated 或 registration_required           | 400 验证码错误；410 过期；429 限流或锁定       |
| POST `/auth/register` | 201：authenticated                                    | 400 资料不合法；409 资料冲突；410 注册凭证过期 |
| GET `/auth/me`        | 200：user、sessionExpiresAt                           | 401 未登录或会话过期                           |
| POST `/auth/logout`   | 204：无响应体，无会话也成功                           | 来源校验或服务错误                             |
| GET `/health/live`    | 200：status=ok、application                           | —                                              |
| GET `/health/ready`   | 200：status=ready                                     | 503：status=unavailable                        |

认证接口通用错误结构为 `code`、`message`、`requestId`。来源校验失败为 403，请求体过大为 413，内部错误为 500，数据库不可用为 503；429 携带 `Retry-After`，单位为秒。

## Web 调试

Swagger UI 中选择 Try it out 即可发送请求。POST 会执行真实业务，验证码挑战、注册和退出都会实际生效。

文档页面所在的源地址必须包含在 `WEB_ORIGINS` 中。默认开发配置允许 Web 的 5173 源，建议通过 Web 代理打开文档；若从 3000 直接调试，请显式把 `http://127.0.0.1:3000` 加入允许列表。浏览器自动发送 Origin，不在 Swagger 中手动伪造该头。

1. 调用 `/auth/code`，请求体示例：`{"region":"CN","phone":"13800138000"}`。使用约定测试号码。
2. 调用 `/auth/verify`，带上返回的 challengeId、相同 region/phone 和字符串验证码 `095270`。
3. 若返回 registration_required，调用 `/auth/register`，带上 registrationToken、username、displayName。
4. 调用 `/auth/me` 查看会话，或 `/auth/logout` 退出。

Web 登录通过响应 `Set-Cookie` 自动建立 HttpOnly 会话。Swagger 的 Authorize 无法手动设置 HttpOnly Cookie；完成登录后由浏览器自动携带。`COOKIE_SECURE=true` 时使用 HTTPS，Cookie 名为 `__Host-tyde_session`，否则为 `tyde_session`。用户名会去空格并转小写，须为 3～32 位、字母开头且仅含字母/数字/下划线；姓名去空格、NFC 归一化后为 1～80 个字符且不含控制字符。

## 桌面调试

桌面 HTTP 请求由 Electron main 发出，设置 `X-Tyde-Client: desktop`。登录或注册成功时 JSON 额外返回 sessionToken；后续 `/auth/me` 使用 `Authorization: Bearer <sessionToken>`，退出时也带当前令牌。该令牌仅在 main 内保存，不返回 renderer。

用 curl 或 API 客户端调试桌面协议；浏览器 Swagger UI 自带 Origin 或 sec-fetch-* 头，会被桌面传输校验拒绝。桌面请求禁止带 Origin、Cookie 或 sec-fetch-*，也不能同时携带 Cookie 与 Authorization。

```sh
curl http://127.0.0.1:3000/api/v1/auth/me \
  -H 'X-Tyde-Client: desktop' \
  -H 'Authorization: Bearer <sessionToken>'
```

## 维护约定

- `apps/server/src/docs.ts` 注册插件与双端安全方案，必须在业务路由之前调用。
- 请求 schema 复用 `packages/shared/src/index.ts`；认证响应及公共路由元数据位于 `apps/server/src/modules/auth/auth.schema.ts`，健康检查 schema 位于 `app.ts`。
- 新增路由填写唯一 operationId、summary、tags、请求 schema、实际状态码与响应 schema。只有要求登录的接口添加 security；退出允许无会话，不声明强制认证。
- 响应 schema 同时影响 Fastify 序列化。修改时校验 Web Cookie、桌面 sessionToken 和 verify 的两种结果，防止字段丢失或令牌泄漏。
- `pnpm test` 包含文档端点、静态资源、接口覆盖与响应序列化验证，无需数据库。认证数据库行为另执行 `pnpm test:integration`；完整验证步骤见根目录 README。

测试环境部署与文档访问控制见 [部署说明](DEPLOY_TEST.md)。
