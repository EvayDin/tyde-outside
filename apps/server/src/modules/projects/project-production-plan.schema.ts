import type { FastifySchema } from 'fastify';
import { resultSchema } from '../auth/auth.schema.js';
import { managerCandidatesQuery, managerRecruitResult } from './project-manager.schema.js';
export const productionPlanQuery = {
  ...managerCandidatesQuery,
  examples: [{ projectId: '3001' }],
  description: '生产计划项目范围；GET及POST均使用URL查询projectId，无keyword。',
  properties: {
    projectId: {
      ...managerCandidatesQuery.properties.projectId,
      description: '必填项目ID，十进制文本，32位正整数；必须为当前任职关联的已发布项目。',
    },
  },
};
const positiveInt = (description: string) => ({
  type: 'integer',
  minimum: 1,
  maximum: 2147483647,
  description,
});
const decimal = (description: string) => ({
  type: 'number',
  exclusiveMinimum: 0,
  exclusiveMaximum: 1e16,
  description: description + '；最多16位整数、4位小数，数据库DECIMAL(20,4)。',
});
const text = (description: string) => ({ type: 'string', description });
const date = (description: string) => ({
  type: 'string',
  format: 'date',
  pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',
  description,
});
const nullable = <T extends Record<string, unknown>>(schema: T) => ({ ...schema, nullable: true });
const crowdProperties = {
  crowdName: { ...text('人群名称，必填、trim后非空，最多100字符。'), maxLength: 100 },
  profileRequirement: text('策略官针对该人群的画像要求，必填、trim后非空；不是项目人员画像副本。'),
};
const stageProperties = {
  stageName: { ...text('阶段名称，必填、trim后非空，最多100字符。'), maxLength: 100 },
  startDate: date('必填开始日期，yyyy-MM-dd；不得早于确认时上海业务日期。'),
  endDate: date('必填结束日期，yyyy-MM-dd；不得早于开始日期，含首尾。'),
  workdayCount: nullable(
    positiveInt(
      '有效生产天数；MANUAL条件必填，AUTO忽略此值但填写仍须为正整数。不额外限制其小于自然天数。',
    ),
  ),
  workdayCountSource: nullable({
    type: 'string',
    enum: ['AUTO', 'MANUAL', null],
    description:
      'AUTO=自动统计周一至周五，排除周末、不扣节假日；MANUAL=使用workdayCount；缺省/null按AUTO。',
  }),
  operatorHeadcount: positiveInt('该阶段作业人数，必填；不自动回退计划人数。'),
  operatorCpd: nullable(decimal('该阶段人均日产能，缺省/null回退计划级operatorCpd')),
  accuracyRate: nullable({
    type: 'number',
    exclusiveMinimum: 0,
    maximum: 100,
    description: '准确率百分数，可空；填写须大于0且不超过100，最多4位小数。',
  }),
};
const array = (description: string, properties: Record<string, unknown>, required: string[]) => ({
  type: 'array',
  description,
  minItems: 1,
  maxItems: 50,
  items: {
    type: 'object',
    description: description + '单项。',
    additionalProperties: false,
    required,
    properties,
  },
});
export const productionPlanExample = {
  operatorHeadcount: 20,
  operatorCpd: 500.25,
  inspectorHeadcount: 5,
  inspectorCpd: 800,
  needWrittenExam: true,
  maxActiveExamCount: 1,
  needInterview: false,
  extJson: { note: '计划备注' },
  crowds: [{ crowdName: '第一梯队', profileRequirement: '具备相关经验' }],
  stages: [
    {
      stageName: '爬坡期',
      startDate: '2099-01-05',
      endDate: '2099-01-09',
      workdayCountSource: 'MANUAL',
      workdayCount: 5,
      operatorHeadcount: 20,
      operatorCpd: null,
      accuracyRate: 98.5,
    },
  ],
};
export const productionPlanBody = {
  type: 'object',
  additionalProperties: false,
  description: '完整生产计划，直接确认，无草稿；主策略官可提交，协作负责人只读。',
  required: ['operatorHeadcount', 'operatorCpd', 'crowds', 'stages'],
  properties: {
    operatorHeadcount: positiveInt('计划作业人数，必填。'),
    operatorCpd: decimal('计划作业人均日产能，必填'),
    inspectorHeadcount: nullable(positiveInt('计划质检人数；与inspectorCpd同时填写或同时为空。')),
    inspectorCpd: nullable(decimal('计划质检人均日产能；与inspectorHeadcount同时填写或同时为空')),
    needWrittenExam: nullable({
      type: 'boolean',
      description: '是否需笔试，缺省/null=true；影响nextStage，不代表考试功能已接入。',
    }),
    maxActiveExamCount: nullable(
      positiveInt('允许同时进行的准入考试数量；缺省/null=1，考试执行归05后续。'),
    ),
    needInterview: nullable({
      type: 'boolean',
      description: '是否需面试，缺省/null=false；此处只存计划标志，不代表面试流程已接入。',
    }),
    extJson: { description: '可选任意JSON扩展值；缺省/null保存为空，不参与权限或产能计算。' },
    crowds: array('人群配置，按请求顺序生成sequenceNo；至少1项、最多50项', crowdProperties, [
      'crowdName',
      'profileRequirement',
    ]),
    stages: array(
      '生产阶段，按请求顺序生成sequenceNo；至少1项、最多50项，不要求阶段互斥或连续',
      stageProperties,
      ['stageName', 'startDate', 'endDate', 'operatorHeadcount'],
    ),
  },
  examples: [productionPlanExample],
};
const id = nullable(positiveInt('已保存明细ID；未确认初始项为null。'));
const sequenceNo = positiveInt('显示序号，从1开始，按提交顺序由服务端分配。');
const crowdResponse = {
  type: 'object',
  additionalProperties: false,
  description: '计划人群；初始只有序号，ID/名称/画像为null。',
  required: ['id', 'sequenceNo', 'crowdName', 'profileRequirement'],
  properties: {
    id,
    sequenceNo,
    crowdName: nullable(crowdProperties.crowdName),
    profileRequirement: nullable(crowdProperties.profileRequirement),
  },
};
const stageResponse = {
  type: 'object',
  additionalProperties: false,
  description: '阶段及服务端计算结果，未确认时除名称/序号/来源外均为null。',
  required: [
    'id',
    'sequenceNo',
    ...Object.keys(stageProperties),
    'naturalDayCount',
    'expectedOutput',
  ],
  properties: {
    ...Object.fromEntries(
      Object.entries(stageProperties).map(([key, value]) => [key, nullable(value)]),
    ),
    id,
    sequenceNo,
    naturalDayCount: nullable(positiveInt('自然天数，开始日期到结束日期含首尾。')),
    expectedOutput: nullable({
      type: 'number',
      description:
        '阶段预期产出=阶段CPD×作业人数×有效天数，数据库DECIMAL(30,4)精确计算后按旧契约输出JSON数值；极大数的客户端精度兼容仍待验收。',
    }),
  },
};
const referenceProperties = {
  projectQuantity: nullable({
    type: 'number',
    description: '项目量级，实时读取项目，未填写为null。',
  }),
  quantityUnit: nullable(text('项目量级单位；未填写为null。')),
  deadline: nullable(text('项目截止时间，上海yyyy-MM-dd HH:mm:ss；未填写为null。')),
  requiredHeadcount: nullable(positiveInt('项目需求人数，未填写为null。')),
  educationRequirement: nullable({
    type: 'string',
    enum: ['PHD', 'MASTER', 'BACHELOR', 'COLLEGE', 'BELOW_COLLEGE', null],
    description:
      '学历：PHD博士、MASTER硕士、BACHELOR本科、COLLEGE大专、BELOW_COLLEGE大专以下；未填写null。',
  }),
  employmentType: nullable({
    type: 'string',
    enum: ['FULL_TIME', 'PART_TIME', 'UNLIMITED', null],
    description: '用工：FULL_TIME全职、PART_TIME兼职、UNLIMITED不限；未填写null。',
  }),
  experienceRequirement: nullable(text('项目经验要求，未填写null。')),
  workSummary: nullable(text('项目工作内容概述，未填写null。')),
  specialRequirement: nullable(text('项目特殊要求，未填写null。')),
  mandatoryRequirement: nullable(text('项目硬性要求，未填写null。')),
};
const responseProperties = {
  hasPlan: { type: 'boolean', description: '是否已有已确认计划；false返回初始默认项。' },
  editable: {
    type: 'boolean',
    description: '仅主策略官且未确认时true；协作负责人和已确认计划均false。',
  },
  id: nullable(positiveInt('生产计划ID；未确认null。')),
  projectId: positiveInt('当前项目ID。'),
  currentNodeCode: managerRecruitResult.properties.currentNodeCode,
  ...Object.fromEntries(
    Object.entries(productionPlanBody.properties)
      .filter(([k]) => !['crowds', 'stages'].includes(k))
      .map(([k, v]) => [
        k,
        ['needWrittenExam', 'needInterview', 'maxActiveExamCount', 'extJson'].includes(k)
          ? v
          : nullable(v),
      ]),
  ),
  totalExpectedOutput: nullable({
    type: 'number',
    description:
      '服务端精确汇总各阶段预期产出，数据库DECIMAL(30,4)；未确认null，JSON极大数精度兼容仍待验收。',
  }),
  confirmedBy: nullable(text('确认人平台UID；未确认null。')),
  confirmedAt: nullable(text('确认时间，上海yyyy-MM-dd HH:mm:ss；未确认null。')),
  nextStage: nullable({
    type: 'string',
    enum: ['ENTRANCE_EXAM', 'STANDARD_TRAINING', null],
    description:
      '计划目标下一阶段：ENTRANCE_EXAM准入考试、STANDARD_TRAINING标准培训；由笔试标志决定，不等于实际共享节点（补做时不回退），未确认null。',
  }),
  projectReference: {
    type: 'object',
    additionalProperties: false,
    description: '每次从项目表实时读取的创建参考信息；不是计划快照。',
    required: Object.keys(referenceProperties),
    properties: referenceProperties,
  },
  crowds: {
    type: 'array',
    description: '已确认人群按序号升序，未确认返回一个空白人群。',
    items: crowdResponse,
  },
  stages: {
    type: 'array',
    description: '已确认阶段按序号升序，未确认返回爬坡期和稳定生产期，来源AUTO。',
    items: stageResponse,
  },
};
export const productionPlanResponse = {
  type: 'object',
  additionalProperties: false,
  description: '生产计划详情及实时项目参考信息。',
  required: Object.keys(responseProperties),
  properties: responseProperties,
  examples: [
    {
      hasPlan: true,
      editable: false,
      id: 7001,
      projectId: 3001,
      currentNodeCode: 'ENTRANCE_EXAM',
      ...productionPlanExample,
      operatorCpd: 500.25,
      totalExpectedOutput: 50025,
      confirmedBy: '100001',
      confirmedAt: '2026-10-20 10:00:00',
      nextStage: 'ENTRANCE_EXAM',
      projectReference: {
        projectQuantity: 100000,
        quantityUnit: '条',
        deadline: '2099-12-31 23:59:59',
        requiredHeadcount: 30,
        educationRequirement: 'BACHELOR',
        employmentType: 'PART_TIME',
        experienceRequirement: null,
        workSummary: null,
        specialRequirement: null,
        mandatoryRequirement: '具备相关经验',
      },
      crowds: [{ id: 7101, sequenceNo: 1, ...productionPlanExample.crowds[0] }],
      stages: [
        {
          ...productionPlanExample.stages[0],
          id: 7201,
          sequenceNo: 1,
          operatorCpd: 500.25,
          naturalDayCount: 5,
          expectedOutput: 50025,
        },
      ],
    },
  ],
};
export function productionPlanSchema(write: boolean): FastifySchema {
  const errors = {
    400: '参数、日期或数值不合法，或生产计划已确认。',
    401: '未登录或会话失效。',
    403: '缺当前PM角色、非当前任职范围、协作负责人尝试确认或来源不可信。',
    404: '项目不存在/已删除；查询草稿也返回404。',
    409: '生产计划唯一约束或节点更新发生并发冲突。',
    500: '内部处理失败。',
    503: '服务不可用。',
  };
  return {
    operationId: write ? 'confirmProjectProductionPlan' : 'getProjectProductionPlan',
    summary: write ? '确认生产计划' : '查询生产计划',
    tags: ['Project'],
    security: [{ webSession: [] }, { desktopSession: [] }],
    querystring: productionPlanQuery,
    description:
      '须当前PM角色及当前ASSIGNED主策略官关系；GET亦允许当前招募协作负责人只读。注册自带三角色，登录默认EXPERT，User.role不授予权限。沿用Cookie/Bearer和写请求来源校验。' +
      (write
        ? 'projectId在URL查询参数，body为完整计划；锁项目后重新校验任职，只可确认一次，重复400；不同并发请求串行，唯一冲突409。主表、人群、阶段、节点与管理主线轮次同事务；只推进节点不回退、不清空项目表单。不新增实时事件（旧动作显式关闭），支线采集及考试/培训执行待后续。'
        : '无请求体；无计划返回默认项，已确认只读；实时参考字段来自项目。'),
    ...(write ? { body: productionPlanBody } : {}),
    response: {
      200: {
        ...resultSchema(productionPlanResponse),
        examples: productionPlanResponse.examples.map((data) => ({
          code: 200,
          message: '操作成功',
          data,
        })),
      },
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
