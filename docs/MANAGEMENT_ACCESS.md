# 管理授权与项目基础接口

2026-10-19已确认：管理接口纳入本后端，管理授权独立维护，注册/登录身份仍固定EXPERT。当前实现NAVIGATOR（领航员）和PM（策略官）授权基础，并接入策略官候选/招募代码（102项专用库集成已通过），不包含管理端UI、HTTP授权管理或OPS授权。

## 身份与权限

认证仍返回`role=EXPERT`、`roles=[EXPERT]`，不改变注册、登录、当前用户资料或前端契约。`User.role`及客户端提交的角色、请求头均不能授予管理权限。管理接口先验证现有会话，再查询`ManagementGrant`中的有效授权及用户ACTIVE状态；不把管理角色写入令牌或缓存。撤销后，旧会话的下一次请求失去对应权限；已经开始并完成授权检查的请求不追溯取消。

`ManagementGrant`按用户和角色唯一，撤销保留记录，再次授予更新该记录。`ManagementGrantAudit`追加记录每次实际授予/撤销的操作人、原因和时间；重复执行同一状态不产生重复审计。维护事务锁定用户行，授权及审计一起提交，审计失败整体回滚。不提供用户自助授权接口，不根据组织主管身份自动授予NAVIGATOR/PM；项目归属、有效任职和成员权限仍须由后续业务服务另行检查。

## 迁移与授权维护

新增第8个迁移`20261019050000_project_foundation_access`创建`ManagementGrant`、`ManagementGrantAudit`、`ProjectCategory`。不自动授权任何账号，不读取旧数据库，不预置未经确认的分类字典。开发/部署库与专用测试库分别迁移，不能互换连接配置。

以下命令从`tyde/`执行。先在专用测试库应用迁移：

```sh
cd apps/server
node --env-file=.env.test node_modules/prisma/build/index.js migrate deploy
cd ../..
pnpm test:integration
```

开发库部署迁移使用`pnpm db:deploy`（读取开发`.env`）；部署库使用对应环境配置。此前Agent迁移CLI报P1001、集成初始化缺ProjectCategory表；用户现回传2026-10-19 17:25:16运行80项集成全部通过（总29.88秒），专用库结构已就绪，缺表阻塞解除。结果来自用户本机，本次Agent未重跑或另查迁移历史；开发/部署库迁移应用及环境联调尚未确认。逐批验证以[04任务记录](../../backend-migration/04-project-foundation/todoTask.md)为准。

仅持有目标库运维权限的操作人在核对环境及目标UID后执行授权维护。UID指`User.uid`，不是手机号；不需要修改用户资料或重发会话。命令读取`apps/server/.env`，下列占位UID必须替换；`actor`是审计操作人标签，不是用于获取权限的凭据，访问控制边界是数据库运维权限。

```sh
pnpm --filter @tyde/server management:grants --uid '<目标用户UID>' --role NAVIGATOR --action GRANT --actor '<操作人>' --reason '经批准维护项目'
pnpm --filter @tyde/server management:grants --uid '<目标用户UID>' --role NAVIGATOR --action REVOKE --actor '<操作人>' --reason '撤销项目管理职责'
```

`--role`允许NAVIGATOR或PM，`--action`允许GRANT或REVOKE，五个参数均必填。仅ACTIVE用户可被授予，停用账号仍可撤销；空白操作人/原因及超长参数被拒绝。账号不存在返回失败，命令失败以非零状态退出。部署包对应入口为`dist/management-grants.js`，通过目标环境文件设置配置后传入相同参数。尚未在实际账号上执行过授权命令。

授权审计和授权记录以外键RESTRICT保护用户历史，15阶段用户物理删除须制定审计保留策略，不能直接删除用户或将审计改为级联清空。

## 当前项目基础接口

- `GET /api/v1/project-categories`：仅NAVIGATOR。可选`categoryLevel=1|2|3`，各级独立；可选`keyword`去首尾空白后匹配名称、编码及搜索别名；仅返回ENABLED，按级别、sortNo、id升序。无匹配或未维护字典返回真实空数组。沿用SQL LIKE中`%`/`_`的通配语义，PostgreSQL与旧MySQL的大小写排序差异待兼容验收。
- `GET /api/v1/project-requesters/{requesterType}/{requesterId}/backfill`：仅NAVIGATOR，requesterId必须为当前用户ID，requesterType必须与账号类型一致。个人返回昵称(姓名)，缺一项时取另一项，orgId/orgVerifyStatus为null。组织读取有效成员关系（ACTIVE/EXIT_APPROVING/PENDING_LEAVE，组织未删除），按OWNER优先、最早入组（null排后）、关系ID升序选取，与现有用户资料一致；缺组织信息返回400，不自动创建组织。

两接口使用既有Cookie/Bearer传输规则和`code/message/data`包装；保持路径、方法、字段名及中文Swagger。用户/组织ID继续使用新库UUID，分类ID为新库正整数；旧数值用户/组织ID未转换，新旧标识不互通。无请求体，无写入副作用。

分类字典由受信运维根据批准的业务字典维护，当前没有编辑HTTP入口。`ProjectCategory`需要唯一categoryCode及同级唯一categoryName、categoryLevel为1—3、status为ENABLED/DISABLED，并填写createdBy、updatedBy和updatedAt；迁移不会复制旧库分类内容。后续草稿/发布将复用此字典和本人需求方解析规则。

项目主表、分类快照、附件及草稿/发布现已实现，用户回传2026-10-19 18:18:48运行92项集成全部通过（总36.64秒），第9/10专用库结构已就绪，附件认领类型修复验证通过，迁移历史未另查，开发/部署及兼容仍待验收；草稿/发布按旧代码实际仅登录及本人范围，不新增NAVIGATOR门槛。策略官任职、管理主线任务轮次/outbox已写入本批代码，102项专用库集成已通过，开发/部署及兼容验收仍待完成；生产计划已接入本批代码（独立PM及当前任职范围，主策略官确认、协作负责人只读），用户2026-10-20回传110项专用库集成全部通过，第12所需结构已就绪，迁移历史未另查，见[生产计划](PROJECT_PRODUCTION_PLANS.md)；项目详情及成员表基础已接代码，管理范围按独立授权+实际关系并优先于ACTIVE MEMBER专家范围，用户2026-10-20回传118项专用库集成全部通过，第13所需结构已就绪，迁移历史未另查，见[项目详情](PROJECT_DETAILS.md)；API-018项目计数/筛选已回补代码，用户2026-10-21回传122项集成全部通过；成员写流程、支线采集、投递及03离组清退仍未实现。见[策略官与任务基础](PROJECT_MANAGERS.md)。详见[项目草稿与发布](PROJECT_CREATION.md)，API-031/034读取已接后续本批，独立NAV/PM及本人实际范围，用户2026-10-21回传130项集成全部通过，第14所需结构已就绪、迁移历史未另查（部分迁移），见[项目列表](PROJECT_LISTS.md)。04基础已交接05，接口部分迁移及后续回补状态保持；来源写流程/重算/清退按后续阶段接实。
