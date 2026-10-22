import type { FastifySchema } from 'fastify';
import { resultSchema } from '../auth/auth.schema.js';
const id = (description: string, nullable = false) => ({
  type: 'integer',
  minimum: 1,
  maximum: 2147483647,
  description,
  ...(nullable ? { nullable: true } : {}),
});
const text = (description: string, nullable = false) => ({
  type: 'string',
  description,
  ...(nullable ? { nullable: true } : {}),
});
const decimal = (description: string, nullable = false) => ({
  type: 'number',
  description,
  ...(nullable ? { nullable: true } : {}),
});
const examStatus = {
  type: 'string',
  enum: ['ACTIVE', 'CLOSED'],
  description: 'ACTIVE=进行中、CLOSED=已关闭；关闭不会删除已进入考生的版本及试卷。',
};
const uuid = '00000000-0000-4000-8000-000000000001';
const fileSnapshot = {
  type: 'object',
  additionalProperties: true,
  description:
    '可信文件快照；保留未知历史字段，不包含本次上传凭证；与保存请求中的size字段不同，存储快照沿用fileSize。',
  properties: {
    uploadedFileId: { ...text('文件台账UUID；旧数据格式异常时保留原始JSON。'), format: 'uuid' },
    fileName: text('文件名快照。'),
    objectKey: text('文件对象Key，不是公开URL，下载使用登录文件代理。'),
    extension: text('文件扩展名，不含点。'),
    contentType: text('MIME类型。'),
    fileSize: { type: 'integer', minimum: 0, description: '文件大小，单位字节。' },
    fileHash: text('SHA-256，历史缺失可为null。', true),
  },
};
const reviewerSnapshot = {
  type: 'object',
  additionalProperties: true,
  description: '手动阅卷人快照；仅在响应副本刷新name，不修改用户ID、UID、未知字段或数据库快照。',
  properties: {
    userId: { ...text('阅卷人用户UUID；格式异常或用户不存在时原快照保留。'), format: 'uuid' },
    uid: text('发布时UID快照。'),
    name: text('用户存在时刷新为当前昵称(真实姓名)，缺失回退到旧快照名/UID。'),
  },
};
function snapshots(description: string, items: Record<string, unknown>) {
  return {
    description,
    anyOf: [
      { type: 'array', description: '正常快照数组；无配置一般为null，历史空数组原样保留。', items },
      { description: 'null或格式异常的历史JSON保留原值，不自动转换为空数组或丢弃未知字段。' },
    ],
  };
}
const files = snapshots(
  '附件快照，未配置为null；保留历史JSON。文件实际读取仍须业务授权，字段不等于公开可读。',
  fileSnapshot,
);
export { files as examFileSnapshots };
const reviewers = snapshots(
  '人工阅卷人快照数组；未配置为null，用户不存在/ID异常保留历史值。',
  reviewerSnapshot,
);
const question = {
  type: 'object',
  additionalProperties: false,
  description: '当前版本一道题目及原始附件快照。',
  required: [
    'questionId',
    'sequenceNo',
    'questionContent',
    'questionFiles',
    'requiredFlag',
    'score',
    'scoreSource',
    'referenceAnswer',
    'referenceFiles',
  ],
  properties: {
    questionId: id('题目ID。'),
    sequenceNo: id('卷内题目序号，从1开始。'),
    questionContent: text('题干富文本；仅附件题为null。', true),
    questionFiles: files,
    requiredFlag: { type: 'boolean', description: 'true=必答，false=选答。' },
    score: decimal('本题最终分值，最多两位小数。'),
    scoreSource: {
      type: 'string',
      enum: ['AUTO', 'MANUAL'],
      description: 'AUTO=系统均分，MANUAL=用户手动分值。',
    },
    referenceAnswer: text('参考答案富文本；未配置为null。', true),
    referenceFiles: files,
  },
};
const paper = {
  type: 'object',
  additionalProperties: false,
  description: '当前版本试卷，按sequenceNo升序。',
  required: ['paperId', 'sequenceNo', 'paperName', 'totalScore', 'questions'],
  properties: {
    paperId: id('试卷ID。'),
    sequenceNo: id('版本内试卷序号，从1开始。'),
    paperName: text('试卷名称，未配置为null，可展示为试卷N。', true),
    totalScore: decimal('本卷满分，最多两位小数。'),
    questions: {
      type: 'array',
      description: '本卷题目，按sequenceNo升序，无记录时为空。',
      items: question,
    },
  },
};
const round = {
  type: 'object',
  additionalProperties: false,
  description: '当前配置版本的判卷轮次，不包含考生判卷结果。',
  required: [
    'gradingRoundId',
    'roundNo',
    'gradingMode',
    'toolCode',
    'toolName',
    'toolConfig',
    'toolFiles',
    'reviewers',
  ],
  properties: {
    gradingRoundId: id('判卷轮次ID。'),
    roundNo: id('版本内轮次序号，从1开始。'),
    gradingMode: {
      type: 'string',
      enum: ['AUTO', 'MANUAL'],
      description: 'AUTO=自动工具轮次、MANUAL=人工轮次。',
    },
    toolCode: text('工具编码；人工轮次为null。', true),
    toolName: text('工具名称；人工轮次为null。', true),
    toolConfig: {
      description:
        '非文件工具配置JSON；复制后移除顶层files字段，空对象返回null；非对象历史JSON保留原值。',
    },
    toolFiles: files,
    reviewers,
  },
};
export const examDetailExample = {
  projectId: 3001,
  examId: 5001,
  examNo: 'EX20261021000000ABCDEFGH',
  status: 'ACTIVE',
  currentVersionId: 6001,
  versionNo: 1,
  examName: '准入考试',
  durationMinutes: null,
  registrationDeadline: '2099-01-01 23:59:59',
  fullScore: 20,
  passScore: 12,
  decisionRule: 'MAJORITY',
  tieBreakRule: null,
  papers: [
    {
      paperId: 7001,
      sequenceNo: 1,
      paperName: null,
      totalScore: 20,
      questions: [
        {
          questionId: 8001,
          sequenceNo: 1,
          questionContent: '题干',
          questionFiles: [
            {
              uploadedFileId: uuid,
              fileName: '说明.txt',
              objectKey: 'entrance-exam-attachment/example.txt',
              extension: 'txt',
              contentType: 'text/plain',
              fileSize: 20,
              fileHash: null,
            },
          ],
          requiredFlag: true,
          score: 20,
          scoreSource: 'MANUAL',
          referenceAnswer: '答案',
          referenceFiles: null,
        },
      ],
    },
  ],
  gradingRounds: [
    {
      gradingRoundId: 9001,
      roundNo: 1,
      gradingMode: 'MANUAL',
      toolCode: null,
      toolName: null,
      toolConfig: null,
      toolFiles: null,
      reviewers: [{ userId: uuid, uid: 'reviewer-uid', name: '小明(王小明)' }],
    },
  ],
};
export const examDetailResult = {
  type: 'object',
  additionalProperties: false,
  description: '考试当前生效配置，仅ACTIVE考试允许编辑页回显。',
  required: Object.keys(examDetailExample),
  properties: {
    projectId: id('所属项目ID。'),
    examId: id('考试ID。'),
    examNo: text('考试编号。'),
    status: { ...examStatus, enum: ['ACTIVE'] },
    currentVersionId: id('当前生效配置版本ID，保存编辑时传expectedCurrentVersionId。'),
    versionNo: id('版本号，从1开始。'),
    examName: text('考试当前名称。'),
    durationMinutes: { ...id('时限，单位分钟；null表示不限时。'), nullable: true },
    registrationDeadline: text('报名/首次进入截止时间，上海yyyy-MM-dd HH:mm:ss。'),
    fullScore: decimal('统一满分。'),
    passScore: decimal('考试及格线。'),
    decisionRule: {
      type: 'string',
      enum: ['MAJORITY', 'MANUAL_PRIORITY'],
      description: 'MAJORITY=多轮多数、MANUAL_PRIORITY=人工优先。',
    },
    tieBreakRule: {
      type: 'string',
      nullable: true,
      enum: ['STRICT', 'LENIENT', null],
      description: 'STRICT=平局从严、LENIENT=从宽；无需平局时为null。',
    },
    papers: { type: 'array', description: '当前版本的试卷和题目，不混入旧版本。', items: paper },
    gradingRounds: {
      type: 'array',
      description: '当前版本的判卷轮次，按roundNo升序。',
      items: round,
    },
  },
  examples: [examDetailExample],
};
const card = {
  type: 'object',
  description: '一场未删除考试的卡片，仅submittedAt非空的应试记录参与人数与准入率统计。',
  additionalProperties: false,
  required: [
    'examId',
    'examNo',
    'examName',
    'status',
    'examineeCount',
    'admittedCount',
    'admissionRate',
    'currentVersionId',
    'createdAt',
    'closedAt',
  ],
  properties: {
    examId: id('考试ID。'),
    examNo: text('考试编号。'),
    examName: text('考试名称。'),
    status: examStatus,
    examineeCount: {
      type: 'integer',
      minimum: 0,
      description: '已交卷应试记录数（沿旧按记录计数，不按用户去重）。',
    },
    admittedCount: {
      type: 'integer',
      minimum: 0,
      description: '已交卷且finalResult=ADMITTED的考试通过记录数，不代表已确认入项人数。',
    },
    admissionRate: decimal(
      '考试通过率百分比，0至100，按HALF_UP四舍五入保留两位小数；无已交卷记录为0。',
    ),
    currentVersionId: id('当前版本ID；读取前置历史考试缺少版本时null。', true),
    createdAt: text('考试创建时间，上海yyyy-MM-dd HH:mm:ss。'),
    closedAt: text('关闭时间，上海yyyy-MM-dd HH:mm:ss；未关闭为null。', true),
  },
};
export const examManagementExample = {
  projectId: 3001,
  needWrittenExam: true,
  activeExamCount: 1,
  maxActiveExamCount: 2,
  canCreateExam: true,
  createDisabledReason: null,
  exams: [
    {
      examId: 5001,
      examNo: 'EX20261021000000ABCDEFGH',
      examName: '准入考试',
      status: 'ACTIVE',
      examineeCount: 3,
      admittedCount: 1,
      admissionRate: 33.33,
      currentVersionId: 6001,
      createdAt: '2026-10-21 00:00:00',
      closedAt: null,
    },
  ],
};
export const examManagementResult = {
  type: 'object',
  description: '项目考试管理页，已关闭考试保留在列表中，不根据截止时间自动关闭。',
  additionalProperties: false,
  required: Object.keys(examManagementExample),
  properties: {
    projectId: id('项目ID。'),
    needWrittenExam: {
      type: 'boolean',
      description: '生产计划是否配置笔试，生产计划不存在时false。',
    },
    activeExamCount: { type: 'integer', minimum: 0, description: '未删除且状态ACTIVE的考试数。' },
    maxActiveExamCount: id('生产计划同时进行考试上限，缺少计划时1。'),
    canCreateExam: {
      type: 'boolean',
      description:
        '仅当前主策略官、生产计划需笔试且ACTIVE数低于上限时true；协作负责人/阅卷人固定false。此字段不能代替发布时权限校验。',
    },
    createDisabledReason: text(
      '可创建时null；否则为只读身份、未配置笔试或数量已达上限的原因。',
      true,
    ),
    exams: {
      type: 'array',
      description: '考试卡片按createdAt倒序，同时间按ID倒序，无考试时空数组。',
      items: card,
    },
  },
  examples: [examManagementExample],
};
const finalResult = {
  type: 'string',
  nullable: true,
  enum: ['PENDING', 'ADMITTED', 'ELIMINATED', null],
  description:
    'PENDING=已交卷待最终阅卷、ADMITTED=考试通过、ELIMINATED=考试未通过；未交卷时响应为null。请求省略/null表示不筛选；非空筛选只命中已交卷记录。',
};
const rosterItem = {
  type: 'object',
  additionalProperties: false,
  description: '一条应试花名册记录，展示姓名取实时资料；搜索仍按考试创建时快照。',
  required: [
    'attemptId',
    'attemptNo',
    'candidateUserId',
    'candidateUid',
    'candidateName',
    'organizationId',
    'organizationName',
    'finalResult',
    'roundScores',
    'enteredAt',
    'submittedAt',
  ],
  properties: {
    attemptId: id('应试记录ID。'),
    attemptNo: text('应试编号。'),
    candidateUserId: { ...text('考生用户ID，新库为UUID，与旧数值ID不互通。'), format: 'uuid' },
    candidateUid: text('应试时考生平台UID快照。'),
    candidateName: text('用户当前昵称(真实姓名)，缺失回退到应试快照名或UID；不更新应试快照。'),
    organizationId: { ...text('组织UUID，个人应试时null。', true), format: 'uuid' },
    organizationName: text('组织名称快照，个人应试时null。', true),
    finalResult,
    roundScores: {
      type: 'array',
      description:
        '当前应试记录实际存在的逐轮成绩，按gradingRoundId升序；无记录为空数组，不按当前配置伪造轮次。',
      items: {
        type: 'object',
        additionalProperties: false,
        description: '一轮判卷记录摘要，来自考生进入时绑定版本的轮次。',
        required: ['roundNo', 'gradingMode', 'score', 'roundResult'],
        properties: {
          roundNo: id('轮次号，从1开始。'),
          gradingMode: {
            type: 'string',
            enum: ['AUTO', 'MANUAL'],
            description: 'AUTO=自动轮次，MANUAL=人工轮次。',
          },
          score: decimal('本轮得分，最多两位小数；未形成分数时null；不会跨轮累加。', true),
          roundResult: {
            type: 'string',
            nullable: true,
            enum: ['ADMITTED', 'ELIMINATED', null],
            description:
              'ADMITTED=本轮通过，ELIMINATED=本轮淘汰，尚无结果时null；不是考试最终结果。',
          },
        },
      },
    },
    enteredAt: text('首次进入时间，上海yyyy-MM-dd HH:mm:ss；尚未进入为null。', true),
    submittedAt: text('交卷时间，上海yyyy-MM-dd HH:mm:ss；尚未交卷为null。', true),
  },
};
export const examRosterExample = {
  current: 1,
  size: 20,
  total: 1,
  pages: 1,
  records: [
    {
      attemptId: 10001,
      attemptNo: 'ATTEMPT_EXAMPLE',
      candidateUserId: uuid,
      candidateUid: 'candidate-uid',
      candidateName: '小明(王小明)',
      organizationId: null,
      organizationName: null,
      finalResult: 'ADMITTED',
      roundScores: [{ roundNo: 1, gradingMode: 'MANUAL', score: 20, roundResult: 'ADMITTED' }],
      enteredAt: '2026-10-21 00:00:00',
      submittedAt: '2026-10-21 00:30:00',
    },
  ],
};
export const examRosterResult = {
  type: 'object',
  description: '花名册分页；未筛选结果时包含未进入/未交卷记录。',
  additionalProperties: false,
  required: Object.keys(examRosterExample),
  properties: {
    current: { type: 'integer', minimum: 1, description: '规范化页码；省略/null为1，低于1按1。' },
    size: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      description: '规范化页大小；省略/null为20，低于1按1，超过100按100。',
    },
    total: { type: 'integer', minimum: 0, description: '应用筛选后的记录总数。' },
    pages: { type: 'integer', minimum: 0, description: '总页数，向上取整；无结果为0。' },
    records: {
      type: 'array',
      description: '按应试createdAt倒序，同时间按ID倒序；超出页码范围时为空数组。',
      items: rosterItem,
    },
  },
  examples: [examRosterExample],
};
export const examCloseExample = {
  examId: 5001,
  status: 'CLOSED',
  closedBy: 'manager-uid',
  closedAt: '2026-10-21 00:00:00',
};
const closeResult = {
  type: 'object',
  description: '关闭结果；考试版本/试卷/附件及已进入考生记录均保留。',
  additionalProperties: false,
  required: Object.keys(examCloseExample),
  properties: {
    examId: id('已关闭考试ID。'),
    status: { type: 'string', enum: ['CLOSED'], description: 'CLOSED=已关闭。' },
    closedBy: text('关闭人UID。'),
    closedAt: text('关闭时间，上海yyyy-MM-dd HH:mm:ss。'),
  },
  examples: [examCloseExample],
};
export type ExamQueryKind = 'detail' | 'management' | 'close' | 'roster';
export function examQuerySchema(kind: ExamQueryKind): FastifySchema {
  const management = kind === 'management',
    close = kind === 'close',
    roster = kind === 'roster';
  const result =
    kind === 'detail'
      ? examDetailResult
      : management
        ? examManagementResult
        : close
          ? closeResult
          : examRosterResult;
  const properties = {
    projectId: id('必填已发布项目ID，32位正整数。'),
    examId: id('必填考试ID，须为该项目未删除考试。'),
  };
  const request = management
    ? {
        querystring: {
          type: 'object',
          description: '管理页查询，无请求体。',
          additionalProperties: false,
          required: ['projectId'],
          properties: {
            projectId: {
              type: 'string',
              pattern: '^[1-9][0-9]{0,9}$',
              description: '必填已发布项目ID，32位正整数。',
              examples: ['3001'],
            },
          },
          examples: [{ projectId: '3001' }],
        },
      }
    : {
        body: {
          type: 'object',
          description: close
            ? '关闭考试请求。'
            : roster
              ? '花名册分页筛选。'
              : '当前生效编辑配置定位参数。',
          additionalProperties: false,
          required: ['projectId', 'examId'],
          properties: {
            ...properties,
            ...(close
              ? {
                  closeReason: {
                    ...text(
                      '可选关闭原因，最多500字符；省略/null/空白存null，其余去首尾空白。',
                      true,
                    ),
                    maxLength: 500,
                  },
                }
              : {}),
            ...(roster
              ? {
                  keyword: text(
                    '可选姓名/UID/组织名关键词，去首尾空白后匹配应试快照；省略/null/空白不筛选，沿LIKE的%/_通配语义。大小写兼容待验收。',
                    true,
                  ),
                  finalResult,
                  current: {
                    type: 'integer',
                    nullable: true,
                    minimum: -Number.MAX_SAFE_INTEGER,
                    maximum: Number.MAX_SAFE_INTEGER,
                    description:
                      '可选页码；省略/null为1，小于1按1；须安全整数且分页偏移不能溢出安全整数。',
                  },
                  size: {
                    type: 'integer',
                    nullable: true,
                    minimum: -Number.MAX_SAFE_INTEGER,
                    maximum: Number.MAX_SAFE_INTEGER,
                    description: '可选页大小；省略/null为20，小于1按1，超过100按100。',
                  },
                }
              : {}),
          },
          examples: [
            {
              projectId: 3001,
              examId: 5001,
              ...(close
                ? { closeReason: '停止招募' }
                : roster
                  ? { keyword: '小明', finalResult: 'PENDING', current: 1, size: 20 }
                  : {}),
            },
          ],
        },
      };
  return {
    operationId: {
      detail: 'getEntranceExamEditDetail',
      management: 'getEntranceExamManagement',
      close: 'closeEntranceExam',
      roster: 'getEntranceExamRoster',
    }[kind],
    summary: {
      detail: '查询准入考试编辑配置',
      management: '查询准入考试管理页',
      close: '关闭准入考试',
      roster: '分页查询应试花名册',
    }[kind],
    tags: ['EntranceExam'],
    description: `${close ? '仅当前PM角色且为当前生效主策略官，可关闭ACTIVE考试；项目/考试行锁及管理主线待办同事务。并发关闭一方200、另一方409，重复关闭409；不删除试卷/版本/附件/应试，不回退项目节点，无实时事件投递。' : '须当前PM角色的当前主策略官/招募协作负责人，或当前NAVIGATOR角色且出现在项目任一未删除考试的历史人工轮次中。NAVIGATOR仅为需求方或创建人不能替代阅卷配置；PM身份本身不代表项目权限。按当前会话角色判断PM项目关系或NAVIGATOR历史阅卷资格。读取使用一致性事务，重复调用无副作用，不改变快照或创建阅卷记录。'} ${kind === 'detail' ? '仅ACTIVE考试允许回显，读取当前版本的全部试卷/题目/轮次；已关闭返回400，当前配置缺失返回500。' : management ? '只按已交卷记录统计考试通过率；未配置计划时needWrittenExam=false、上限1。' : roster ? '非空finalResult筛选排除未交卷记录；搜索使用历史快照、姓名展示使用实时用户资料。逐轮成绩来自真实阅卷记录表；阅卷写入/Agent派发仍未接入。' : ''} Web使用会话Cookie并校验来源；桌面及普通API客户端使用Bearer，不混用。注册自带三角色，登录默认EXPERT。`,
    security: [{ webSession: [] }, { desktopSession: [] }],
    ...request,
    response: {
      200: resultSchema(result),
      ...Object.fromEntries(
        [400, 401, 403, 404, ...(close ? [409] : []), 500, 503].map((code) => [
          code,
          {
            ...resultSchema({ type: 'null', description: '失败时业务数据固定null。' }),
            description: `${code}：参数/状态不合法、未登录、项目关系/来源不符、对象不存在、配置异常或服务不可用${close ? '；重复/并发关闭返回409' : ''}。`,
            examples: [{ code, message: '操作失败', data: null }],
          },
        ]),
      ),
    },
  };
}
