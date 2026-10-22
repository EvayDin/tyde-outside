# 执行专家接单侧（07）

2026-10-22最新07第二批集成通过：用户18:09:22定向复验成员进度/负责人历史1项通过（191跳过，共192项，总11.60秒，测试1.12秒），原免试计划夹具P2025已解除；结合18:03:22已通过的来源/多组织权限/身份优先/status筛选1项，本批2项集成分批全部通过，不是全192项复跑，无需重复。061保留部分迁移，064前批通过证据不变；421单测及类型/ESLint/build、修正后18项定向证据保留。无新迁移，迁移历史未另查；本轮仅同步用户结果和文档，未重跑测试、修改业务代码或操作数据库。保持07，下次直接065—067及API-008，061按钮随067接回，完整生产/报量当天撤卡及审批/转项真值归10—12，062/063按需回补；业务Agent继续mock，不开始08。

当前API-061—063部分迁移，API-064已实现待验收。065/066负责人写入及067接单/拒绝尚未接入，不由候选查询推断其可用。接口进度和验证唯一记录见[07任务](../../backend-migration/07-expert-assignments/todoTask.md)。

`GET /api/v1/expert-assignments/project-owner-candidates?assignmentId=1`，无请求体。支持受信Cookie或Bearer会话，当前角色必须为EXPERT；assignmentId为1至2147483647的十进制正整数。不存在、个人分配或已删除项目返回404；非分配所属组织有效OWNER返回403；非法参数400，失效会话401。组织未删除，OWNER关系须为ACTIVE/EXIT_APPROVING/PENDING_LEAVE；不按账号类型或单数organizationId推断多组织权限。

返回`code/message/data`，data为数组，字段为`userId/uid/name/avatarUrl/position/projectOwner`。userId为新库UUID，uid为平台UID；name为昵称(真实姓名)，缺失时按已有名称/UID回退；avatarUrl未设置为null；position为OWNER/ADMIN/MEMBER。候选含主管本人，仅ACTIVE账号且尚未完全离组的成员，排除PENDING_ACTIVATION/LEFT；按position和关系ID升序，无结果为空数组。

projectOwner仅在分配ACCEPTED时表示现任负责人：优先ACTIVE负责人关系，只有关系表完全没有历史时才使用projectOwnerUserId。已有REMOVED历史不恢复旧列；已离组/停用负责人不在候选中。查询允许待接单、拒绝及取消状态，此时所有projectOwner为false。读取使用RepeatableRead事务，不写负责人、接单、成员、节点、版本、轮次或通知。

完整中文Swagger及可校验响应示例见`/api/v1/docs/`。原HTTP方法、路径及字段名保留；用户ID沿新库既有UUID契约。组织资料ACTIVE/APPROVED不代替本人组织任职资格。

本批416项单测、类型检查、ESLint及后端build通过。新增2项专用库集成首次因127.0.0.1:5432不可达停在beforeEach；用户17:42:12定向复验2项全部通过（188跳过，共190项，总4.33秒，测试1.44秒），原初始化连接阻塞解除。不是全190项复跑，无需重复本批2项。未增加schema/迁移/依赖，迁移历史未另查；本轮仅同步结果，未重跑测试或操作数据库；业务Agent继续mock。以下为已通过的命令，留作追溯：

```sh
pnpm --filter @tyde/server test:integration -t 'expert owner candidates'
```

仅使用现有允许重置的专用_test库；本批无需新迁移，不重复本批2项及06前批11项集成。064真实HTTP/部署/完整兼容仍待验收，当前保持07，下次直接061及065—067。

## API-061 任务卡片（部分迁移）

`POST /api/v1/expert-assignments/my-tasks`，必填JSON请求体，可传`{}`。可选`keyword`（最多100字符，trim后按项目名/需求方名称创建快照模糊匹配）、`acceptanceStatus`及旧别名`status`。状态取PENDING_ACCEPTANCE/ACCEPTED/REJECTED/CANCELLED/REPLACED，null或省略不筛选；两状态同时非null且不一致400。拒绝、取消、替换并非待办，按这些状态筛选得到空数组。

当前会话EXPERT，个人仅本人；组织未接单仅有效主管，已接单允许ACTIVE/EXIT_APPROVING/PENDING_LEAVE成员。已接单组织的主管/负责人/未拒绝成员身份优先个人；成员拒绝/取消或离组后恢复个人任务，多组织分别计算。返回分配下发时间和ID倒序，无结果空数组。负责人集合以ACTIVE关系为准；有REMOVED历史不回退旧单值，唯一负责人时才填旧单值响应字段。

返回code/message/data，data数组中每项包含assignmentId、basicInfo、acceptanceStatus、needWrittenExam、currentNodeCode、branchNodeCode、accessContext、operations。basicInfo保留旧字段及完整分类/负责人集合，时间为上海`yyyy-MM-dd HH:mm:ss`，用户和组织ID为新库UUID。currentNodeCode始终项目主线；普通成员branchNodeCode按最新成员关系的实际入项/培训重算，未入项/终态不沿用旧培训。无成员且需考试、本人未交卷时展示考试支线；负责人还要求实际ACTIVE考试的当前版本报名未截止。交卷后无考试待办，结项硬撤卡，未配置考试的负责人保留管理卡片。

接口读取RepeatableRead事务，不推进节点/版本/轮次、生成成员或写快照。067未接入前canAccept/canReject=false；11未接入前canReportOutput=false。完整生产能力、当天已报量后撤卡、主管审批/确认入项/子任务/核验和转项待办来源竞争由10—12接回；本批不沿用这些旧快照，不宣称完整卡片兼容已完成。061的接单按钮随067开发接通并复测。Swagger请求和响应均有完整中文说明与可校验示例。

本批421项单测、类型/ESLint/后端build通过；新增2项集成17:51:10均在beforeEach因127.0.0.1:5432不可达，业务断言未执行，190跳过，共192项。无新schema/迁移/依赖，未操作开发/部署库。仅复验本批命令（在tyde目录、使用现有允许重置的专用_test库）：

```sh
pnpm --filter @tyde/server test:integration -t 'expert task cards'
```

064及06前批通过项不重跑。真实HTTP/部署/完整兼容仍待验收，当前保持07，下次065—067及API-008。

2026-10-22最新07集成夹具修正：用户18:03:22定向2项，1通过/1失败/190跳过（共192项，总12.58秒）；060来源/多组织权限/身份优先/status筛选已通过，用户本机数据库连接阻塞解除。唯一失败是测试误对未创建的生产计划调用update（P2025），已改为显式创建含全部必填字段的免试计划夹具，业务实现未改。修正后18项定向单测（18:05:03，总2.84秒）及变更ESLint通过；Agent仅复验失败1项仍因自身环境127.0.0.1:5432不可达停在beforeEach，未执行修正后业务断言。仅该1项待用户本机复验，不重复已过1项、064及06；421单测及类型/build前批证据保留。无新迁移、未操作开发/部署库。保持07，复验后065—067及API-008，061—063仍部分迁移，业务Agent继续mock，不开始08。

失败单项复验（tyde目录）：`pnpm --filter @tyde/server test:integration -t 'expert task cards read latest membership progress'`。
