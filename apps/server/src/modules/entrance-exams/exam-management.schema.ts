import type { FastifySchema } from 'fastify';
import { resultSchema } from '../auth/auth.schema.js';
export const templateQuery = {
  type: 'object',
  description: '模板类型查询，type必填，无请求体。',
  additionalProperties: false,
  required: ['type'],
  properties: {
    type: {
      type: 'string',
      enum: ['EXCEL', 'TXT', 'REDOC'],
      description:
        '必填模板类型：EXCEL=XLSX工作簿、TXT=UTF-8制表文本、REDOC=可导入文档的XML模板。无默认值。',
      examples: ['EXCEL'],
    },
  },
  examples: [{ type: 'EXCEL' }, { type: 'TXT' }, { type: 'REDOC' }],
};
export const reviewersQuery = {
  type: 'object',
  description: '阅卷人候选查询，项目ID必填，无请求体。',
  additionalProperties: false,
  required: ['projectId'],
  properties: {
    projectId: {
      type: 'string',
      pattern: '^[1-9][0-9]{0,9}$',
      description: '必填已发布项目主键，32位正整数；须为当前生效策略官本人。',
      examples: ['3001'],
    },
    keyword: {
      type: 'string',
      description:
        '可选姓名、昵称或UID包含搜索，去除首尾空白、不区分大小写；省略或空白不筛选，不解释通配符。',
      examples: ['小明'],
    },
  },
  examples: [{ projectId: '3001', keyword: '小明' }, { projectId: '3001' }],
};
export const reviewerItem = {
  type: 'object',
  description: '阅卷人候选项，仅包含身份展示字段。',
  additionalProperties: false,
  required: ['userId', 'uid', 'name', 'avatarUrl'],
  properties: {
    userId: {
      type: 'string',
      format: 'uuid',
      description:
        '用户主键，发布或编辑配置时用作reviewerUserIds元素；新库为UUID，与旧库数值ID不互通。',
      examples: ['00000000-0000-4000-8000-000000000001'],
    },
    uid: { type: 'string', description: '平台用户唯一标识。', examples: ['reviewer-uid'] },
    name: {
      type: 'string',
      description: '昵称(真实姓名)；缺一项取另一项，都缺失回退UID。',
      examples: ['小明(王小明)'],
    },
    avatarUrl: {
      type: 'string',
      nullable: true,
      description: '头像地址；未设置时为null。',
      examples: [null],
    },
  },
  examples: [
    {
      userId: '00000000-0000-4000-8000-000000000001',
      uid: 'reviewer-uid',
      name: '小明(王小明)',
      avatarUrl: null,
    },
  ],
};
export const reviewersResult = {
  type: 'array',
  description:
    '最多两名有效账号候选，按项目需求方、当前生效策略官排序并去重；无匹配时为空数组。候选查询不授予手动阅卷资格。',
  items: reviewerItem,
  examples: [reviewerItem.examples, []],
};
export function examSchema(template: boolean): FastifySchema {
  const errors = {
    400: '模板类型或项目参数不合法，或项目未发布。',
    401: '未登录或会话失效。',
    403: '来源不可信、没有当前PM角色，或候选查询调用人不是当前生效策略官。',
    404: '项目不存在或已删除。',
    500: '内部处理失败。',
    503: '数据库暂不可用。',
  };
  return {
    operationId: template
      ? 'downloadEntranceExamImportTemplate'
      : 'getEntranceExamReviewerCandidates',
    summary: template ? '下载固定格式试卷模板' : '查询阅卷人候选列表',
    tags: ['EntranceExam'],
    description: `${template ? '返回v1模板文件，含考试配置、题目表头和两道示例题；截止日期留空需补充。EXCEL返回XLSX，TXT返回UTF-8文本，REDOC返回XML；不创建考试、不调用外部文档服务。已提供文件解析、发布及编辑；远程文档来源尚未接入。' : '仅已发布项目当前生效策略官可查；候选固定为项目需求方与本人，仅返回ACTIVE账号。招募协作负责人无权查询。不产生考试、授权或阅卷指派。'} 只读无请求体、重复调用无副作用。须有效登录和当前PM角色；注册自带三角色，登录默认EXPERT，不信任客户端角色声明。Web用会话Cookie并校验来源，桌面及无浏览器头普通API客户端用Bearer，不得混用。`,
    security: [{ webSession: [] }, { desktopSession: [] }],
    querystring: template ? templateQuery : reviewersQuery,
    response: {
      200: template
        ? {
            description:
              '按type返回原始模板文件字节，不使用Result包装；Content-Disposition为attachment，文件名entrance-exam-import-v1加对应扩展名。',
            content: Object.fromEntries(
              [
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'text/plain',
                'application/xml',
              ].map((type) => [
                type,
                {
                  schema: {
                    type: 'string',
                    format: 'binary',
                    description: '对应type的模板文件字节。',
                  },
                },
              ]),
            ),
          }
        : resultSchema(reviewersResult),
      ...Object.fromEntries(
        Object.entries(errors).map(([code, message]) => [
          code,
          {
            ...resultSchema({ type: 'null', description: '失败时数据固定null。' }),
            description: message,
            examples: [{ code: Number(code), message, data: null }],
          },
        ]),
      ),
    },
  };
}
