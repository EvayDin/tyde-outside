import type { FastifySchema } from 'fastify';
import { resultSchema } from '../auth/auth.schema.js';
import {
  projectAttachmentBody,
  projectAttachmentResponse,
  projectDraftDetail,
} from './project-creation.schema.js';
import { productionPlanQuery } from './project-production-plan.schema.js';
export const materialsExample = {
  projectId: 3001,
  standardContent: '按规范标注',
  standardLink: null,
  attachments: [projectAttachmentResponse.examples[0]],
  currentNodeCode: 'RECRUIT_EXECUTION_EXPERT',
  stateTransitioned: false,
  canConfirmRead: false,
  confirmedReadAt: null,
  readConfirmationTransitioned: false,
  versionNo: 1,
};
export const materialsBody = {
  type: 'object',
  additionalProperties: false,
  description: '标准材料修改；正文与链接至少填写一项，省略的文本字段清空。',
  required: ['projectId'],
  properties: {
    projectId: {
      type: 'integer',
      minimum: 1,
      maximum: 2147483647,
      description: '必填，项目32位正整数ID。',
    },
    standardContent: {
      type: 'string',
      nullable: true,
      description: '标准正文；省略/null/空白清空，与链接至少有一项非空。',
    },
    standardLink: {
      type: 'string',
      nullable: true,
      maxLength: 2000,
      description: '标准外部链接，最多2000字符；省略/null/空白清空，不抓取远程文档。',
    },
    attachments: {
      type: 'array',
      nullable: true,
      maxItems: 20,
      description:
        '最多20个；省略/null保留、空数组清空、非空整体替换；新增文件必须为当前用户上传且提供凭证。',
      items: projectAttachmentBody,
    },
  },
  examples: [
    { projectId: 3001, standardContent: '按规范标注', standardLink: null, attachments: [] },
  ],
};
export const materialsResponse = {
  type: 'object',
  additionalProperties: false,
  description: '标准与案例材料及当前用户阅读资格。',
  required: Object.keys(materialsExample),
  properties: {
    projectId: materialsBody.properties.projectId,
    standardContent: {
      ...materialsBody.properties.standardContent,
      description: '已保存的标准正文，未配置为null。',
    },
    standardLink: {
      ...materialsBody.properties.standardLink,
      description: '已保存的外部文档链接，未配置为null。',
    },
    attachments: {
      type: 'array',
      description:
        '有效附件按sortNo/id升序；无附件为空数组。仅台账元数据，文件下载另经鉴权；专家下载权限仍待07/08回补。',
      items: projectAttachmentResponse,
    },
    currentNodeCode: projectDraftDetail.properties.currentNodeCode,
    stateTransitioned: {
      type: 'boolean',
      description:
        '本次主策略官修改是否推进到招募执行专家；查询/创建人编辑恒false，后期编辑不回退。',
    },
    canConfirmRead: {
      type: 'boolean',
      description: '当前EXPERT是已实际入项的普通成员且尚未确认时为true；项目负责人不可确认。',
    },
    confirmedReadAt: {
      type: 'string',
      nullable: true,
      description: '本人确认阅读时间，上海yyyy-MM-dd HH:mm:ss；非普通专家或未确认时null。',
    },
    readConfirmationTransitioned: {
      type: 'boolean',
      description: '本次是否首次确认阅读；重复确认、查询及编辑固定false。',
    },
    versionNo: {
      type: 'integer',
      minimum: 0,
      description: '项目当前版本；每次成功修改递增1。本接口沿旧请求不要求客户端提交版本。',
    },
  },
  examples: [materialsExample],
};
export function materialsSchema(write: boolean): FastifySchema {
  return {
    operationId: write ? 'updateProjectStandardMaterials' : 'getProjectStandardMaterials',
    summary: write ? '修改项目标准与案例材料' : '查询项目标准与案例材料',
    tags: ['Project'],
    security: [{ webSession: [] }, { desktopSession: [] }],
    description:
      '按当前会话角色及真实项目关系鉴权。NAVIGATOR仅创建人，PM读取允许主策略官及招募协作负责人，修改仅主策略官；EXPERT仅可读取已接单范围，无笔试无需准入，要求笔试时组织主管/项目负责人豁免，其他专家须已有ADMITTED结果。管理修改与附件认领、主线轮次同事务；不发实时事件。专家接单/考试/文件权限联调待07/08，个人卡片重算归04。',
    ...(write ? { body: materialsBody } : { querystring: productionPlanQuery }),
    response: {
      200: {
        ...resultSchema(materialsResponse),
        examples: [{ code: 200, message: '操作成功', data: materialsExample }],
      },
      ...Object.fromEntries(
        Object.entries({
          400: '参数或附件不合法。',
          401: '未登录或会话失效。',
          403: '当前角色或项目关系无权限。',
          404: '已发布项目不存在。',
          409: '项目或附件并发变更。',
          500: '内部处理失败。',
          503: '服务不可用。',
        }).map(([status, message]) => [
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

export const materialsConfirmSchema: FastifySchema = {
  ...materialsSchema(false),
  operationId: 'confirmProjectStandardMaterialsRead',
  summary: '确认已阅读标准与培训',
  description:
    '仅当前EXPERT且具有标准材料读取资格的ACTIVE已实际入项普通成员可确认；项目负责人403，尚未入项400。POST查询参数projectId必填，不使用JSON body。确认时间、本人培训轮次和个人履约快照同事务，首次确认推进个人支线到生产任务，不改变项目共享节点或版本。重复确认保留首次时间并刷新陈旧个人快照，高优先级其他支线保留，跨领域重算归04。不发布实时事件，不调用业务Agent。',
  response: {
    ...(materialsSchema(false).response as Record<string, unknown>),
    200: {
      ...resultSchema(materialsResponse),
      examples: [
        {
          code: 200,
          message: '操作成功',
          data: {
            ...materialsExample,
            confirmedReadAt: '2026-10-22 16:00:00',
            readConfirmationTransitioned: true,
          },
        },
      ],
    },
  },
};
