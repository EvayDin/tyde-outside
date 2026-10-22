# 已发布项目详情与成员关系基础

> 2026-10-22现行规则：当前NAVIGATOR创建人、当前PM主策略官/协作负责人、当前EXPERT且ACTIVE MEMBER分别选择对应范围，按当前角色隔离生产要求；不能用另一角色关系兜底。详见[统一账号与组织创建](UNIFIED_ACCOUNTS.md)。本轮证据见[插队任务](../../backend-migration/priority-unified-accounts/todoTask.md)。

API-035 `GET /api/v1/projects/{projectId}`已接入代码，projectId为32位正整数路径参数，无请求体。新增第13迁移`20261020010000_project_members`及成员表。当前274项单测通过；用户2026-10-20回传118项专用库集成全部通过（总51.06秒），第13所需结构及本批业务已验证，原数据库阻塞解除；迁移历史未另查，开发/部署及兼容验收仍待完成。接口仍为已实现待验收，不代表整个04或专家接单/入项已完成。

## 授权与响应

只读未删除PUBLISHED项目；不存在/草稿/删除404，非法ID400，无项目范围403，会话失效401。关联读取使用同一RepeatableRead快照，不创建成员、不修改项目、不生成轮次或事件。

合法范围按顺序解析：独立NAVIGATOR授权且本人创建；独立PM授权且当前ASSIGNED主策略官或招募协作负责人；实际ProjectMember中本人ACTIVE且projectRole=MEMBER。固定EXPERT登录角色、User.role、组织主管/管理员、上传者、客户端角色或他人ID均不能替代实际范围。当前任职更换、授权撤销或成员状态变化在下一请求生效。PRIMARY/协作关系保持原模型，策略官不写执行专家成员表。

旧接口依赖会话selectedRole，新后端按已确认的独立管理授权适配：管理范围优先于专家成员范围，NAVIGATOR创建人→PM当前任职→EXPERT成员；不增加角色选择字段。兼容验收仍待完成。具有多个真实关系的账号在管理授权撤销后，仍可依靠自己的有效ACTIVE MEMBER关系进入专家范围；撤销管理授权不等于移除专家成员。

详情复用草稿字段转换，返回基础信息、人员画像、标准正文/链接、分类名称快照和ACTIVE附件元数据。分类按级别、sortNo、id读取，三级顺序保留选择顺序，不随字典改名变化；个人需求方按当前昵称(姓名)回填，组织需求方保留名称快照。创建人名称实时回填，缺失依次回退需求方名称/创建人UID。时间为上海yyyy-MM-dd HH:mm:ss。不会返回上传凭证、签名URL、内部成员/会话/管理审计数据。

只有专家范围返回productionRequirements；管理范围完全省略该字段。量级要求包含hasPlan、planId、计划级人数/CPD、总预期产出和按sequenceNo升序的阶段。无计划时hasPlan=false、相关数值/ID为null、stages为空数组。沿旧ProjectQueryService实际行为，普通项目详情未加载人群，crowds固定null；接单详情的画像数组不能替换此契约。确认人、考试标志/数量、扩展JSON等管理字段不返回。Decimal落库精度与JSON极大数限制沿用[生产计划](PROJECT_PRODUCTION_PLANS.md)。

## 成员表与来源边界

ProjectMember保留旧成员历史、项目角色、状态、组织关系/组织快照、来源接单/准入ID、入离项日期、标准培训确认时间和审计字段。用户/组织/组织关系使用新库UUID，项目/成员/接单/准入ID使用数值。准入admissionAttemptId唯一，null允许多条，不添加projectId/userId唯一约束，保留不同入项轮次。项目/用户/组织/关系外键RESTRICT保留历史，15物理删除阶段需处理。

状态保留PENDING_CONFIRM待确认、PENDING_ENTRY待入项、ACTIVE在项、ENTRY_DECLINED放弃、PENDING_EXIT待离项、PENDING_TRANSFER转项、LEFT已离开、REMOVED已移除；角色MEMBER执行专家、PROJECT_MANAGER历史项目管理员。详情只有ACTIVE MEMBER可进入专家范围，不把待离项/项目管理员当成在项执行专家。迁移默认ACTIVE/MEMBER沿旧表，不创建成员、不同步组织或账号、不自动授予权限。

本批没有成员写HTTP/运维造数入口，也未实现入项、考试通过或免试接单写入；生产来源由07/08/10接入，在写入前核对用户/组织/组织关系一致、接单和准入真实归属。expertAssignmentId已在第14迁移接入接单来源外键，用户130项集成全部通过，admissionAttemptId仍只有标量来源及唯一约束，待08来源表落地补外键；不能据此认为接单/考试实现完毕。组织关系和项目成员不是自动同步关系：03项目数/projectId筛选已回补并通过122项集成，离组清退及积压补偿仍待后续，PENDING不算清退完成。

详情返回附件元数据不意味着专家可下载。旧文件权限SQL还要求ACCEPTED接单、笔试配置及ADMITTED准入，部分组织负责人/主管有对应规则；成员状态不足以替代这些数据。API-011当前仍仅接NAVIGATOR创建人和PM当前任职，专家/考试附件403待07/08等阶段接实，不在本批放宽权限。

## 迁移、验证与续做

第13迁移只新增成员表及索引、外键、枚举/正数约束；Prisma generate/validate、类型、ESLint/Prettier及diff检查通过。274项单测覆盖实际数据范围、管理优先级、字段裁剪、空计划、名称快照和完整Swagger示例/HTTP序列化；此前Agent118项集成因P1001停在初始化，未进入业务；用户随后回传2026-10-20 18:58:41运行118项全部通过（1文件，总51.06秒，测试40.55秒），含新增8项详情/成员基础用例，第13所需专用库结构及本批业务已验证，原数据库阻塞解除。本次Agent仅同步用户结果，未重跑、未应用迁移或查询迁移历史。开发/部署及真实OSS联调未执行，迁移历史未查询。

专用_test库已通过本批118项集成；以下保留迁移和复验命令，从tyde/执行：

```sh
cd apps/server
node --env-file=.env.test node_modules/prisma/build/index.js migrate deploy
cd ../..
pnpm test:integration
```

新增8项覆盖详情与名称快照、主策略官/协作负责人及撤销/更换、全部成员状态与角色范围、确认计划裁剪、多关系优先级、项目生命周期/ID/会话、专家附件边界、成员历史和准入来源唯一性。测试使用真实PostgreSQL和内存存储，生产成员写流程仍待后续阶段。

API-031/034列表读取与角色支线快照、阅卷及组织接单负责人来源基础已接入（部分迁移），见[项目列表](PROJECT_LISTS.md)。用户2026-10-21 11:04:49回传130项集成全部通过（总62.15秒），覆盖此前API-018计数/筛选及本批列表；第14所需专用库结构已就绪，迁移历史未另查。04基础已交接05，成员写流程、支线重算及03清退保留后续回补；本次仅同步验收与交接，未实现05。详细状态与证据唯一记录见[04任务](../../backend-migration/04-project-foundation/todoTask.md)。
