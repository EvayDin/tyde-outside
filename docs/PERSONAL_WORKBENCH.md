# 个人中心与工作台后端

2026-10-21插队批次：保留原有资料查询/更新、文件上传和退出接口，共新增9个HTTP入口；本轮补齐请假/考勤修正申请、主管审批生效与本人撤回。所有路径加`/api/v1`，除文件内容代理外使用`{code,message,data}`；具体中文字段Schema与完整示例以`/api/v1/docs/`为准。

| 接口                                        | 当前行为与边界                                                                                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /users/me`                             | 沿用本人资料、手机号/身份证脱敏、固定EXPERT及有效组织摘要；项目负责人展示能力、信用等既有回补仍保留                                             |
| `POST /users/me/update`                     | 本人资料、头像关联/清空、实名证件保护；改密撤销全部会话，不保留当前会话                                                                         |
| `POST /files/upload`                        | AVATAR必须登录；multipart file、bizType=AVATAR；上传响应仍是objectKey/uploadToken/url等原字段                                                   |
| `POST /organizations/members/exit-requests` | 复用既有退出/主管审批；Idempotency-Key必填，离组后的完整项目清退仍待07/12                                                                       |
| `POST /users/me/applications`               | 强制本人申请范围；默认ORG_MEMBER_EXIT，显式businessType:null查全类型；支持status/startAt/endAt/current/size。返回真实审批记录，不生成申请       |
| `GET /organizations/attendance`             | month=YYYY-MM、可选orgId；组织成员必须指定有效组织，无组织EXPERT不传；整月每天一项、汇总和permissions                                           |
| `GET /organizations/calendar/holidays`      | month、可选orgId；登录即可查询，orgId不影响日历结果；仅特殊节假日与调休，普通周末不列入                                                         |
| `PUT /users/me/schedules/batch`             | 仅无有效组织EXPERT本人；schedules[]、overwrite必填，可选timezone，Idempotency-Key必填                                                           |
| `POST /organizations/attendance/apply`      | MEMBER/ADMIN本人申请，orgId/attendanceDate/applicationType/finalStatus/reason/versionNo；LEAVE条件必填leaveStartAt/leaveEndAt；由主管审批后生效 |
| `POST /organizations/attendance/withdraw`   | applicationId（UUID）、flowVersionNo；仅本人PENDING考勤申请可撤回，离组后仍可撤回，不改变考勤                                                   |
| `POST /organizations/attendance/update`     | 有效组织OWNER/ADMIN直接修正已有日考勤；orgId/dailyId/finalStatus/versionNo，manualRemark可选；普通成员403，未来日期400                          |
| `GET /expert-assignments/my-projects`       | 仅本人已接单个人分配或组织普通成员ACCEPTED/SELECTED响应；关键字匹配项目、需求方、准入状态与节点                                                 |
| `GET /expert-assignments/detail`            | assignmentId；保留projectDetail/productionPlan，增加assignmentId、项目主线currentNodeCode和availableOperations；本批仅VIEW_DETAIL               |

## 头像调用链

1. 登录后以`bizType=AVATAR`上传图片，保留响应的`objectKey`和`uploadToken`。
2. 保存资料示例：`{"avatarUrl":"avatar/2026/10/21/example.png","avatarUploadToken":"上传返回的凭证"}`。头像类型、本人归属、凭证/过期、对象存在/大小全部校验，成功存储服务端签发的展示URL。
3. 保存响应或后续`GET /users/me`的avatarUrl可直接展示；重复保存本人已认领头像不要求再次消费凭证。返回的服务端同源上传URL也可被识别关联，但新客户端优先使用objectKey。
4. `{"avatarUrl":""}`清空；省略或null保持。单独提交avatarUploadToken为400。旧头像释放后到期由既有`db:cleanup`清理，事务回滚时认领/释放/资料一并回滚。

历史外部URL/非AVATAR字符串继续兼容，不远程抓取、不自动认领，也不授予敏感文件读取权限。AVATAR从可匿名上传收紧为登录上传，是为保存时校验本人归属而补齐的业务约束。真实OSS上传/认领/替换/清空/URL展示已通过本机HTTP验收。

## 申请、排班与考勤

本人申请默认每页20、current=1，size最大100；时间为`yyyy-MM-dd HH:mm:ss`，Asia/Shanghai，包含两端。按appliedAt降序、同时间ID降序。返回applicationId（UUID）、flowVersionNo等字段；历史表单保留原始JSON，非法计划离开日期仅将便捷字段置null。未知businessType返回空结果，不扩大查询人范围。新增ATTENDANCE_LEAVE（请假）、ATTENDANCE_CORRECTION（考勤修正）已接提交入口，沿同一真实审批表聚合；查询全部类型仍须显式传businessType:null。

本人排班最多366条，不限制过去/未来日期；每条scheduleDate、dayType=WORK/REST。WORK要求startTime/endTime（HH:mm或HH:mm:ss），结束须晚于开始；REST不能提供时间。timezone缺省/null/空白默认Asia/Shanghai，须有效IANA时区。重复日期400。overwrite=false跳过已有班次并返回conflicts；true覆盖并增加版本。标准化后相同本人/key/参数返回原结果；同键不同参数409。用户行锁串行化个人排班，回执和班次同事务落库；重放仍重新检查无组织资格。

月历查询不创建日考勤。过去的ACTIVE工作排班没有日考勤时展示ABSENT，当天/未来为PENDING_ATTENDANCE；休息为REST，无排班为UNSCHEDULED；已有日考勤finalStatus优先。迟到且早退同时计入两项汇总。保留旧日考勤的打卡/复核字段，打卡写入、原始事件重放及实时通知仍归09/14后续能力。

`permissions.canBatchSchedule`只在独立作用域true，`canDirectUpdate`按有效OWNER/ADMIN计算，实际写入还检查指定组织/日考勤/日期/版本。`canApply`表示MEMBER/ADMIN可提交本人申请，`canWithdraw`表示该月存在本人待审申请；每日days新增application及permissions，返回申请主键、流程版本、申请类型/状态/目标状态与可撤回标记，以及canApplyLeave/canApplyCorrection/canWithdraw/canDirectUpdate。无申请时application=null，不能把流程版本当成日考勤版本。

直接修正沿旧Service允许有效OWNER/ADMIN操作组织已有日考勤，不额外收紧为仅主管本人；普通成员必须走后续申请。只允许PRESENT/LATE/EARLY_LEAVE/LATE_EARLY/LEAVE/ABSENT/REST。使用manualRemark，不接收reason替代字段；版本不匹配409，锁组织及日考勤，修正前后快照与审计同事务追加，autoStatus不覆盖。

节假日源为公开的`NateScarlet/holiday-cn`年度JSON，通过jsDelivr读取；进程内缓存24小时，同年并发请求合并，10秒超时，校验年份/日期/重复项/类型。失败先回退已有校验缓存，再回退随包2026官方年度基线；无该年缓存/基线时503，不把周末或空数组伪装成成功数据。缓存最多16个年份，无Redis依赖；多进程各自缓存。真实环境已确认外网源超时；2026随包回退已实测通过。

## 本人项目与附件

保留旧“我的项目”口径：主管/项目负责人不属于组织普通成员列表；组织整体ACCEPTED后，本人成员响应必须ACCEPTED或SELECTED。有效组织身份优先于同项目个人身份，普通成员未响应时也优先组织身份，REJECTED/CANCELLED或离组后个人身份可恢复。每项目保留最新有效分配。无需笔试/尚无计划时needWrittenExam=false；有应试事实时按通过、待阅卷、已进入未通过、未进入的优先级聚合，需笔试且未通过时返回ENTRANCE_EXAM。

通过/免试后读取本人最新ProjectMember的实际履约事实及角色支线快照；已入项且确认培训才展示PRODUCTION_TASK，否则按旧my-projects规则回退STANDARD_TRAINING，该展示回退不等于授予入项或培训操作。报量核验真值及OUTPUT_DATA_REVIEW分支待11，不沿用可能失效的旧核验快照，因此API-062仍部分迁移。

详情的个人分配仅本人可读；组织分配ACCEPTED时有效组织成员可读，其余状态只限有效主管。只读生产要求的总量级/作业人数/质检人数取分配值，CPD、人群和阶段取已确认计划，不返回管理确认人/扩展JSON等。availableOperations仅反映已开放操作，当前只有VIEW_DETAIL；接单、考试、培训、生产动作仍待原任务，不因节点展示而放行。API-063保留部分迁移以等待完整操作范围。

项目附件继续校验台账CLAIMED、业务绑定、ACTIVE附件及未删除项目。在现有NAVIGATOR/PM规则之外，接回旧标准材料SQL的专家资格：必须存在真实ACCEPTED接单来源；免试时分配个人/有效组织成员可读，需笔试时有效组织主管、当前项目负责人或有未删除考试ADMITTED结果的专家可读。不凭ACTIVE项目成员或上传者身份放行。考试附件仍待05/08。

## 迁移与验证

第15迁移（前批）：`20261021010000_personal_workbench`。新增OrgMemberSchedule、OrgAttendanceDaily、OrgAttendanceAdjustment、PersonalScheduleReceipt、ProjectExpertAssignmentMember、EntranceExamAttempt；补ProjectMember.admissionAttemptId外键与组织排班成员复合外键。PERSONAL作用域、组织成员非空及班次日期/时间均有SQL约束。没有新增依赖、没有创建测试业务记录或开放运维写HTTP。

**应用前检查**：旧版本没有应试表，若`ProjectMember.admissionAttemptId IS NOT NULL`，新增外键会拒绝无来源数据。维护者应先查询这些行并核对真实来源，不自动清空或伪造考试。迁移以BEGIN/COMMIT包裹，不自动修改旧项目或旧库。examVersionId/paperId目前保留来源标量，待05配置版本/试卷落地补外键；考试写流程在05/08，不由本批查询接口创建。

用户137项集成全部通过已证明第15迁移所需专用库结构就绪；迁移历史未另查，Agent本次未执行数据库操作。其他目标环境仍需单独应用。专用`.env.test`目标必须可连接且库名以`_test`结尾、允许测试清表，再由维护者执行（在tyde根目录）：

```sh
cd apps/server
node --env-file=.env.test node_modules/prisma/build/index.js migrate deploy
cd ../..
pnpm test:integration
```

实际验证：用户2026-10-21回传14:12:47启动的137项集成全部通过（1文件，总77.59秒，测试66.39秒）；第15迁移所需专用库结构及本批业务已验证，原数据库连接阻塞解除，迁移历史未另查。开发/部署库迁移及真实OSS/日历源联调仍待验收。既有299项单测（24文件）、服务端typecheck、变更文件ESLint、格式和Swagger检查通过，本次仅同步结果，不复跑测试或操作数据库。原12:07:21本机5432连接失败已解除。旧04的130项仅为历史基线；137项是新增申请/撤回实现前的基线，不作为本轮新增流程验收。完整内容限制检查所需本机词表仍缺失，未提交/发布。

## 本轮新增申请与审批契约

本轮依用户“继续至插队结束，再按原顺序执行”授权，沿用已有组织单主管审批机制完成新增流程：有效MEMBER/ADMIN提交本人申请，由提交时有效主管作为实际节点审批人，且处理时仍须是组织主管，禁止自审；OWNER本人沿用获授权的直接变更入口，无组织专家无组织审批人，不开放组织申请。管理员已有直接变更资格保持不变。主管转让不自动转派既有待办，沿原审批规则。

提交示例：

```json
{
  "orgId": "00000000-0000-4000-8000-000000000002",
  "attendanceDate": "2099-01-01",
  "applicationType": "LEAVE",
  "finalStatus": "LEAVE",
  "reason": "个人事务",
  "versionNo": null,
  "leaveStartAt": "2099-01-01 09:00:00",
  "leaveEndAt": "2099-01-01 12:00:00"
}
```

- `versionNo`必填，取月历的`dailyVersionNo`，无日考勤显式传null；可选dailyId用于额外核对，不能传排班版本替代日考勤版本。提交时服务端保存当前排班ID/版本，审批前再次检查。
- `applicationType=LEAVE`只能请求`finalStatus=LEAVE`，须已有ACTIVE工作排班且时段位于班次内，时间格式`yyyy-MM-dd HH:mm:ss`按排班timezone解释，结束晚于开始且同一天；多天请按天提交。请假可历史/当天/未来，部分时段也将日级考勤标记LEAVE，月汇总按一天计，不拆分当日状态。
- `applicationType=CORRECTION`仅当天/历史，目标为PRESENT/LATE/EARLY_LEAVE/LATE_EARLY/ABSENT/REST，不能以该类型绕过请假时段校验；leaveStartAt/leaveEndAt必须省略或null。已有日考勤或ACTIVE工作排班才能申请。尚无日考勤时批准后新建结果，保留排班来源和期望时间，不制造打卡事实。
- 同一组织/本人/日期只能有一条待审考勤申请，LEAVE/CORRECTION互斥，重复409。提交只写ApprovalFlow/Node/ActionLog，不修改日考勤；已请假当天不能重复提交请假。
- 审批使用既有`POST /organizations/approvals/process`，从pending查询获取flowNo/nodeId/flowVersionNo/nodeVersionNo。只有当前有效主管且为该节点实际审批人可以处理；APPROVE复查申请人关系、排班和日考勤快照，变化返回409，整笔不生效；REJECT必须说明意见，不写日考勤，可关闭已过期申请。
- 批准在同事务内更新/创建OrgAttendanceDaily（manualOverride=true）、追加OrgAttendanceAdjustment、推进节点/流程及动作日志，保存afterData。旧autoStatus和打卡事实不覆盖；未来请假autoStatus为null，不能伪造未来缺勤。返回实际dailyId/dailyVersionNo/adjustmentId及推进后的flowVersionNo，考勤分支joinStatus/plannedLeaveDate为null。
- 撤回只允许本人PENDING考勤流程，组织→流程→节点统一锁顺序，审批/撤回仅一方成功，另一方409；节点置CANCELED，流程置WITHDRAWN并追加WITHDRAW动作，不改日考勤。撤回或驳回后可按当前版本重提；终态不允许再次撤回。退出组织等其他业务不能通过此接口撤回。本人离组后仍可撤回自己待审申请，但不恢复组织关系。

新增第16迁移`20261021020000_attendance_applications`仅将OrgAttendanceDaily.autoStatus/finalStatus及OrgAttendanceAdjustment.beforeStatus改为可空，沿旧日考勤“尚无结论”的真实语义，不回填或重写数据。本轮Agent应用专用本机测试库时P1001，未能应用；维护者应用后再跑145项集成。既有第15结构已由用户137项通过验证，不需重做原批次。

本轮实际验证：311项单测（25文件，15:01:40启动，总10.12秒）通过，包含12项新增申请权限/提交/审批/撤回/快照/Swagger测试；服务端typecheck及变更ESLint通过。145项集成已加入未来请假、重复提交、审批/撤回竞争、拒绝、越权与过期快照验证，首次运行原137项通过、新增流程在待办表单序列化失败；已修复并通过定向25项。随后定向集成曾发现缺第16迁移；现用户145项全通过，此阻塞已解除；137项通过不能替代新增8项数据库验证。真实环境/OSS/日历源、项目接单/考试/培训/生产动作、03完整清退与核验支线仍按原任务回补，不因新增申请完成而放宽权限。

## 全功能验收顺序

用户2026-10-21明确暂不开始05，先测试插队全部功能。当前入口保持插队任务。

1. 在`tyde/apps/server`执行`node --env-file=.env.test node_modules/prisma/build/index.js migrate deploy`，确认应用`20261021020000_attendance_applications`；回到`tyde`执行`pnpm test:integration`。测试会清表，仅允许专用`_test`库，不能替换为开发库配置。
2. 回传迁移和145项完整结果；有失败先修复并回归。本轮最终单测复验：2026-10-21 15:14:38启动，25文件311项全通过，总11.23秒。
3. 集成通过后再核对开发库迁移，启动`pnpm dev:server`，使用隔离测试账号/数据完成以下真实HTTP验收；记录结果后再决定交接，不提前开始05。

| 功能          | 必测行为                                                            |
| ------------- | ------------------------------------------------------------------- |
| 查询资料      | 本人字段、脱敏、组织摘要、未登录拒绝                                |
| 保存资料/改密 | 保存、清空、实名限制、密码确认与所有会话撤销                        |
| 上传头像      | 真实OSS上传→认领→替换→清空；跨用户/错凭证拒绝，旧对象释放           |
| 退出组织      | 幂等、主管限制、本人申请记录及审批状态；完整项目清退保持03遗留      |
| 本人申请记录  | 退出/请假/修正筛选、默认业务类型、分页/时间范围与本人隔离           |
| 月排班考勤    | 组织/个人隔离、每日排班与真实考勤、汇总、申请/日考勤版本和操作权限  |
| 节假日历      | 真实年度源、节假日/调休、正常月份及不可用503/缓存回退               |
| 本人批量排班  | 无组织专家、WORK/REST校验、覆盖、重复日期、幂等键重放与冲突         |
| 请假/修正申请 | 提交不立即改考勤、日期/时段/版本校验、同日互斥、主管批准生效/拒绝   |
| 直接变更      | OWNER/ADMIN授权、普通成员拒绝、未来日期拒绝、版本/审计              |
| 撤回          | 本人待审成功、越权/终态/旧版本拒绝、与审批竞争仅一方成功            |
| 本人项目列表  | 本人真实接单范围、keyword、组织身份、当前准入/履约节点              |
| 本人项目详情  | 本人/组织成员权限、详情与分配数量、仅显示已实现可执行操作、附件权限 |

数据库集成使用存储替身，不能替代真实OSS验收；单测模拟节假日源，不能替代外网联调。接单/考试/培训/生产写动作及03完整项目清退归原任务，不以本批查询通过宣布完成。

- 最新验证更新：用户2026-10-21回传15:17:51启动的145项集成全部通过（1文件，总69.67秒，测试60.48秒）；第16迁移所需专用测试库结构及新增8项申请/审批/撤回数据库验证已通过，迁移历史未另查。开发/部署库与真实HTTP、OSS、节假日源仍待验收；暂不开始05。 本次仅同步用户结果，未重跑测试或操作数据库。

真实环境验收已开始，已通过部分与尚待验证项、专用夹具准备命令见[逐项验收记录](PERSONAL_WORKBENCH_ACCEPTANCE.md)。日历正常源仍503，申请/审批/撤回与非空项目正向HTTP尚待夹具，暂不交接05。

- 2026-10-21最新真实验收：用户prepare-data.mjs执行成功，同事务准备5天排班及1个独立验收项目/组织接单/成员响应，脚本已核对开发库第16迁移完成。累计104项HTTP/OSS检查，103项符合预期；修正提交/主管批准、未来请假批准(autoStatus=null)、直接变更/旧版本409、撤回/重提/拒绝/过期快照、并发撤回与审批一方200另一方409、退出幂等与批准PENDING_LEAVE、本人申请分页/时间/状态/权限、非空本人项目列表/详情/keyword均通过。唯一未通过为真实节假日源503，用户本机Node fetch诊断明确10秒超时，待运行check-calendar.mjs比较源连通性。测试账号/组织数据保留，未改已有用户；暂不交接或开始05。

- 2026-10-21插队交接：本次13项接口实现及本机功能验收完成，保留原接口部署/兼容及跨任务部分迁移状态。用户诊断默认CDN/备用节点/GitHub均8秒超时、未配置代理；已按国办发明电〔2025〕7号及政府转载核对，新增编译随包2026年度日历基线（33个放假日、6个调休上班日），远程失败优先旧缓存、其次该年基线，无可靠年份仍503。运行后端国庆8条、春节11条、三月无安排及2099无可靠数据503四项复验通过，原日历功能阻塞解除；外网连通性本身未恢复。年度首次远程失败回退约10秒，之后24小时缓存；公告调整或新增年份须更新基线。累计108项HTTP/OSS记录（含原1项已修复失败及4项修复复验），最终313项单测通过（25文件，15:48:49启动，总12.90秒），类型/变更ESLint通过；用户此前145项集成通过，本轮无数据库改动、不重复跑集成。默认入口交回05但本轮不执行05；开发库16迁移已核对，部署库与完整兼容、07项目完整动作/11核验真值及03完整项目清退仍原归属。

## 2026日历离线回退与维护

`holiday-calendar.data.ts`依据国办发明电〔2025〕7号逐项整理，不复制远程服务实现。来源为[国务院通知](https://www.gov.cn/zhengce/content/202511/content_7047090.htm)，已与[政府网站转载](https://www.beijing.gov.cn/fuwu/bmfw/sy/jrts/202511/t20251104_4258838.html)及原年度数据交叉核对；核对日2026-10-21。全年33个公布放假日、6个调休上班日；全国安排不含地方民族节日，普通周末不生成条目。

数据通过TS编译随服务包含，不依赖启动时下载、工作目录、额外JSON复制或数据库种子。在线校验成功优先使用远程数据；超时/非法数据先回退既有缓存，再使用本年随包基线并缓存24小时。首次断网等待最多约10秒，缓存期内后续请求不访问外网。基线目前仅2026，其他年份无可用数据仍503；未来公告发布或调整后，维护者更新此文件、来源注释和全年/关键调休测试，再部署。未公布年份不复制上一年度，不用空数组掩盖数据缺失。API路径、请求和响应字段不变；Swagger已描述回退与年份边界。
