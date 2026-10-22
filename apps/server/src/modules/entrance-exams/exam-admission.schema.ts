import type { FastifySchema } from 'fastify';
import { resultSchema } from '../auth/auth.schema.js';
const id = (description: string) => ({
  type: 'integer',
  minimum: 1,
  maximum: 2147483647,
  description,
});
const text = (description: string, nullable = false) => ({
  type: 'string',
  description,
  ...(nullable ? { nullable: true } : {}),
});
const status = {
  type: 'string',
  enum: ['PENDING', 'PENDING_ENTRY', 'ADMITTED', 'ENTRY_DECLINED', 'ELIMINATED'],
  description:
    'PENDING=待阅卷，PENDING_ENTRY=考试通过待准入，ADMITTED=实际已入项，ENTRY_DECLINED=已放弃入项，ELIMINATED=考试淘汰；考试结果优先，之后拒绝优先于入项时间。',
};
export const examAdmissionExample = {
  current: 1,
  size: 20,
  total: 2,
  pages: 1,
  records: [
    {
      attemptId: 10001,
      examId: 5001,
      examName: '准入考试历史版本',
      candidateUserId: '00000000-0000-4000-8000-000000000001',
      candidateUid: 'candidate-uid',
      candidateName: '小明(王小明)',
      organizationId: null,
      organizationName: null,
      employmentType: null,
      examDate: '2026-10-22 10:00:00',
      admissionStatus: 'PENDING_ENTRY',
    },
    {
      attemptId: 10002,
      examId: 5001,
      examName: '准入考试历史版本',
      candidateUserId: '00000000-0000-4000-8000-000000000002',
      candidateUid: 'candidate-org-uid',
      candidateName: '小张',
      organizationId: '00000000-0000-4000-8000-000000000003',
      organizationName: '示例组织',
      employmentType: 'FULL_TIME',
      examDate: '2026-10-22 09:00:00',
      admissionStatus: 'ADMITTED',
    },
  ],
};
export const examAdmissionSchema: FastifySchema = {
  operationId: 'getEntranceExamAdmissions',
  summary: '分页查询项目准入情况',
  tags: ['EntranceExam'],
  description:
    'GET查询，无请求体。当前PM须为生效主策略官/招募协作负责人；NAVIGATOR须在该项目任一未删除考试的历史人工轮次阅卷池内；EXPERT须为组织主管（ACTIVE/EXIT_APPROVING/PENDING_LEAVE）或有效项目负责人，且组织在本项目有ACCEPTED接单，仅可查看这些组织的应试记录。负责人表有任意历史记录即不回退旧projectOwnerUserId。角色本身不授予项目数据权限；OPS不开放。只含未删除考试的已交卷记录，跨考试按交卷时间及ID倒序；含CLOSED考试，按应试绑定版本取考试名，无版本才回退当前考试名。搜索使用应试快照，展示姓名取实时资料；人员属性来自当时绑定的成员关系。筛选与分页在数据库完成，一致性只读事务，无副作用；重复查询不写结果或派发Agent。实际准入/入项写入口仍待后续任务。Web使用会话Cookie并校验来源，桌面使用Bearer。',
  security: [{ webSession: [] }, { desktopSession: [] }],
  querystring: {
    type: 'object',
    additionalProperties: false,
    description: '已发布项目准入记录分页条件；省略筛选表示全部授权范围。',
    required: ['projectId'],
    properties: {
      projectId: {
        type: 'string',
        pattern: '^[1-9][0-9]{0,9}$',
        description: '必填已发布项目ID，32位正整数。',
      },
      keyword: text(
        '可选姓名/平台UID/组织名关键词；去首尾空白后匹配应试快照，空白不筛选；保留LIKE的%/_通配语义，大小写完整兼容待验收。',
      ),
      admissionStatus: status,
      current: {
        type: 'string',
        pattern: '^[1-9][0-9]{0,15}$',
        description: '页码，从1开始；省略为1，须安全整数且分页偏移不能溢出安全整数。',
      },
      size: {
        type: 'string',
        pattern: '^([1-9]|[1-9][0-9]|100)$',
        description: '每页记录数，1至100；省略为20。',
      },
    },
    examples: [
      {
        projectId: '3001',
        keyword: '小明',
        admissionStatus: 'PENDING_ENTRY',
        current: '1',
        size: '20',
      },
    ],
  },
  response: {
    200: resultSchema({
      type: 'object',
      additionalProperties: false,
      description: '已交卷准入记录分页，不按用户去重；无记录时total/pages为0，records为空数组。',
      required: Object.keys(examAdmissionExample),
      properties: {
        current: { type: 'integer', minimum: 1, description: '本次页码。' },
        size: { type: 'integer', minimum: 1, maximum: 100, description: '本次每页数量。' },
        total: { type: 'integer', minimum: 0, description: '权限范围及筛选条件下的应试记录总数。' },
        pages: { type: 'integer', minimum: 0, description: '总页数，向上取整。' },
        records: {
          type: 'array',
          description: '交卷时间倒序，同时间ID倒序；超出总页数时空数组。',
          items: {
            type: 'object',
            additionalProperties: false,
            description: '一条已交卷记录；考试通过不等于实际已入项。',
            required: Object.keys(examAdmissionExample.records[0]!),
            properties: {
              attemptId: id('应试记录ID，用于阅卷详情。'),
              examId: id('考试ID。'),
              examName: text('应试绑定版本的考试名称，未绑定版本时回退考试当前名称。'),
              candidateUserId: { ...text('考生UUID，与旧数值ID不互通。'), format: 'uuid' },
              candidateUid: text('交卷记录中的平台UID快照。'),
              candidateName: text('当前昵称(真实姓名)，缺失时依次取昵称、真实姓名、当前UID。'),
              organizationId: { ...text('组织UUID；个人接单为null。', true), format: 'uuid' },
              organizationName: text('应试记录组织名快照；个人接单为null。', true),
              employmentType: {
                type: 'string',
                nullable: true,
                enum: ['FULL_TIME', 'PART_TIME', null],
                description:
                  '绑定组织成员关系的当前人员属性：FULL_TIME=全职，PART_TIME=兼职；个人或未设置为null。',
              },
              examDate: text('实际交卷时间，上海时区yyyy-MM-dd HH:mm:ss。'),
              admissionStatus: status,
            },
          },
        },
      },
      examples: [examAdmissionExample],
    }),
    ...Object.fromEntries(
      [400, 401, 403, 404, 500, 503].map((code) => [
        code,
        {
          ...resultSchema({ type: 'null', description: '失败时业务数据为null。' }),
          description: `${code}：${({ 400: '参数/分页不合法或项目未发布', 401: '未登录或会话失效', 403: '当前角色、项目任职、阅卷资格、组织接单管理范围或来源不符', 404: '项目不存在', 500: '服务器内部异常', 503: '服务依赖不可用' } as Record<number, string>)[code]}。`,
          examples: [{ code, message: '操作失败', data: null }],
        },
      ]),
    ),
  },
};
