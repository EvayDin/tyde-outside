import type { FastifySchema } from 'fastify';
import { resultSchema } from '../auth/auth.schema.js';
const text = (description: string, nullable = false) => ({
  type: 'string',
  description,
  ...(nullable ? { nullable: true } : {}),
});
const id = (description: string) => ({
  type: 'integer',
  minimum: 1,
  maximum: 2147483647,
  description,
});
const score = (description: string) => ({
  type: 'number',
  nullable: true,
  exclusiveMinimum: 0,
  maximum: 99999999.99,
  description,
});
export const examFileSchema = {
  type: 'object',
  additionalProperties: false,
  description: '考试附件引用；元数据仅回显，保存时只信任台账。新库文件ID为UUID。',
  required: ['objectKey'],
  properties: {
    uploadedFileId: {
      ...text('可选已认领文件UUID；编辑复用同一考试旧附件时提供，与uploadToken互斥。', true),
      format: 'uuid',
    },
    objectKey: {
      ...text('必填对象Key，最多500字符；不能用任意URL代替。'),
      minLength: 1,
      maxLength: 500,
    },
    uploadToken: {
      ...text('新增文件凭证，最多128字符；新增附件必填，旧附件复用时省略或null。', true),
      maxLength: 128,
    },
    fileName: text('文件名，仅回显，保存忽略提交值。'),
    extension: text('扩展名，不含点；仅回显。'),
    contentType: text('可信MIME类型，仅回显。'),
    size: { type: 'integer', minimum: 0, description: '文件字节数，仅回显。' },
    fileHash: text('SHA-256；旧数据缺失时null，仅回显。', true),
    url: text('敏感代理预览地址，需登录；缺失为null，仅回显。', true),
    sensitive: { type: 'boolean', description: '敏感标记；考试附件固定true，仅回显。' },
  },
};
const fileList = (description: string, maxItems: number) => ({
  type: 'array',
  nullable: true,
  maxItems,
  description,
  items: examFileSchema,
});
export const examQuestionSchema = {
  type: 'object',
  additionalProperties: false,
  description:
    '一题配置，题干文字和题干附件至少一项；参考答案可空，导入要求答案或答案附件至少一项。',
  properties: {
    questionContent: text(
      '题干富文本，省略/null表示无文字；直接保存不会主动转义，文件导入时转义原文。',
      true,
    ),
    questionFiles: fileList('题干附件，省略/null/空数组表示无附件，最多20个。', 20),
    requiredFlag: {
      type: 'boolean',
      nullable: true,
      description: 'true=必答，false=选答，省略/null按true。',
    },
    score: {
      type: 'number',
      nullable: true,
      description:
        '分值；MANUAL必填且为最多两位小数的正数（上限99999999.99），AUTO忽略提交值由服务端均分。导入无分值时为null。',
    },
    scoreSource: {
      type: 'string',
      nullable: true,
      enum: ['AUTO', 'MANUAL', null],
      description:
        'AUTO=系统均分、末题承接尾差；MANUAL=使用手动分值；省略/null时有score按MANUAL、无score按AUTO。',
    },
    referenceAnswer: text('参考答案富文本，省略/null表示无文字。', true),
    referenceFiles: fileList('参考答案附件，省略/null/空数组表示无附件，最多20个。', 20),
  },
};
export const examPaperSchema = {
  type: 'object',
  additionalProperties: false,
  description: '按数组顺序保存的一张试卷；发布时逐题分值合计必须等于配置满分。',
  required: ['questions'],
  properties: {
    paperName: {
      ...text('试卷名称，最多100字符；省略/null/空白保存null并可展示为试卷N。', true),
      maxLength: 100,
    },
    questions: {
      type: 'array',
      minItems: 1,
      maxItems: 200,
      description: '题目列表，1至200题，数组顺序决定题号。',
      items: examQuestionSchema,
    },
  },
};
const jsonSchema = {
  description:
    '可选非敏感JSON工具配置；密钥须另行配置，不得包含secret/password/apikey/accesstoken/token字段（忽略大小写和横线/下划线并递归检查）；null表示未配置。',
  anyOf: [
    {
      type: 'object',
      additionalProperties: true,
      description: '工具自定义配置对象，字段含义由工具约定，密钥字段禁止提交。',
    },
    {
      type: 'array',
      description: '工具配置数组，元素为工具约定的非敏感JSON值。',
      items: { description: '工具约定的非敏感JSON值。' },
    },
    { type: 'string', description: '工具约定的非敏感文本配置。' },
    { type: 'number', description: '工具约定的数值配置。' },
    { type: 'boolean', description: '工具约定的布尔配置。' },
    { type: 'null', description: '未配置工具参数。' },
  ],
};
export const examRoundSchema = {
  type: 'object',
  additionalProperties: false,
  description:
    '判卷轮次；数组顺序决定轮次号，自动工具和手动阅卷人互斥。自动派发及阅卷执行尚未接入。',
  required: ['gradingMode'],
  properties: {
    gradingMode: {
      type: 'string',
      enum: ['AUTO', 'MANUAL'],
      description: '必填，AUTO=自动阅卷工具配置；MANUAL=人工阅卷人池。',
    },
    toolCode: {
      ...text('AUTO必填稳定工具编码，最多64字符；MANUAL不得填写非空值。', true),
      maxLength: 64,
    },
    toolName: {
      ...text('AUTO必填工具名称，最多128字符；MANUAL不得填写非空值。', true),
      maxLength: 128,
    },
    toolConfig: jsonSchema,
    toolFiles: fileList(
      'AUTO可选工具附件，最多10个；MANUAL不得配置，省略/null/空数组为无附件。',
      10,
    ),
    reviewerUserIds: {
      type: 'array',
      nullable: true,
      maxItems: 100,
      description:
        'MANUAL必填且至少一人，每轮去重；须ACTIVE账号（注册自带三角色）。AUTO不得配置；不据候选查询限制为两人，沿旧保存规则。',
      items: { type: 'string', format: 'uuid', description: '阅卷人用户UUID，新旧用户ID不互通。' },
    },
  },
};
export const examConfigProperties = {
  projectId: id('必填已发布项目ID；调用人须当前PM角色且为当前生效策略官。'),
  examName: {
    ...text('项目内唯一考试名称，发布/编辑必填，去首尾空白后1至128字符；导入未提取时null。', true),
    maxLength: 128,
  },
  durationMinutes: {
    ...id('答题时限，单位分钟；省略/null表示不限时，填写须32位正整数。'),
    nullable: true,
  },
  registrationDeadline: {
    ...text(
      '截止报名/首次进入时间，上海时区yyyy-MM-dd HH:mm:ss；发布/编辑必填且晚于当前时间，导入缺失为null。',
      true,
    ),
    pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$',
  },
  fullScore: score(
    '所有试卷统一满分，发布/编辑必填，正数最多两位小数。导入缺失为null；所有题均手动分值且各卷合计相同时用该合计覆盖元配置满分。',
  ),
  passScore: score('及格分数，发布/编辑必填，正数最多两位小数且不超过满分；导入缺失为null。'),
  decisionRule: {
    type: 'string',
    nullable: true,
    enum: ['MAJORITY', 'MANUAL_PRIORITY', null],
    description:
      'MAJORITY=多轮多数（省略/null默认）；MANUAL_PRIORITY=人工优先，至少一手动轮。导入不补裁决规则，返回null。',
  },
  tieBreakRule: {
    type: 'string',
    nullable: true,
    enum: ['STRICT', 'LENIENT', null],
    description:
      'STRICT=平局从严、LENIENT=从宽；MAJORITY且偶数轮必填，其他情况保存null；导入返回null。',
  },
  papers: {
    type: 'array',
    minItems: 1,
    maxItems: 20,
    description: '试卷列表，1至20张，顺序决定序号。',
    items: examPaperSchema,
  },
  gradingRounds: {
    type: 'array',
    maxItems: 20,
    description: '判卷轮次，发布/编辑至少1轮、最多20轮；导入返回空数组，需用户补充。',
    items: examRoundSchema,
  },
};
export const examConfigExample = {
  projectId: 3001,
  examName: '示例准入考试',
  durationMinutes: 60,
  registrationDeadline: '2099-01-01 23:59:59',
  fullScore: 20,
  passScore: 12,
  decisionRule: 'MAJORITY',
  tieBreakRule: null,
  papers: [
    {
      paperName: '试卷1',
      questions: [
        {
          questionContent: '请描述操作步骤。',
          questionFiles: [],
          requiredFlag: true,
          score: 20,
          scoreSource: 'MANUAL',
          referenceAnswer: '按规范完成操作。',
          referenceFiles: [],
        },
      ],
    },
  ],
  gradingRounds: [
    { gradingMode: 'MANUAL', reviewerUserIds: ['00000000-0000-4000-8000-000000000001'] },
  ],
};
export const examConfigSchema = {
  type: 'object',
  description: '完整考试配置；导入是待补充配置，不能直接视为已发布。',
  additionalProperties: false,
  required: ['projectId', 'papers', 'gradingRounds'],
  properties: examConfigProperties,
  examples: [examConfigExample],
};
export const examMutationExample = {
  examId: 5001,
  examNo: 'EX20261021000000ABCDEFGH',
  projectId: 3001,
  examName: '示例准入考试',
  status: 'ACTIVE',
  currentVersionId: 6001,
  versionNo: 1,
  publishedAt: '2026-10-21 00:00:00',
};
export const examMutationResult = {
  type: 'object',
  description: '考试发布/编辑后的当前版本信息；已进入考生继续绑定原版本。',
  additionalProperties: false,
  required: Object.keys(examMutationExample),
  properties: {
    examId: id('考试ID，32位正整数。'),
    examNo: text('全局考试编号，EX加上海秒级时间及8位随机后缀。'),
    projectId: id('所属项目ID。'),
    examName: text('规范化后的考试名称。'),
    status: {
      type: 'string',
      enum: ['ACTIVE'],
      description: 'ACTIVE=进行中；发布/编辑成功固定此状态。',
    },
    currentVersionId: id('本次生效的配置版本ID；下一次编辑作为expectedCurrentVersionId。'),
    versionNo: id('配置版本号，从1开始，每次编辑加1。'),
    publishedAt: text('版本生效时间，上海时区yyyy-MM-dd HH:mm:ss。'),
  },
  examples: [examMutationExample],
};
export function examConfigRouteSchema(edit: boolean): FastifySchema {
  return {
    operationId: edit ? 'editEntranceExam' : 'publishEntranceExam',
    summary: edit ? '编辑准入考试' : '发布准入考试',
    tags: ['EntranceExam'],
    description: `须有效会话及当前PM角色，并为项目当前生效策略官；不允许招募协作负责人代操作。${edit ? '完整替换配置，校验expectedCurrentVersionId，新增不可变版本并原子切换，旧版本和已进入考生不变；并发旧版本返回409。' : '项目必须已有确认的生产计划且需要笔试，进行中考试不超过生产计划上限；同项目发布/编辑串行化。首次发布V1并单向推进管理主节点到标准培训。'} 附件认领/版本/试卷/题目/轮次/管理主线待办同事务。名称按数据库精确匹配，大小写兼容待验收。重复发布不自动幂等，沿同名冲突和数量上限返回。AUTO仅保存工具配置，自动派发和阅卷执行尚未接入；无实时事件投递。Web用Cookie并校验来源；桌面及普通API客户端用Bearer，不混用。`,
    security: [{ webSession: [] }, { desktopSession: [] }],
    body: {
      ...examConfigSchema,
      required: [
        ...examConfigSchema.required,
        'examName',
        'registrationDeadline',
        'fullScore',
        'passScore',
        ...(edit ? ['examId', 'expectedCurrentVersionId'] : []),
      ],
      properties: {
        ...examConfigProperties,
        ...(edit
          ? {
              examId: id('必填待编辑考试ID，须属于当前项目且ACTIVE。'),
              expectedCurrentVersionId: id('必填加载时的当前版本ID，与数据库不符返回409。'),
            }
          : {}),
      },
      examples: [
        edit
          ? { ...examConfigExample, examId: 5001, expectedCurrentVersionId: 6001 }
          : examConfigExample,
      ],
    },
    response: {
      200: resultSchema(examMutationResult),
      ...Object.fromEntries(
        [400, 401, 403, 404, 409, 500, 503].map((code) => [
          code,
          {
            ...resultSchema({ type: 'null', description: '失败时数据为null。' }),
            description: `${code}：参数/权限/来源不合法、项目或考试不存在、版本/名称冲突或服务失败，事务回滚。`,
            examples: [{ code, message: '操作失败', data: null }],
          },
        ]),
      ),
    },
  };
}
