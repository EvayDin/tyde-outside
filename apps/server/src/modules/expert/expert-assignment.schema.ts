import { authSchema, resultSchema } from '../auth/auth.schema.js';
import {
  projectPublishedDetail,
  projectPublishedExample,
  projectProductionRequirements,
} from '../projects/project-query.schema.js';
import { productionPlanResponse } from '../projects/project-production-plan.schema.js';
const text = (description: string, nullable = false) => ({
  type: 'string',
  description,
  ...(nullable ? { nullable: true } : {}),
});
const integer = (description: string) => ({
  type: 'integer',
  minimum: 1,
  maximum: 2147483647,
  description,
});
const properties = {
  assignmentId: integer('执行专家分配记录ID。'),
  projectId: integer('项目ID。'),
  projectName: text('项目名称；历史未填写null。', true),
  requesterName: text('需求方展示名称，个人取实时昵称(姓名)，组织取项目快照。'),
  needWrittenExam: { type: 'boolean', description: '生产计划是否要求笔试；尚未配置计划时false。' },
  admissionStatus: {
    ...text(
      '本人准入状态：PASSED=通过、PENDING=待阅卷、NOT_PASSED=已进入但未通过、NOT_EXAMINED=未考试；跨未删除考试按上述优先级聚合事实，不从项目成员身份猜测通过。考试写入口待05/08接入。',
    ),
    enum: ['PASSED', 'PENDING', 'NOT_PASSED', 'NOT_EXAMINED'],
  },
  currentNodeCode: text(
    '本人支线节点：需考试且未通过为ENTRANCE_EXAM=准入考试；否则优先真实支线/最新成员履约状态，STANDARD_TRAINING=标准与培训、PRODUCTION_TASK=生产任务。无个人支线时沿旧规则回退标准与培训，该回退不授予后续操作。报量核验真值待11，不沿用旧OUTPUT_DATA_REVIEW快照。',
  ),
};
export const myProjectExample = {
  assignmentId: 1,
  projectId: 3001,
  projectName: '示例项目',
  requesterName: '小明(王小明)',
  needWrittenExam: true,
  admissionStatus: 'NOT_EXAMINED',
  currentNodeCode: 'ENTRANCE_EXAM',
};
export const myProjectsResponse = {
  type: 'array',
  description:
    '本人已接单且符合普通执行专家口径的项目；无结果为空数组，按分配创建时间/ID倒序、每项目保留最新有效分配。组织主管与项目负责人不列入普通成员列表，组织成员必须ACCEPTED/SELECTED。',
  items: {
    type: 'object',
    additionalProperties: false,
    description: '本人参加的一个项目。',
    required: Object.keys(properties),
    properties,
  },
  examples: [[myProjectExample]],
};
const planProps = productionPlanResponse.properties;
export const assignmentProductionPlan = {
  ...projectProductionRequirements,
  description:
    '接单侧只读生产要求，不含管理计划配置或确认人；量级/作业人数/质检人数取当前分配值，人均CPD/阶段/画像取已确认生产计划。',
  properties: {
    ...projectProductionRequirements.properties,
    crowds: { ...planProps.crowds, description: '已配置的人群画像；无计划为空数组。' },
    operatorHeadcount: {
      ...projectProductionRequirements.properties.operatorHeadcount,
      description: '当前分配要求的作业人数，未设置null。',
    },
    inspectorHeadcount: {
      ...projectProductionRequirements.properties.inspectorHeadcount,
      description: '当前分配要求的质检人数，未设置null。',
    },
    totalExpectedOutput: {
      ...projectProductionRequirements.properties.totalExpectedOutput,
      description: '当前分配的生产量级；未设置null，JSON数值，精度兼容待验收。',
    },
  },
};
const detailFields = {
  projectDetail: {
    ...projectPublishedDetail,
    description: '项目创建第1/2/3步完整信息；不含管理配置，附件内容另行鉴权读取。',
  },
  productionPlan: assignmentProductionPlan,
  assignmentId: integer('当前分配记录ID，新增辅助字段。'),
  currentNodeCode: {
    ...projectPublishedDetail.properties.currentNodeCode,
    description: '项目真实主线节点码；未设置null。区别于my-projects返回的本人支线节点。',
  },
  availableOperations: {
    type: 'array',
    description:
      '当前已开放且允许执行的操作；本批只读详情VIEW_DETAIL。接单/考试/培训/生产写入口尚未迁移，不能仅因节点显示就发起这些操作。',
    items: { ...text('VIEW_DETAIL=查看详情。'), enum: ['VIEW_DETAIL'] },
  },
};
export const assignmentDetailExample = {
  projectDetail: projectPublishedExample,
  productionPlan: {
    ...projectProductionRequirements.examples[0],
    crowds: [],
    operatorHeadcount: 2,
    inspectorHeadcount: 1,
    totalExpectedOutput: 100,
  },
  assignmentId: 1,
  currentNodeCode: 'PRODUCTION_PLAN',
  availableOperations: ['VIEW_DETAIL'],
};
export const assignmentDetailResponse = {
  type: 'object',
  additionalProperties: false,
  description: '分配范围授权后的项目详情与只读生产要求；扩展当前主线节点与已开放操作。',
  required: Object.keys(detailFields),
  properties: detailFields,
  examples: [assignmentDetailExample],
};
export const myProjectsQuery = {
  type: 'object',
  additionalProperties: false,
  description: '本人项目关键字筛选，无请求体。',
  properties: {
    keyword: {
      ...text(
        '可选项目名称、需求方名称、准入状态或当前节点关键字，trim后不区分大小写；空白不筛选，最多100字符。',
      ),
      maxLength: 100,
    },
  },
};
export const assignmentDetailQuery = {
  type: 'object',
  additionalProperties: false,
  required: ['assignmentId'],
  description: '分配记录查询参数，不允许指定用户。',
  properties: {
    assignmentId: {
      ...text('执行专家分配ID，1至2147483647的十进制正整数字符串。'),
      pattern: '^[1-9]\\d{0,9}$',
    },
  },
};
export const expertSchema = (
  operationId: string,
  summary: string,
  description: string,
  response: Record<string, unknown>,
) => ({
  ...authSchema(operationId, summary, resultSchema(response), true),
  tags: ['ExpertAssignment'],
  description:
    description +
    ' 固定EXPERT不代替实际分配/组织成员关系校验。支持受信Cookie或无浏览器头的Bearer客户端；400参数错误、401失效会话、403无权访问、404分配或已发布项目不存在。接单/考试写入口尚未接入，返回真实存量关系，不生成测试分配或伪造已接单事实。',
});
