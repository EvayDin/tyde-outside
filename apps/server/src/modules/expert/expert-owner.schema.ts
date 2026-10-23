export const ownerChangeBody = {
  type: 'object',
  additionalProperties: false,
  description:
    '完整替换组织平级项目负责人集合。仅已接单组织有效主管可操作；单值和非空集合必须二选一，集合去重后1至20人。成员须仍在组且账号正常，允许主管本人。',
  required: ['assignmentId'],
  properties: {
    assignmentId: {
      type: 'integer',
      minimum: 1,
      maximum: 2147483647,
      description: '必填，已接单组织的分配记录ID，32位正整数。',
    },
    projectOwnerUserId: {
      type: 'string',
      format: 'uuid',
      nullable: true,
      description: '兼容单负责人用户ID；使用非空集合时省略或null。',
    },
    projectOwnerUserIds: {
      type: 'array',
      nullable: true,
      description:
        '完整目标负责人用户ID集合；去重后最多20人，至少1人。空数组/null视为未提供，此时须提供单值。相同集合不重复初始化成员或发布事件。',
      items: {
        type: 'string',
        format: 'uuid',
        description: '该组织有效成员用户ID，UUID；不能为null。',
      },
    },
  },
  examples: [
    {
      assignmentId: 1,
      projectOwnerUserIds: [
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
      ],
    },
    { assignmentId: 1, projectOwnerUserId: '00000000-0000-4000-8000-000000000001' },
  ],
};
export const ownerChangeResponse = {
  type: 'null',
  description:
    '成功无业务返回值，data为null；新增负责人恢复SELECTED参与，免试创建PENDING_CONFIRM成员。移除仅撤销负责人身份，既有考试/成员/参与记录保留。不推进项目节点或版本。',
  examples: [null],
};
