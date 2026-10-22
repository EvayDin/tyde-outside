# 准入考试配置与导入基础

> 2026-10-22现行规则：已开发考试接口改用当前PM或NAVIGATOR会话角色+项目/历史人工轮次资格，不读独立授权。MANUAL配置阅卷人必须ACTIVE，自带三角色，不要求独立授予；当前角色和实际阅卷提交资格须分别校验。05未新增040/048—052；回调仍专用HMAC。详见[统一账号与组织创建](UNIFIED_ACCOUNTS.md)。本轮证据见[插队任务](../../backend-migration/priority-unified-accounts/todoTask.md)。

2026-10-21第三批：新增编辑配置详情、管理页、关闭和花名册；逐轮成绩模型及第18迁移已准备。339单测为前批通过证据；用户2026-10-22复跑162项集成全过，第18所需专用库结构已验证、历史未另查，原缺表阻塞解除。当前保持05，下次从准入情况及阅卷继续；远程文档/XLS内嵌图片、准入情况及阅卷写链路仍待实现。逐接口状态和证据唯一维护在[05任务记录](../../backend-migration/05-exam-management/todoTask.md)。

## HTTP契约

所有入口均需有效会话。模板要求独立PM授权；导入、发布、编辑、关闭还须已发布项目的当前生效主策略官，招募协作负责人不能写。详情、管理页、花名册允许独立PM当前主策略官/协作负责人，或独立NAVIGATOR且在该项目任一未删除考试的历史MANUAL轮次中。NAV仅为需求方/创建人不等于管理页阅卷资格；历史版本和已关闭考试人工池仍参与只读判定。双授权先匹配PM项目关系，无匹配时可按NAV阅卷资格只读。注册/登录仍固定EXPERT，不读取客户端角色声明。Web使用Cookie并校验来源，桌面及普通API客户端使用Bearer，不混用。全部响应no-store。

| 方法与路径（统一加`/api/v1`）         | 参数与行为                                                                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /entrance-exams/import/template` | 必填query `type=EXCEL\|TXT\|REDOC`；返回XLSX、UTF-8制表文本、XML字节，无Result包装；文件名`entrance-exam-import-v1.xlsx/txt/xml`，无需projectId。   |
| `POST /entrance-exams/import/parse`   | multipart；必填projectId可用query或表单，同名冲突拒绝。file与非空redocUrl二选一。attachmentRefs为可选JSON数组part，每项name/objectKey/uploadToken。 |
| `GET /entrance-exams/reviewers`       | query projectId为32位正整数；keyword可选，按姓名/昵称/UID去空白后不分大小写包含匹配，不解释通配符。                                                 |
| `POST /entrance-exams/publish`        | JSON完整配置，不保存草稿；确认生产计划且needWrittenExam=true，ACTIVE数不超过maxActiveExamCount（原默认1）。发布V1。                                 |
| `PUT /entrance-exams/edit`            | JSON完整配置加examId和expectedCurrentVersionId；ACTIVE考试，预期版本一致才新增下一版本并原子切换。                                                  |
| `POST /entrance-exams/detail`         | JSON projectId/examId；仅ACTIVE考试，读取当前版本全部试卷/题目/轮次，不混入旧版。CLOSED返回400，当前版本异常500。                                   |
| `GET /entrance-exams/management`      | query projectId，返回未删除考试卡片、已交卷统计及生产计划上限下的操作按钮。                                                                         |
| `POST /entrance-exams/close`          | JSON projectId/examId，可选closeReason最多500字符；重复/并发关闭409。                                                                               |
| `POST /entrance-exams/roster`         | JSON projectId/examId，可选keyword/finalResult/current/size；读取真实应试和逐轮成绩，不创建任务。                                                   |

候选范围固定为项目需求方、当前策略官本人，保持顺序并去重，只返回ACTIVE账号，最多两项。`{userId,uid,name,avatarUrl}`不含手机号；userId为新库UUID，不能混用旧数值ID。name缺失时逐级回退，avatarUrl未设为null。保存MANUAL阅卷配置沿旧服务规则，允许配置状态有效且有独立NAVIGATOR或PM授权的其他用户，不限候选两人；保存为发布时的userId/uid/name快照。这不表示普通登录即可手动提交阅卷。

## 文件解析

支持XLS/XLSX与UTF-8 TXT：固定模板、简化表头别名、逐题文本、多卷、尾部题目分值/选必答标签、行内或独立参考答案；支持分钟/小时和上海截止日期（纯日期补23:59:59）。文字转义为HTML并以`<br/>`保留换行。题干和答案各需文字或附件至少一项。全部手动题分值且各卷合计相同时，合计覆盖导入满分；否则保留原配置满分，缺失为null，发布时再完整校验。未导入的裁决规则为null，gradingRounds为空数组，需补充后保存。

XLSX支持单元格锚定内嵌图片，绑定到实际题干/答案或对应附件列。先完成格式、图片类型与全部引用凭证预检，再预上传图片。XLS的空绘图容器不视为图片，实际OfficeArt图片/旧式对象明确400，提示另存为XLSX；不静默丢弃。外部图片关系、公式和合并单元格拒绝。远程文档服务未配置，redocUrl分支503且不访问输入URL；XML模板下载不等于远程读取能力。

边界：来源10MiB，TXT及累计题目文字100万字符；XLSX在读取前校验ZIP实际解压32MiB、1000条目及CRC；最多20卷×200题，单次100附件、每题每类20个，总附件50MiB。图片单个10MiB。源文件不入库。multipart请求总上限10MiB+256KiB，attachmentRefs字段128KiB；发布/编辑JSON体2MiB。

引用名去首尾空白后唯一，以`|`分隔；附件凭证须本人、ENTRANCE_EXAM_ATTACHMENT、UPLOADED且未过期，同一文件不重复引用。解析不消费token、不创建考试；返回的元数据来自台账。图片预上传失败时此前成功对象按原文件生命周期到期清理，不伪造业务保存成功。

## 发布与编辑事务

完整配置字段为projectId、examName、durationMinutes、registrationDeadline、fullScore、passScore、decisionRule、tieBreakRule、papers、gradingRounds；嵌套请求与完整示例见实际Swagger。时间为上海`yyyy-MM-dd HH:mm:ss`，截止须晚于当前时间，durationMinutes省略/null不限时。分值正数、最多两位小数、上限99999999.99；每卷分值合计必须等于满分，及格线不超满分。AUTO按全卷题数均分并向下取两位，末题承接尾差；MANUAL使用填写值，混合配置也必须精确合计。

轮次最多20：AUTO工具编码/名称必填，不能配阅卷人；MANUAL至少一名有效阅卷人且不能配工具。裁决默认MAJORITY，多数原则偶数轮必须STRICT（从严）或LENIENT（从宽）；MANUAL_PRIORITY至少一手动轮，其他场景平局规则保存null。工具配置递归拒绝secret/password/apikey/accesstoken/token（忽略大小写和下划线/横线），密钥只能放后端受信配置。AUTO本批仅保存非敏感配置/工具附件，不派发、不模拟阅卷。

项目行锁串行化发布和编辑，生产计划锁及ACTIVE上限校验防并发超限，同项目未删除考试名不重复（含已关闭考试）。名称按数据库精确匹配，大小写兼容待验收。重复发布不自动幂等，同名409或数量上限400。编辑校验当前版本，旧版本和已经进入的考生绑定不变；旧预期版本409。

考试、版本、试卷、题目、轮次、附件认领和管理主线待办同事务，失败全部回滚。新增文件用objectKey/uploadToken，编辑保留旧文件用objectKey/uploadedFileId（二者互斥），只允许同考试已认领文件。元数据不信任客户端，存储快照使用uploadedFileId/fileName/objectKey/extension/contentType/fileSize/fileHash，不持久化uploadToken。同版本不重复引用同一文件；旧版本附件不释放。

首次发布单向推进主节点到STANDARD_TRAINING，后续节点不回退；管理主线结算复用现有轮次，不投递实时事件。阅卷支线真值重算/刷新仍待后续阅卷来源，既有快照不会被空解析结果清掉。成功返回`{examId,examNo,projectId,examName,status,currentVersionId,versionNo,publishedAt}`，status固定ACTIVE。

文件API-011已接考试附件管理读取：CLAIMED台账绑定未删除考试/项目；独立PM当前主策略官/协作负责人，或独立NAVIGATOR项目需求方/创建人可读。上传者身份不能替代已认领后的业务授权；未认领仅本人预览。考生与已接单组织职责分支仍待07/08，未接分支403，不凭ACTIVE项目成员放行。

失败沿旧Result `{code:HTTP状态,message:中文原因,data:null}`：400参数/配置不合法或数量达上限；401未登录；403来源/角色/归属不符；404项目/考试不存在；409名称、版本、文件状态冲突；413大小/数量超限；503远程未接入或服务不可用。Swagger包含请求/响应、嵌套中文含义、默认/null/枚举及完整可校验示例。

## 详情、统计、关闭和花名册

详情按当前配置版本的试卷/题号/轮次序号升序返回。题目附件保持原快照字段`uploadedFileId/fileName/objectKey/extension/contentType/fileSize/fileHash`，不改名为保存请求中的size，不注入uploadToken。工具配置复制后拆出顶层files；剩余空对象返回null，非对象历史JSON原样保留。阅卷人仅在响应副本刷新当前显示名，UID/用户ID/未知字段及数据库快照不改。null/格式异常历史JSON保真，不能用空数组隐藏坏数据。

管理卡片按createdAt倒序、同时间按ID倒序，保留CLOSED卡片、排除deleted。examineeCount只计submittedAt非空记录，admittedCount只计其中finalResult=ADMITTED的考试通过记录；不代表已确认入项人数，也不按用户去重。通过率乘100并HALF_UP保留两位小数，无已交卷为0。缺计划时needWrittenExam=false、maxActiveExamCount=1；只有当前PM主策略官且需笔试/未满上限时canCreateExam=true。只读用户固定false，禁用原因沿旧“阅卷人仅可查看考试信息”。截止时间过期不自动关闭考试。

关闭与发布/编辑按项目→考试锁顺序串行化，关闭人/时间/原因及管理主线待办同事务；原因去首尾空白，省略/null/空白存null。并发两次关闭一方200、另一方409，重复409。关闭不删除/释放旧版本、试卷、题目、附件或应试，不回退项目节点、不发送实时事件，编辑详情和保存编辑随后400；管理页和花名册仍可只读。考生进入/交卷仍由08实现，本批不宣称该写流程可用。

花名册默认current=1、size=20，null等同省略；小于1按1，size超过100按100。参数须安全整数，分页偏移溢出返回400，超范围页返回空records并保留total/pages。按应试createdAt倒序、同时间ID倒序。keyword去首尾空白后按应试姓名/UID/组织名快照匹配，保留LIKE的%/_通配语义；展示名取实时用户昵称(姓名)，不改快照。finalResult省略/null不筛选，包含未进入/未交卷记录；非空只查已交卷。未交卷响应finalResult=null，已交卷PENDING=待最终阅卷、ADMITTED=考试通过、ELIMINATED=未通过。

roundScores只返回该应试实际存在的逐轮记录，按gradingRoundId升序，读取考生绑定的版本而非当前版本；无记录为空数组。分数0保留，未出分为null；每轮ADMITTED/ELIMINATED只代表该轮票，不累加成考试结果，也不在读取时重算finalResult。新表缺失会报错，不伪造空成绩。

配置里的NAV阅卷资格不扩大文件代理权限。文件API-011仍按独立PM当前主策略官/协作负责人或独立NAV需求方/创建人；其他配置阅卷人可能可读配置但无附件下载权限，沿旧文件服务边界保留。考生和已接单组织职责仍归07/08。

## 结构、验证和部署

第17迁移已提供配置版本/试卷/题目和考试/轮次/应试来源，所需专用库结构由前批156项全过证实，历史未另查。本批第18迁移`20261021040000_entrance_exam_grading_records`新增逐轮执行/汇总来源：attemptId+gradingRoundId唯一，examVersionId通过复合外键确保应试与轮次同一版本，未进入/未绑定版本不能挂成绩，reviewerUserId引用真实用户。限制状态WAITING/PENDING/PROCESSING/COMPLETED/FAILED、非负分值、轮次结果ADMITTED/ELIMINATED/null。只建结构，不生成阅卷任务或结论；答案/逐题结果/派发/回调后续接入。

第三批339项单测全过（29文件，2026-10-21 17:57:55，总12.51秒），服务端类型和变更ESLint通过。用户2026-10-22 09:16:49复跑162项集成全部通过（1文件，总78.84秒，测试68.19秒），第18迁移所需专用测试库结构、花名册真实逐轮成绩及来源约束已验证，原缺表阻塞解除；迁移历史未另查，开发/部署库仍未验证。第三批新增6项数据库验证已全部通过，包括实际旧版本成绩/筛选及来源唯一键/外键/分值约束。本次仅同步回传结果，未重跑测试或操作数据库；无新增依赖或锁变化。

其他尚未应用迁移的本机专用测试环境，由维护者在tyde执行（当前专用库已就绪，无需重复迁移）：

```sh
node scripts/migrate-test-database.mjs
pnpm test:integration
```

当前专用库第18所需结构已验证；Agent未应用迁移，迁移历史未另查。迁移脚本仅允许`.env.test`指定且允许清空的本机`_test`库，不读取开发连接，本身不清表；集成会清表。开发/部署库另外确认目标后按既有说明应用`pnpm db:deploy`，不要将测试指向开发库。迁移事务失败整批回滚，不清空来源或生成虚假版本。第18只新增空记录表和约束，不回填成绩。

162项全通过后，下一批从040准入情况及048—052阅卷继续。HMAC、时间/重放/结果幂等、失败重试补偿和阅卷支线须沿旧规则单独实现。完整ID/时间/JSON/排序/大小写/模板样式兼容及真实外部依赖验收仍保留。
