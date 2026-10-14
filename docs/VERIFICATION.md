# 验证记录

记录实际执行结果。安装包构建与设备安装验收分开记录；没有执行的检查不标记通过。

## 2026-10-14 Swagger 集成增量验证

- `pnpm test`：2 项通过，含 Swagger UI、静态资源、OpenAPI JSON/YAML、7 个接口覆盖、Web/桌面响应字段及退出空响应验证；使用 mock service，不连接数据库。
- `pnpm test:core`：5 项通过。
- 服务端 `typecheck`、`pnpm build:server`、`pnpm lint`、`pnpm format:check`：通过。
- `pnpm test:integration`：尝试执行，沙箱内外均无法连接 `127.0.0.1:5432`，7 项均在数据库准备阶段失败，未完成本次真实数据库认证回归。
- 本次未执行 Web/Electron E2E、浏览器人工验收及重新打包；下方为此前完整验证记录。

## 环境

- macOS Darwin 25.6.0，Apple Silicon arm64。
- Node.js 24.19.0，pnpm 11.23.0。
- PostgreSQL 18，Postgres.app 二进制；项目数据目录 `.local/postgres`。
- Web / Electron 连接本地开发后端；阿里云测试环境尚未提供。

## 检查

| 检查                                  | 结果                                                               |
| ------------------------------------- | ------------------------------------------------------------------ |
| pnpm install                          | 用户普通终端成功；真实 lockfile 已生成                             |
| test:core                             | 5 项通过                                                           |
| Web 类型检查及生产构建                | 通过                                                               |
| Electron 类型检查与 main/preload 构建 | 通过；preload 仅 0.74 kB                                           |
| 后端类型检查、单元测试                | 通过；单元测试 1 项                                                |
| 全量 lint、格式检查                   | 通过                                                               |
| PostgreSQL 开发 / 测试库迁移          | 通过                                                               |
| PostgreSQL 集成测试                   | 7 项通过                                                           |
| Web 浏览器自动化                      | 通过：注册、刷新恢复、退出                                         |
| Electron 自动化                       | 通过：同一 React 页面、注册、重启恢复、退出、令牌不返回 renderer   |
| Web / 后端部署压缩包                  | 已生成，附 SHA-256 校验和                                          |
| Mac 安装包                            | 已生成 universal DMG；主程序含 x86_64 / arm64，ad-hoc 签名验证通过 |
| Mac 打包产物启动检查                  | 1 项通过；本地协议加载、刷新、API 桥接、隔离配置，不启动 Vite      |
| Windows 安装包                        | 已生成 x64 应用的 NSIS EXE；安装器无 Authenticode 发布者证书       |
| Mac Intel / Windows 真实设备安装      | 需要测试人员执行                                                   |
| 阿里云部署及远程联调                  | 等待资源                                                           |

## 环境限制

Agent 执行环境无法解析外部 npm 域名，依赖下载及安装脚本已由用户普通终端完成。数据库初始化需要创建共享内存，Agent 执行环境拒绝该操作，用户已在普通终端成功初始化并启动。

数据库、浏览器与桌面自动化由用户在普通终端运行 `pnpm verify:local`，Agent 读取同一工作目录下的报告继续修复。最新完整流程于 2026-10-13 22:41（Asia/Shanghai）通过，见 `artifacts/local-verification.json` 与 `artifacts/e2e-results.json`。Agent 已查看两端欢迎页截图，页面结构一致。

首轮验证发现并修正：测试配置被开发 `.env` 抢先加载；Ant Design 双汉字按钮自动空格导致测试定位失败；Node fetch 自动添加 Sec-Fetch-Mode 导致桌面请求被安全校验拒绝。改为显式测试配置、适配实际可访问名称、main 原生 HTTP 客户端后复查通过。打包工具使用兼容的 electron-builder 26.15.3，取消旧版不兼容 rebuild 覆盖。

## 可查看的截图

- [Web 欢迎页](../artifacts/screenshots/web-welcome.png)
- [Electron 欢迎页](../artifacts/screenshots/electron-welcome.png)
- [Mac 打包产物页面](../artifacts/screenshots/packaged-desktop.png)

截图与 JSON 报告由验证命令生成，属于本地构建产物，不提交源代码仓库。

## 交付说明

Mac `release/mac-universal/tyde-outside.app` 的主程序经 `lipo -archs` 确认包含 `x86_64 arm64`；`codesign --verify --deep --strict` 通过。打包内 `Contents/Resources/web` 与 `apps/web/dist` 逐文件比较一致。`pnpm test:packaged` 于 2026-10-13 在本机通过；这不等同于已在另一台 Mac Intel 上安装验收。

Windows NSIS 安装器生成成功，封装的应用为 x64；安装器自身是 NSIS 引导程序，其 PE 架构可以是 32 位，不表示应用为 32 位。安装器证书表为空，未获得发布者签名；需要测试人员在 Windows 上按说明安装验收。

四个交付包为 `release/tyde-outside-0.1.0-mac-universal.dmg`、`release/tyde-outside-0.1.0-win-x64.exe`、`artifacts/tyde-outside-web-0.1.0.tar.gz`、`artifacts/tyde-outside-server-0.1.0.tar.gz`。桌面包当前连接安装者本机后端 `http://127.0.0.1:3000`，阿里云部署、远程试用和双系统人工安装验收仍待完成。
