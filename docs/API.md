# API 与 Swagger 使用说明

运行 `pnpm dev:server` 后访问 `http://127.0.0.1:3000/api/v1/docs/`。OpenAPI JSON/YAML 分别位于 `/api/v1/docs/json` 和 `/api/v1/docs/yaml`；文档读取不依赖数据库。

认证后端已迁移到下表的接口路径与字段，注册和登录固定为执行专家 `EXPERT`，不要求选择身份。完整字段、联调示例、迁移说明和已知依赖见 [认证后端上下文](AUTH_BACKEND.md)。

当前 Web/Electron 使用 Tailwind CSS、shadcn/ui 与 TanStack Router，开发和生产均通过平台适配调用下列真实认证接口。发码成功后保留后端 data 提示字符串，并展示与服务端 mock 共用的 `@tyde/shared` 常量 `MOCK_SMS_CODE`（当前为 `095270`）；页面不另行定义测试码，提示已含该验证码时不重复追加，失败或限流时不显示测试码，验证码有效期和校验仍由后端决定。后端发码成功只返回“验证码已发送，请注意查收”，响应不另设验证码或重发间隔字段，限流倒计时来自 HTTP 429 的 `Retry-After`。后端短信目前仍为开发/测试 mock，接入真实短信时须同步移除固定测试码提示。

短信登录按后端返回区分已有账号和注册指引；注册凭证仅存内存，个人资料提交后返回密码登录。Web 使用 HttpOnly Cookie，刷新令牌只留在平台适配器内存；Electron main 加密保管访问/刷新令牌对并处理轮换，IPC 不向页面返回登录令牌。注册返回用户资料，不自动创建会话；退出 HTTP 200 后清除客户端会话状态。

执行 `pnpm dev:web` 后可通过 `http://127.0.0.1:3001/api/v1/docs/` 访问同源文档；`API_PROXY_TARGET` 指向 HTTPS 后端时使用 `https://localhost:3001/api/v1/docs/`。部署包及 Vercel 由同一个 Fastify 服务托管 Web 与 API，数据库状态以 `/api/v1/health/ready` 为准。

| 方法与路径（前缀 `/api/v1`）                  | 用途                               |
| --------------------------------------------- | ---------------------------------- |
| POST `/auth/sms/send`                         | 按 `scene` 发送验证码              |
| POST `/auth/register`                         | 注册并返回用户资料                 |
| POST `/auth/login`                            | 手机号 / 邮箱 / uid + 密码登录     |
| POST `/auth/sms/login`                        | 手机号 + 验证码登录或返回注册指引  |
| POST `/auth/refresh`                          | 轮换访问和刷新令牌                 |
| POST `/auth/password/reset`                   | 验证码重置密码并全端下线           |
| POST `/auth/logout`                           | 撤销当前会话                       |
| GET `/users/me`                               | 当前用户资料                       |
| GET `/users/nickname/check`                   | 匿名昵称可用性与推荐昵称           |
| POST `/users/me/update`                       | 本人资料更新、改密并全端下线       |
| GET `/organizations`                          | 指定组织资料（主管/管理员）        |
| POST `/organizations/update`                  | 组织简介与Logo部分更新（主管）     |
| POST `/organizations/members`                 | 组织人员分页列表（项目分支待接入） |
| POST `/organizations/members/update`          | 编辑成员及版本条件更新             |
| POST `/organizations/members/position`        | 组织角色变更与主管转让             |
| POST `/organizations/members/exit-requests`   | 本人退出申请或合法代操作退出       |
| POST `/organizations/approvals/pending`       | 本人组织待办                       |
| POST `/organizations/approvals/records`       | 已处理节点记录                     |
| POST `/organizations/approvals/process`       | 双版本审批处理                     |
| GET `/organizations/member-imports/template`  | 成员XLSX模板，登录后下载           |
| POST `/organizations/member-imports/generate` | 全量校验并原子导入成员             |
| GET `/health/live`                            | 存活状态                           |
| GET `/health/ready`                           | 数据库就绪状态                     |

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
6. **文档与当前实现一致**：字段未接入、固定值、兼容字段被忽略、暂不支持的分支必须明确说明，不能把规划能力写成已上线。注册 `roles` 可省略且固定 EXPERT、文件存储默认关闭、已认领项目/考试附件访问授权尚未接入等限制需在页面直接可见。
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

## 文件上传、凭证与访问

OSS 物理主目录为配置的 `OSS_BUCKET` 下的 `tyde/`。API 与台账的 `objectKey` 使用该目录内的相对业务键，例如 `business-license/...`；客户端原样传入，不自行添加 `tyde/` 或 bucket 名。签名 URL 会包含物理前缀。

以下路径均加 `/api/v1`，沿用 `{code,message,data}`，失败 data=null；`GET /files/view` 成功时直接返回文件字节，不用 JSON 包装。

| 方法与路径                 | 字段                                                  | 身份与结果                                                                                                    |
| -------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| POST `/files/upload`       | multipart：`file` 必填，`bizType/category` 选填       | 可匿名；项目/考试附件必须登录。返回可信元数据、objectKey、一次性 uploadToken；敏感文件 url=null。             |
| POST `/files/upload/batch` | multipart：重复 `files` 字段，`bizType/category` 选填 | 默认最多10个文件，按顺序返回；后续上传失败时前面成功的对象保留，未认领对象过期清理。                          |
| GET `/files/view`          | query：`objectKey` 必填                               | 需登录；安全图片/PDF内联，其余强制下载；no-store, private 与 nosniff。匿名请求403。                           |
| GET `/files/access-url`    | query：`objectKey` 必填，`expireSeconds` 选填         | 需登录；敏感目录或台账一律403。非敏感图片默认2147483647秒，其他默认604800秒；非正数视为默认，最大32位正整数。 |
| DELETE `/files`            | query：`objectKey` 必填                               | 需登录且为本人未认领文件；匿名上传对象、已认领对象和重复删除403。成功data=true。                              |

`bizType` 默认 COMMON，`category` 默认由业务推断；忽略大小写和首尾空白，未知值400。固定业务大类不能被 category 放宽，ANY 仍受已知安全类型白名单。全局单文件默认50MiB、请求100MiB（含multipart边界/字段）、批量10个；图片/JSON10MiB，文档/Excel20MiB，视频/业务附件/ANY50MiB，均可被全局硬上限收紧。文件名、声明MIME和实际内容须一致；拒绝SVG/HTML/脚本及伪装内容；Office ZIP 检查结构和CRC，最多检查200项、解压2MiB，不解包落盘。文件和请求超限413，字段/内容不符400。

敏感文件只通过鉴权代理读取：未认领对象只允许上传者；匿名预上传在组织认领前不能读取（uploadToken不是读取凭据）。已认领营业执照仅所属组织有效关系（ACTIVE/EXIT_APPROVING/PENDING_LEAVE）的 OWNER/ADMIN 可读取，且组织未逻辑删除；不使用用户单组织兼容字段或 hasExpertManagementRole 展示字段授权。**已认领项目/考试附件读取依赖后续业务关系，当前明确403，不能用于完整项目/考试流程。** 非敏感文件沿用登录后访问规则。只接受新项目存活台账，不接收旧bucket未登记对象；这与旧普通文件“只要登录即可查看”存在收紧差异，尚未作为完整兼容验收通过。

组织注册的 `organization.businessLicense` 接受 BUSINESS_LICENSE 的 `objectKey/uploadToken`，默认24小时内一次认领（可配置），原文凭证不落库。无记录/类型错误/存储对象缺失或大小不符400，错误凭证403，过期/重复409，存储关闭/不可达503。认领、验证码消费、组织与用户创建同事务，失败回滚；`organization.businessLicenseUrl` 保留旧字段名，返回objectKey或null，不是公开URL。

Swagger 提供 multipart 输入、请求/响应/查询字段中文说明和完整 schema 示例，文件代理 200 按实际媒体类型记录二进制响应。文件与注册测试使用专用 PostgreSQL 和内存对象存储；真实 OSS 可通过 `pnpm --filter @tyde/server storage:verify` 独立验证，不能把测试替身结果视为真实存储验收。

示例配置默认 `FILE_STORAGE_PROVIDER=disabled`。启用时仅在后端配置 OSS bucket 与密钥；服务端读写使用 `OSS_ENDPOINT`，客户端下载签名使用 `OSS_PUBLIC_ENDPOINT`，两者按网络环境选择内网或外网端点。新对象显式私有且禁止覆盖。真实存储、营业执照认领及后续业务附件关系需按实际环境验收，步骤见[部署说明](DEPLOY_TEST.md#文件存储与上传01)。

## 用户资料与昵称（02）

- `GET /users/nickname/check?nickname=小明` 可匿名，无请求体。trim后非空，最多64字符；返回 `nickname/available/suggestion/message`。占用时从1递增推荐，最长64字符（必要时截短原昵称）；最多尝试1000次，耗尽409。查询不预留昵称；注册默认真实姓名生成的昵称同样受唯一约束，重复409且注册事务回滚。新PostgreSQL按大小写敏感精确匹配，旧MySQL排序规则差异待兼容验收。
- `POST /users/me/update` 需本人会话，body所有字段可选：`avatarUrl`（512字符）、`bio`（1000字符）、`idCardNo`（32字符）、`newPassword`、`confirmNewPassword`（64字符）、`roles`（1～3个已知角色）。省略/null保持；头像、简介、未认证身份证传空白可清空，非空值trim，身份证转大写。未知字段400，不能提交目标用户ID、昵称、姓名、邮箱或实名状态。
- 身份证沿用15位或18位格式验证，非完整证件真实性/校验码核验；已认证号码仅可提交同一号码，改号/清空403，重复号码409。`idVerified`从数据库读取，注册默认0，没有自助认证入口。姓名/邮箱继续只在注册入口验证。
- 密码必须成对一致且满足既有强度规则；资料更新与全部Web/桌面会话及刷新令牌撤销同事务，Web成功清除Cookie。服务端复用登录/重置的手机号锁并在锁内复查会话，拒绝并发中已撤销的凭据。角色兼容字段沿用固定EXPERT规则：已知角色选择忽略，不授予其他角色，不单独触发下线。
- 成功返回完整UserDTO；头像/简介/实名状态读取实际保存值。沿用旧更新服务回读语义，更新响应 `selectedRole=null/hasExpertManagementRole=false`；后续 `GET /users/me` 按当前会话返回EXPERT。组织资料已切多组织有效关系选择，OWNER职责已接实，项目负责人分支和信用仍待后续任务回补；改密后presence置离线待14。
- 头像保持旧字符串契约，不新增uploadToken字段，不抓取远程URL、不认领文件；存储objectKey不获得读取或保留权限，文件生命周期仍按01台账执行，未认领上传文件会过期。完整头像文件生命周期未作为本批交付。敏感文件不能因头像字段而公开。

资料更新请求示例（可在Swagger验证）：

```json
{ "avatarUrl": "https://example.com/avatar.png", "bio": "数据标注专家", "roles": ["EXPERT"] }
```

新增 `20261019010000_user_profile` 迁移，增加头像、简介、实名状态、修改人及昵称唯一索引。部署前先人工检查历史昵称重复；迁移遇到重复会原子回滚，不自动改名。用户已在专用测试库应用且41项集成全部通过；本地运行后端已通过51项HTTP检查，证明新资料字段与昵称冲突保护生效。本轮未执行迁移或查询迁移历史；开发库迁移记录核对、部署及兼容验收仍待完成；最新验收以[02任务记录](../../backend-migration/02-user-profile/todoTask.md)为准。本机专用测试库迁移/复验命令（本轮已由用户成功执行）：

```sh
node scripts/migrate-test-database.mjs
pnpm test:integration
```

脚本仅接受已有 `.env.test` 中 `APP_ENV=test/TEST_DATABASE_RESET=true`、本机且以 `_test` 结尾的库，不创建库、不清表；集成测试会清空该专用库。切勿用开发库替换测试配置。昵称重复可先只读检查 `SELECT "displayName", COUNT(*) FROM "User" GROUP BY "displayName" HAVING COUNT(*) > 1;`，经用户决定后处理存量，不自动改名或删号。

## 组织资料（03首批）

GET `/organizations?orgId=<UUID>`、POST `/organizations/update` 沿用旧路径、方法、字段名和Result。查询允许指定组织的OWNER/ADMIN，关系须为ACTIVE、EXIT_APPROVING或PENDING_LEAVE；编辑只允许ACTIVE的OWNER。权限读取`UserOrgRel`，不使用EXPERT登录身份或用户单组织兼容字段。无关系403；有合格关系但组织不存在/已逻辑删除404。

编辑请求 `{ "orgId": "00000000-0000-4000-8000-000000000002", "description": "新简介", "logoUrl": "logos/example.png" }`。description最多1000字符、logoUrl最多500字符；未传/null保持原值，trim后空串清空，额外字段400。角色检查与资料更新同事务锁组织行并记uid审计。Logo只存地址，不做文件认领或归属校验。响应保留旧组织资料字段，营业执照返回objectKey；认证/运行状态读数据库真实值。完整示例和所有字段说明见Swagger。

新迁移`20261019020000_organization_memberships`已由用户应用专用测试库；155项单测通过，2026-10-19 13:23:17用户本机45项集成全部通过，缺列/缺表阻塞已解除。开发/部署库尚未应用本次迁移，真实运行后端HTTP联调待完成。UUID/ISO UTC时间仍与旧数值ID/本地日期格式不同，待兼容验收。后续成员管理及多组织回补见下节；该段为组织资料批次记录，审批/导入后续已接入，完整进度以[03任务](../../backend-migration/03-organizations/todoTask.md)为准。

## 组织成员（03成员管理批次）

POST `/organizations/members` 请求必填orgId（UUID），可选keyword、joinedStartDate/joinedEndDate、leftStartDate/leftEndDate、employmentType、position、joinStatus、projectId、current/size；默认第1页、每页20，最多100。keyword去首尾空白，包含匹配真实姓名/UID，仅完整手机号精确匹配；不按昵称检索。日期`yyyy-MM-dd`按上海自然日闭区间；起点晚于终点或非法日期400。旧Controller说明与实际SQL对已离组成员范围矛盾，当前遵循SQL：未传joinStatus包含所有状态，可显式筛选LEFT/REMOVED。响应是total/pages/current/size/records，空结果pages=0、records=[]；手机号脱敏，不暴露用户敏感字段。

项目成员模型未迁移，`activeProjectCount=null`表示未知，提交非null `projectId`返回503，不返回假0或忽略筛选；API-018保持部分迁移，04模型落地时回补。排序规则/大小写及UUID、ISO UTC响应日期仍待旧接口兼容验收。

POST `/organizations/members/update` 必填orgId、memberId（组织关系ID）、versionNo；joinedAt/employmentType至少一项非null，null/未传保持。joinedAt沿用旧`yyyy-MM-dd HH:mm:ss`按上海解释，不得为未来；FULL_TIME=全职、PART_TIME=兼职。主管可编辑全部目标，管理员仅普通成员/自己；目标不额外限制关系状态（沿旧Service）。操作人须处于ACTIVE/EXIT_APPROVING/PENDING_LEAVE；组织锁内实时检查权限和版本，成功版本+1并记uid审计，冲突409。

POST `/organizations/members/position` 必填orgId、memberId、position（OWNER/ADMIN/MEMBER）。目标须ACTIVE；主管可调整/转让，不能直接降低自己角色；转让时原主管变ADMIN。管理员仅可调整普通成员或自己的ADMIN/MEMBER，不能设OWNER。最多5名有效管理员，包含PENDING/PENDING_ACTIVATION/ACTIVE/EXIT_APPROVING/PENDING_LEAVE；转给现有ADMIN一增一减，不额外占名额。同角色幂等不改版本/时间；实际变更版本+1，主管转让两条关系同事务更新。

认证组织资料及营业执照授权已切成员关系，陈旧`User.organizationId/orgPosition`不授予权限。本人资料从有效、未删除组织中选OWNER优先/最早入组（null日期排后）。`hasExpertManagementRole`按旧SQL接实OWNER分支，ADMIN本身不代表该职责，组织项目负责人分支待07；该标志不作为业务接口授权凭据。

180项单测及52项真实PostgreSQL集成通过（含并发角色/版本/名额、权限即时失效），对象存储使用内存替身；本批无新迁移，未执行开发/部署或真实OSS/运行中HTTP联调。审批内核及退出流程进展见下节；导入和首次激活仍在03后续批次。

## 组织退出与审批（03审批批次）

POST `/organizations/members/exit-requests` 必填`Idempotency-Key`（trim非空、最长128字符），请求orgId、reason（trim非空、最长1000字符）、plannedLeaveDate（上海当天或未来，yyyy-MM-dd）；memberId可选，不传/null为本人。主管须先转让，不能直接退出；普通成员只可操作自己；管理员只可代普通成员；主管可代非主管。本人退出创建PENDING流程、当前ACTIVE主管单待办、EXIT_APPROVING成员及SUBMIT日志；代操作当天LEFT、未来PENDING_LEAVE，流程APPROVED但无待办。组织、申请人、key相同复用流程，不比较新payload；日期/原因仍先校验。重取时flowStatus是当前流程状态，joinStatus是初始表单快照，不保证等于成员实时状态（沿旧Service）。

POST `/organizations/approvals/pending` 请求orgId，可选businessType/current/size（默认1/20，最大100）；参与状态主管/管理员可查询，但结果仅当前用户的PENDING节点且流程PENDING，按申请时间升序。POST `/organizations/approvals/records` 同样按组织授权，按已处理节点分页而非工单；同工单多节点多条，代操作无节点不会出现在此列表。支持businessType、status、startAt/endAt（上海`yyyy-MM-dd HH:mm:ss`、闭区间、起点不得晚于终点）。取最后一条节点动作，人员名称优先当前昵称(姓名)，缺失回退快照；SYSTEM动作保持SYSTEM。

POST `/organizations/approvals/process` 必填orgId、flowNo、nodeId、nodeVersionNo、flowVersionNo、action（APPROVE/REJECT），actionComment最长1000字符，驳回时trim后非空。仅当前组织主管且为节点实际审批人可处理ORG_MEMBER_EXIT，组织→流程→节点加锁；双版本或预期成员状态冲突409，跨组织/非审批人403，节点错配400，坏表单500且不提交任何变更。通过时未来日期PENDING_LEAVE、当天/逾期LEFT；驳回恢复ACTIVE并清空拟离职日。节点、流程、成员、动作日志同事务。主管转让不自动转派已有节点，旧待办可能暂不可处理；本批保持旧规则，后续策略需明确。

新迁移`20261019030000_approvals`已由用户应用专用测试库，开发/部署库未应用。审批定义/配置种子保留旧ROLE(OWNER/ADMIN)配置，但当前退出业务仍使用内置OWNER单节点；不会据种子放宽审批权限。旧processId/configId=0以新UUID模型null表示内置。通用条件表达式、多审批人执行器、配置管理HTTP未新增，后续12按其业务接入节点推进。

API-021/024项目副作用尚未接实，保留部分迁移：组织LEFT时同事务写`OrganizationDeparture` PENDING记录（按关系+版本去重），不表示项目成员、负责人、人员变动单或实时事件已清理。04/07/12接处理器并处理积压后才可标COMPLETED；当前不提供清空待补偿记录的捷径。到期PENDING_LEAVE须执行维护命令，每条成员独立事务，重复运行幂等；部署需配置每天上海零点调度，本批未部署。详见[部署说明](DEPLOY_TEST.md#组织到期离职维护03)。

本批190项单测、63项专用PostgreSQL集成及Swagger完整示例/中文字段/序列化检查通过。尚未完成开发/部署库、真实运行后端HTTP及兼容验收；UUID、ISO UTC响应时间沿用新项目现状。模板/导入与首次激活进展见下节。

## 成员导入及首次登录激活（03导入批次）

GET `/organizations/member-imports/template` 仅需有效登录，不要求组织管理身份或orgId；直接返回XLSX字节与下载头，无Result包装。首行为填写说明、次行为姓名/手机号/人员属性/组织内角色/入组时间；前三列必填。Accept-Language主语言以en开头时使用旧英文表头和提示，其余默认中文；SheetJS CE默认视觉样式与旧POI不完全相同，未承诺颜色/红星号/冻结窗格一致。

POST `/organizations/member-imports/generate` 使用multipart/form-data及必填Idempotency-Key（trim非空、最多128字符）；orgId可在查询参数或表单提供，memberText也可使用两种来源，同名不同值400。文件沿旧字段`csvFile`，支持XLS/XLSX及严格UTF-8 CSV；非空文件优先，文件错误不降级读文本，空文件可回退非空文本。textIgnored如实说明是否忽略文本。最多1个文件、2个文本字段；文件/文本当前最多50MiB（配置可更严格），总请求沿files配置；XLSX声明解压总量最多100MiB/1024项，不接受ZIP64/多卷，物理工作表范围最多10万行，拒绝公式/错误单元格且不求值。

文本支持中英文逗号；CSV文件只接受英文逗号，均支持双引号、转义双引号和字段内换行；空行/说明行忽略，首个固定表头可保留。列依次为姓名、手机号、人员属性、可选组织角色、可选yyyy-MM-dd入组日；姓名Unicode字母及常见英文名分隔符最多64字符，手机号大陆11位。全职/兼职或Full-time/Part-time；管理员/成员或Administrator/Member，空角色默认成员；空日期取上海上传当日零点。角色枚举代码FULL_TIME/ADMIN不能代替这些导入显示值，不允许导入主管。

先聚合全部格式、批内重复及已有关系错误；任一行错误HTTP400、code=400、data保留sourceType/textIgnored/totalCount/validCount/invalidCount/createdCount/rowErrors/members/createdAt，且不创建任何账号/关系；rowNo从去说明/表头后的数据行1开始，0为全局错误，手机号回显脱敏。无错误才原子导入，createdCount包括新建、复用已有账号及重新入组。新账号个人EXPERT、无默认密码，关系PENDING_ACTIVATION；已有账号无有效组织关系才直接ACTIVE，保留原账号类型、资料、密码及用户状态；历史LEFT/REMOVED关系复用ID、清空离组数据、版本+1。PENDING/PENDING_ACTIVATION/ACTIVE/EXIT_APPROVING/PENDING_LEAVE任一有效组织关系均阻止重复导入/跨组织占用。管理员上限5名，含待激活。

组织和操作人隔离的幂等结果保存24小时：同键不同实际来源/忽略文本标志/有效内容409，处理中409，完成后回放首次结果（包括完整行错误）；回滚不留回执，修改校验失败输入需新键或等24小时。数据库事务级占位替代旧Redis的15分钟PROCESSING锁，崩溃随事务释放；回执和成员提交同事务，不保存文件、文本或手机号清单原文。db:cleanup会清理过期回执。注册/导入/登录共用手机号锁；导入按手机号升序→组织锁，登录按手机号→组织ID升序激活，避免跨组织死锁。

首次密码或SMS登录成功前，事务内激活该用户所有待激活关系，版本+1及uid审计；激活失败回滚验证码消费/关系变更，不签发令牌、不更新最近登录。重复登录幂等，刷新和重置密码本身不激活；新账号可先SMS登录，或重置后用密码登录。API-002/008继续读取真实多组织关系，角色仍固定EXPERT。

依赖已由用户安装，固定为[SheetJS官方Node安装文档](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)列出的0.20.3 tarball，并保留锁文件integrity。新增迁移`20261019040000_member_imports`已由用户应用专用测试库；既有203项单测通过（本次未重跑），2026-10-19 16:26:59由Agent复跑74项数据库集成全部通过（总23.77秒），覆盖导入、首次激活及注入失败回滚。默认入口已交接04；开发库全部7个迁移也已由用户应用，重启后41项业务HTTP复测全部符合预期（含组织注册200），完整证据见03记录；部署、每日调度及兼容回补保留原归属，接口状态不因专用库验证而提升为完整验收。
