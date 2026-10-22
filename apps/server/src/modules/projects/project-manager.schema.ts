import type { FastifySchema } from 'fastify';
import { resultSchema } from '../auth/auth.schema.js';
const userId = '00000000-0000-4000-8000-000000000002';
export const managerCandidatesQuery = {
  type: 'object',
  additionalProperties: false,
  required: ['projectId'],
  description: '策略官候选查询，无请求体；本人已发布项目，返回全部匹配，不分页。',
  properties: {
    projectId: {
      type: 'string',
      pattern: '^0*[1-9]\\d*$',
      description: '必填项目ID，URL查询值是十进制文本；新库32位正整数，服务端转换并校验范围。',
      examples: ['3001'],
    },
    keyword: {
      type: 'string',
      maxLength: 100,
      description:
        '可选姓名/昵称模糊词，最多100字符；trim后空白不筛选；LIKE的%/_保留通配语义，筛选同样作用于当前策略官。大小写兼容待验收。',
      examples: ['小明'],
    },
  },
  examples: [{ projectId: '3001' }, { projectId: '3001', keyword: '小明' }],
};
export const managerRecruitBody = {
  type: 'object',
  additionalProperties: false,
  required: ['projectId', 'candidateUserId'],
  description: '招募/更换策略官，直接指派，无需候选人确认。',
  properties: {
    projectId: {
      type: 'integer',
      minimum: 1,
      maximum: 2147483647,
      description: '必填项目ID，新库32位正整数；必须为本人创建的未删除PUBLISHED项目。',
      examples: [3001],
    },
    candidateUserId: {
      type: 'string',
      format: 'uuid',
      description:
        '必填候选用户ID，新库UUID字符串；须正常ACTIVE且有当前PM角色，不能再次选择该项目的当前策略官。User.role及客户端角色声明无效。',
      examples: [userId],
    },
  },
  examples: [{ projectId: 3001, candidateUserId: userId }],
};
export const managerCandidate = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'userId', 'uid', 'name', 'avatarUrl', 'currentProjectCount'],
  description: '策略官实际用户资料和全局ASSIGNED任职数量；不暴露信用分、手机号或管理授权维护字段。',
  properties: {
    status: {
      type: 'string',
      enum: ['CURRENT', 'RECOMMENDED'],
      description:
        '列表状态：CURRENT=当前生效策略官，匹配关键词时置顶；RECOMMENDED=正常且具有当前PM角色的可选候选。',
      examples: ['RECOMMENDED'],
    },
    userId: {
      type: 'string',
      format: 'uuid',
      description: '用户数据库主键，新库UUID，不能与旧数值ID混用。',
      examples: [userId],
    },
    uid: {
      type: 'string',
      description: '用户平台UID，不是数据库用户ID；沿用资料中的实际值。',
      examples: [userId],
    },
    name: {
      type: 'string',
      description: '展示昵称(姓名)，缺一项取另一项，全空回退UID。',
      examples: ['小明(王小明)'],
    },
    avatarUrl: {
      type: 'string',
      nullable: true,
      description: '头像地址；未设置为null。',
      examples: [null],
    },
    currentProjectCount: {
      type: 'integer',
      minimum: 0,
      description:
        '当前用户全平台ASSIGNED任职记录数；按旧SQL不额外过滤项目状态/删除标记，不是执行专家在项数。',
      examples: [0],
    },
  },
  examples: [
    {
      status: 'RECOMMENDED',
      userId,
      uid: userId,
      name: '小明(王小明)',
      avatarUrl: null,
      currentProjectCount: 0,
    },
  ],
};
export const managerCandidates = {
  type: 'array',
  description:
    '全部匹配策略官；当前匹配者置顶，其余按ASSIGNED数量升序、信用分降序（null末尾）、用户ID升序。无匹配返回空数组；UUID ID排序与旧数值ID兼容待验收。',
  items: managerCandidate,
  examples: [managerCandidate.examples, []],
};
export const managerRecruitResult = {
  type: 'object',
  additionalProperties: false,
  description: '实际任职及节点；首次分配推进生产计划，更换保留当前节点，不修改项目表单。',
  required: [
    'recruitmentId',
    'projectId',
    'recruitmentType',
    'assignmentMode',
    'status',
    'manager',
    'currentNodeCode',
    'nextStage',
    'primaryAction',
    'assignedAt',
  ],
  properties: {
    recruitmentId: {
      type: 'integer',
      minimum: 1,
      description: '本次新建招募记录的数值ID；旧记录保留为REPLACED。',
      examples: [5001],
    },
    projectId: managerRecruitBody.properties.projectId,
    recruitmentType: {
      type: 'string',
      enum: ['INITIAL', 'REPLACEMENT'],
      description: '招募类型：INITIAL=首次、REPLACEMENT=更换。',
      examples: ['INITIAL'],
    },
    assignmentMode: {
      type: 'string',
      enum: ['DIRECT'],
      description: '本接口方式固定DIRECT=直接指派；暂不提供REQUIRE_ACCEPTANCE接受流程。',
      examples: ['DIRECT'],
    },
    status: {
      type: 'string',
      enum: ['ASSIGNED'],
      description: '本次任职固定ASSIGNED=生效；更换时此前任职变REPLACED。',
      examples: ['ASSIGNED'],
    },
    manager: {
      ...managerCandidate,
      description: '本次生效策略官；status为CURRENT，任职数量含本次新记录。',
    },
    currentNodeCode: {
      type: 'string',
      nullable: true,
      enum: [
        'RECRUIT_PROJECT_MANAGER',
        'PRODUCTION_PLAN',
        'ENTRANCE_EXAM',
        'STANDARD_TRAINING',
        'RECRUIT_EXECUTION_EXPERT',
        'PERSONNEL_MANAGEMENT',
        'PRODUCTION_TASK',
        'COMPLETED',
        null,
      ],
      description:
        '共享节点：RECRUIT_PROJECT_MANAGER=招募策略官、PRODUCTION_PLAN=生产计划、ENTRANCE_EXAM=准入考试、STANDARD_TRAINING=标准培训、RECRUIT_EXECUTION_EXPERT=招募专家、PERSONNEL_MANAGEMENT=人员管理、PRODUCTION_TASK=生产任务、COMPLETED=结项。首次分配为生产计划，更换保持原值（历史为空则null）。',
      examples: ['PRODUCTION_PLAN'],
    },
    nextStage: {
      type: 'string',
      nullable: true,
      description:
        '沿旧接口返回当前共享节点编码，含义同currentNodeCode；历史空节点为null，不额外推进。',
      examples: ['PRODUCTION_PLAN'],
    },
    primaryAction: {
      type: 'string',
      enum: ['CHANGE_PROJECT_MANAGER'],
      description: '后续主操作固定CHANGE_PROJECT_MANAGER=更换策略官。',
      examples: ['CHANGE_PROJECT_MANAGER'],
    },
    assignedAt: {
      type: 'string',
      description: '本次任职生效时间，上海yyyy-MM-dd HH:mm:ss，无时区后缀。',
      examples: ['2026-10-19 19:00:00'],
    },
  },
  examples: [
    {
      recruitmentId: 5001,
      projectId: 3001,
      recruitmentType: 'INITIAL',
      assignmentMode: 'DIRECT',
      status: 'ASSIGNED',
      manager: { ...managerCandidate.examples[0], status: 'CURRENT', currentProjectCount: 1 },
      currentNodeCode: 'PRODUCTION_PLAN',
      nextStage: 'PRODUCTION_PLAN',
      primaryAction: 'CHANGE_PROJECT_MANAGER',
      assignedAt: '2026-10-19 19:00:00',
    },
  ],
};
export function projectManagerSchema(
  operationId: string,
  summary: string,
  response: Record<string, unknown>,
): FastifySchema {
  const errors = {
    400: '参数/项目状态不合法、候选已失效或已是当前策略官。',
    401: '未登录或会话失效。',
    403: '缺当前NAVIGATOR角色、非创建人或会话传输不可信。',
    404: '项目不存在或已逻辑删除。',
    409: '任职唯一或首次节点推进发生并发冲突。',
    500: '内部处理失败。',
    503: '数据库/服务不可用。',
  };
  return {
    operationId,
    summary,
    tags: ['Project'],
    security: [{ webSession: [] }, { desktopSession: [] }],
    description:
      '须当前NAVIGATOR角色及本人创建的已发布项目；注册自带三角色，登录默认EXPERT，不从User.role或客户端角色授予管理权限。Web会话Cookie与写请求来源校验，普通API/桌面Bearer，禁止混用。候选须ACTIVE且当前PM角色；当前匹配者仍按旧SQL展示，不因其授权/状态变化静默消失。信用分是数据库旧字段默认100，本批不提供修改入口。' +
      (operationId === 'getProjectManagerCandidates'
        ? '无请求体、只读。按名称/昵称筛选，当前置顶，其余按负载/信用分/ID排序。'
        : '直接指派，锁项目；旧任职替换、新任职生效、首次节点条件更新、管理主线任务轮次及PENDING事件同事务，任一失败全部回滚。再次选择当前策略官返回400，不是幂等成功；不同候选并发按项目锁串行替换。策略官不写执行成员表。当前任务真值只覆盖管理主线；支线/专家受众及真实投递待后续接入，PENDING不代表已通知。'),
    response: {
      200: resultSchema(response),
      ...Object.fromEntries(
        Object.entries(errors).map(([status, message]) => [
          status,
          {
            ...resultSchema({ type: 'null', description: '失败无业务数据，固定null。' }),
            description: message,
            examples: [{ code: Number(status), message, data: null }],
          },
        ]),
      ),
    },
  };
}
