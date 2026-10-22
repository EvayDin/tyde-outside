# 管理角色与项目权限

2026-10-22起，注册自带NAVIGATOR、PM、EXPERT，直接使用对应业务；当前规则与完整接口影响见[统一账号](UNIFIED_ACCOUNTS.md)。此规则替代此前独立管理授权方案。

管理入口通过有效会话的Session.selectedRole判断当前视角，继续校验项目创建人、生效策略官、协作负责人或人工阅卷配置等实际关系。拥有三角色不允许查看或修改其他人的项目，也不等于组织管理权限；组织权限仍取指定组织下UserOrgRel。客户端请求头、User.role及资料展示字段均不能代替鉴权。

ManagementGrant/ManagementGrantAudit结构及旧迁移保留，运行时三角色授权已不再读取它们。management:grants命令停止支持授予/撤销，返回409，不应继续执行旧操作指南。OPS仍未开放，后续运营功能须独立设计和确认。

分类字典仍由受信运维维护，categoryLevel为1—3、status为ENABLED/DISABLED；不新增字典写HTTP。分类查询须当前NAVIGATOR。需求方回填保持本人ID限制，统一账号只支持INDIVIDUAL本人需求方，组织选择未开放返回400；组织成员关系不会自动改写本人需求方类型。草稿/发布仍按已核对旧Service保持登录+本人范围。

第19迁移及环境步骤见[统一账号部署说明](UNIFIED_ACCOUNTS.md#数据库验证及部署)。此前04专用库授权测试是旧策略的历史证据；本次数据库集成未完成，不代表新策略已通过数据库或真实环境验收。
