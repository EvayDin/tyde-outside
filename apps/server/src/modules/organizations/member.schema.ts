import { orgIdField } from './organization.schema.js';
const orgId = orgIdField.examples[0];
const memberId = '00000000-0000-4000-8000-000000000003';
const userId = '00000000-0000-4000-8000-000000000001';
const text = (description: string, example: string | null, nullable = false) => ({
  type: 'string',
  description,
  examples: [example],
  ...(nullable ? { nullable: true } : {}),
});
const enumeration = (description: string, values: string[], nullable = false) => ({
  ...text(description, values[0]!, nullable),
  enum: nullable ? [...values, null] : values,
});
const number = (description: string, example: number, minimum = 0) => ({
  type: 'integer',
  minimum,
  description,
  examples: [example],
});
const role = enumeration('组织角色：OWNER=主管、ADMIN=管理员、MEMBER=成员。', [
  'OWNER',
  'ADMIN',
  'MEMBER',
]);
const employment = enumeration(
  '人员属性：FULL_TIME=全职、PART_TIME=兼职；可选，null表示未设置或更新时保持原值。',
  ['FULL_TIME', 'PART_TIME'],
  true,
);
const joinStatus = enumeration(
  '成员状态：PENDING=待审核、PENDING_ACTIVATION=待激活、ACTIVE=在组、EXIT_APPROVING=退出审批中、PENDING_LEAVE=待离职、LEFT=已离开、REMOVED=已移除。',
  ['PENDING', 'PENDING_ACTIVATION', 'ACTIVE', 'EXIT_APPROVING', 'PENDING_LEAVE', 'LEFT', 'REMOVED'],
  true,
);
const memberIdField = {
  ...text('用户组织关系ID（不是用户ID），必填；新项目为UUID字符串。', memberId),
  format: 'uuid',
};
const version = {
  ...number('成员关系版本号，非负整数；编辑须取最新列表值，更新/角色实际变更后递增；冲突409。', 0),
  maximum: 2147483646,
};
const outputTime = (description: string) =>
  text(`${description}；ISO 8601 UTC，未记录为null。`, '2026-10-19T00:00:00.000Z', true);
const date = (description: string) => ({
  ...text(
    `${description}；可选，格式yyyy-MM-dd，按Asia/Shanghai自然日过滤，null不筛选；起止均包含当天，起点不得晚于终点。`,
    '2026-10-19',
    true,
  ),
  pattern: '^\\d{4}-\\d{2}-\\d{2}$',
});
export const memberQueryBody = {
  type: 'object',
  description: '组织人员分页筛选；无请求筛选默认返回所有关系状态，遵循旧SQL实际行为。',
  additionalProperties: false,
  required: ['orgId'],
  properties: {
    orgId: orgIdField,
    keyword: {
      ...text(
        '可选，trim后模糊匹配真实姓名/UID，手机号必须完整11位精确匹配；不按昵称匹配，空白/null不筛选。SQL包含匹配保留%和_通配含义；数据库排序规则兼容待验收。',
        '张三',
        true,
      ),
      maxLength: 100,
    },
    joinedStartDate: date('入组日期起点'),
    joinedEndDate: date('入组日期终点'),
    leftStartDate: date('实际离职日期起点'),
    leftEndDate: date('实际离职日期终点'),
    employmentType: employment,
    position: {
      ...role,
      nullable: true,
      enum: [...role.enum, null],
      description: `${role.description}可选，null不筛选。`,
    },
    joinStatus,
    projectId: {
      type: 'integer',
      nullable: true,
      minimum: -2147483648,
      maximum: 2147483647,
      description:
        '可选项目ID，JSON整数，沿已迁移Project模型使用32位数值ID而非UUID；省略/null不筛选。按本组织每条userOrgRelId下status=ACTIVE的项目成员记录精确筛选，0或负数沿旧SQL返回无匹配；不要求项目未删除/已发布，不按项目角色过滤。超出新库32位范围400；旧64位ID兼容待验收。',
      examples: [3001, null],
    },
    current: { ...number('页码，从1开始；省略默认为1。', 1, 1), maximum: 2147483647 },
    size: { ...number('每页条数，1—100；省略默认为20。', 20, 1), maximum: 100 },
  },
  examples: [
    {
      orgId,
      current: 1,
      size: 20,
      keyword: '张三',
      joinedStartDate: '2026-01-01',
      joinedEndDate: '2026-10-19',
      employmentType: 'FULL_TIME',
      position: 'MEMBER',
      joinStatus: 'ACTIVE',
    },
    { orgId, projectId: 3001, current: 1, size: 20 },
    { orgId, projectId: null },
  ],
};
export const memberUpdateBody = {
  type: 'object',
  description: '编辑成员；joinedAt和employmentType至少一个非null；其他字段不允许修改。',
  additionalProperties: false,
  required: ['orgId', 'memberId', 'versionNo'],
  properties: {
    orgId: orgIdField,
    memberId: memberIdField,
    versionNo: version,
    joinedAt: {
      ...text(
        '可选入组时间，旧格式yyyy-MM-dd HH:mm:ss，按Asia/Shanghai解释；不得晚于当前时间，不传/null保持。响应采用ISO UTC。',
        '2026-10-01 09:00:00',
        true,
      ),
      pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$',
    },
    employmentType: employment,
  },
  examples: [
    { orgId, memberId, versionNo: 0, joinedAt: '2026-10-01 09:00:00', employmentType: 'FULL_TIME' },
  ],
};
export const memberPositionBody = {
  type: 'object',
  description: '变更目标成员角色，无版本请求字段；组织行锁下校验实时身份及管理员总数。',
  additionalProperties: false,
  required: ['orgId', 'memberId', 'position'],
  properties: { orgId: orgIdField, memberId: memberIdField, position: role },
  examples: [
    { orgId, memberId, position: 'ADMIN' },
    { orgId, memberId, position: 'OWNER' },
  ],
};
const memberProperties = {
  memberId: memberIdField,
  userId: { ...text('平台用户ID，新项目UUID。', userId), format: 'uuid' },
  uid: text('用户公开业务UID。', '00000000000040008000000000000001'),
  realName: text('真实姓名；未设置为null。', '张三', true),
  nickname: text('用户昵称；展示字段，不用于本接口关键字匹配。', '小张', true),
  phoneMasked: text('脱敏中国大陆手机号，仅前三位/后四位可见，不返回完整号码。', '138****5678'),
  avatarUrl: text('头像地址或objectKey；未设置为null。', null, true),
  userStatus: enumeration('账号状态：ACTIVE=正常、FROZEN=冻结、BANNED=封禁。', [
    'ACTIVE',
    'FROZEN',
    'BANNED',
  ]),
  employmentType: employment,
  position: role,
  joinStatus,
  joinedAt: outputTime('实际入组时间'),
  plannedLeaveDate: text('拟离职日期，yyyy-MM-dd；未确定为null。', null, true),
  leftAt: outputTime('实际离职时间'),
  activeProjectCount: {
    type: 'integer',
    minimum: 0,
    description:
      '本条组织成员关系userOrgRelId关联的ACTIVE项目成员记录数，未关联返回0；COUNT(*)不按项目去重，不过滤项目角色/项目状态/删除。统计不受请求projectId影响，不汇总同用户其他组织或个人项目；不是未知占位值。',
    examples: [0, 2],
  },
  versionNo: version,
};
const memberExample = {
  memberId,
  userId,
  uid: '00000000000040008000000000000001',
  realName: '张三',
  nickname: '小张',
  phoneMasked: '138****5678',
  avatarUrl: null,
  userStatus: 'ACTIVE',
  employmentType: 'FULL_TIME',
  position: 'MEMBER',
  joinStatus: 'ACTIVE',
  joinedAt: '2026-10-19T00:00:00.000Z',
  plannedLeaveDate: null,
  leftAt: null,
  activeProjectCount: 0,
  versionNo: 0,
};
export const memberListResponse = {
  type: 'object',
  description:
    '成员分页结果；未传状态按旧SQL包含所有状态，LEFT/REMOVED可显式筛选。项目筛选与在项数按真实组织关系关联记录统计。',
  additionalProperties: false,
  required: ['total', 'pages', 'current', 'size', 'records'],
  properties: {
    total: number('符合筛选条件的关系总数。', 1),
    pages: number('总页数，向上取整；无结果为0。', 1),
    current: number('当前页码，从1开始。', 1, 1),
    size: number('本页容量，默认20，最大100。', 20, 1),
    records: {
      type: 'array',
      description: '当前页记录；无匹配或超出页数为空数组。',
      items: {
        type: 'object',
        description: '单个组织成员，手机号脱敏；项目数为真实ACTIVE关联记录数。',
        additionalProperties: false,
        required: Object.keys(memberProperties),
        properties: memberProperties,
      },
    },
  },
  examples: [{ total: 1, pages: 1, current: 1, size: 20, records: [memberExample] }],
};
export const memberUpdateResponse = {
  type: 'object',
  description: '编辑成功后的持久化成员字段与新版本号。',
  additionalProperties: false,
  required: ['memberId', 'userId', 'joinedAt', 'employmentType', 'versionNo', 'updatedAt'],
  properties: {
    memberId: memberIdField,
    userId: memberProperties.userId,
    joinedAt: memberProperties.joinedAt,
    employmentType: employment,
    versionNo: version,
    updatedAt: text('本次更新时间；ISO 8601 UTC。', '2026-10-19T01:00:00.000Z'),
  },
  examples: [
    {
      memberId,
      userId,
      joinedAt: '2026-10-01T01:00:00.000Z',
      employmentType: 'FULL_TIME',
      versionNo: 1,
      updatedAt: '2026-10-19T01:00:00.000Z',
    },
  ],
};
export const memberPositionResponse = {
  type: 'object',
  description: '目标成员角色变更；主管转让时旧主管变ADMIN不重复返回，需刷新列表。',
  additionalProperties: false,
  required: ['memberId', 'beforePosition', 'position', 'updatedAt'],
  properties: {
    memberId: memberIdField,
    beforePosition: {
      ...role,
      description: '变更前组织角色：OWNER=主管、ADMIN=管理员、MEMBER=成员。',
    },
    position: role,
    updatedAt: text(
      '角色最后更新时间；ISO 8601 UTC。同角色幂等请求保留原更新时间/版本。',
      '2026-10-19T01:00:00.000Z',
    ),
  },
  examples: [
    {
      memberId,
      beforePosition: 'MEMBER',
      position: 'ADMIN',
      updatedAt: '2026-10-19T01:00:00.000Z',
    },
  ],
};
