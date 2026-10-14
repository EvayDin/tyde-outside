# 测试环境部署（无 Docker）

目标为阿里云 Linux，具体 ECS/RDS、CPU、域名和证书申请完成后填写。部署包可先在 Mac 本地生成；不能把 Mac 的 node_modules 复制到 Linux。

## 生成产物

```sh
pnpm install --frozen-lockfile
pnpm package:web
pnpm package:server
```

`artifacts/tyde-outside-web-0.1.0.tar.gz` 包含静态资源和 Nginx 示例；`artifacts/tyde-outside-server-0.1.0.tar.gz` 包含编译后的后端、共享包、迁移、原始 lockfile 与部署模板，不含秘密、数据库或开发机运行依赖。旁边 `.sha256` 用于校验。安装依赖时仍需目标机网络；此交付不是无网络全离线镜像。

## 后端

1. 准备 Node 24、pnpm 11.23.0、PostgreSQL 18（或兼容版本），创建独立测试数据库与仅用于项目的用户。
2. 解压后端包到 `/opt/tyde-outside`（示例路径）；以非 root 用户管理运行进程。
3. 在该目录执行 `pnpm install --prod --filter @tyde-outside/server... --frozen-lockfile`。
4. 复制 `apps/server/.env.example` 为 `.env`，设置权限 0600，并填写下表配置。
5. 执行 `pnpm --filter @tyde-outside/server db:generate`，在目标 OS 生成 Prisma 引擎。
6. 执行 `pnpm --filter @tyde-outside/server db:deploy`，应用提交的迁移。变更已有环境前先备份，不执行 `migrate reset` 或 `db push`。
7. 在 `apps/server` 执行 `node --env-file=.env dist/main.js` 验证启动，然后使用 `deploy/tyde-outside.service.example` 配置 systemd。

| 配置             | 测试环境设置                                                     |
| ---------------- | ---------------------------------------------------------------- |
| APP_ENV          | `test`（允许显式 mock；production 会拒绝启动）                   |
| NODE_ENV         | 进程使用 `production`，与 APP_ENV 区分                           |
| HOST / PORT      | 默认 `127.0.0.1` / `3000`，同机 Nginx 代理                       |
| DATABASE_URL     | 测试库真实连接串，密码中的特殊符号需 URL 编码                    |
| SMS_PROVIDER     | `mock`                                                           |
| CODE_HMAC_SECRET | 至少 32 个随机字符；例如本机 Node crypto 生成后安全填入          |
| WEB_ORIGINS      | 真实 `https://测试域名`，不带路径和结尾斜线；多个以逗号分隔      |
| COOKIE_SECURE    | `true`                                                           |
| TRUST_PROXY      | 同机 Nginx 时 `127.0.0.1/32,::1/128`，其他拓扑按可信代理地址填写 |
| LOG_LEVEL        | `info`                                                           |

Prisma CLI 放在服务端生产依赖中用于迁移和目标平台生成；不得为缩小包而移除必需 CLI 后继续声称可部署。`pnpm-workspace.yaml` 的生产允许脚本与依赖覆盖需一同保留。

## Web 与 HTTPS

把 Web 包的 `web/` 内容部署到 Nginx 静态根目录，按实际域名、证书和目录修改 `nginx.conf.example`。保留 `/api/` 路径转发至后端，不剥离 `/api/v1`。Web 使用 hash 路由，无需 history fallback。

```sh
nginx -t
# 配置校验通过后由运维加载 Nginx 配置
curl --fail https://test.example.com/api/v1/health/live
curl --fail https://test.example.com/api/v1/health/ready
```

HTTPS 测试环境的网页与桌面可连接同一域名：网页经 `/api` 同源代理，桌面 main 直接请求该域名 `/api/v1`。不要为了桌面而启用任意 CORS。仅开放必要网络入口，数据库不对测试人员电脑直接暴露。

## Swagger 文档验收

部署后访问 `https://真实测试域名/api/v1/docs/`；现有 `/api/` 代理会同时转发 UI、静态资源和 OpenAPI JSON/YAML，无需增加独立代理路径。插件为 Swagger 页面设置 CSP；保留响应头并确认浏览器控制台没有资源加载错误。

```sh
curl --fail https://test.example.com/api/v1/docs/json
curl --fail https://test.example.com/api/v1/docs/yaml
```

文档端点随服务启动即可访问，不要求数据库已就绪，也未单独设置登录门槛。需要限制测试文档访问时，在网关对整个 `/api/v1/docs` 路径及其子路径统一设置访问控制。Swagger UI 调试 POST 必须从 `WEB_ORIGINS` 中的同源 HTTPS 页面发起；Cookie 按当前 `COOKIE_SECURE` 配置自动处理。完整说明见 [API 文档说明](API.md)。

## 桌面分发

Mac：`TYDE_API_BASE_URL=https://真实测试域名 pnpm package:mac`。

Windows PowerShell：先 `$env:TYDE_API_BASE_URL='https://真实测试域名'`，再 `pnpm package:win`。

运行 `node scripts/checksums.mjs release`，把安装包、SHA256SUMS 和 `docs/INSTALL_TRIAL.md` 一起交付。没有测试环境时可以打本地包检查安装和页面，但跨电脑完整登录需先有可达后端。

## 验收与更新

- Web 和两种桌面系统分别验证新账号注册、老账号登录、重启恢复、退出和网络失败。
- live 成功、ready 失败表示服务进程存活但数据库未就绪，不能当作部署成功。
- 日志通过 systemd journal 或进程 stdout 查看；请求编号用于关联错误，不记录请求体、验证码或会话令牌。
- 试用期间可执行 `pnpm db:cleanup` 清理过期记录；此源码命令需要开发依赖。部署包直接运行 `node --env-file=.env dist/cleanup.js`（在 apps/server 目录）。
- 更新前备份数据库与当前版本，应用迁移再切换服务；回退前检查迁移兼容性，不能承诺任意数据库变更可直接回滚。

所有 example 域名、目录和配置均为占位；本文不表示已完成阿里云部署。
