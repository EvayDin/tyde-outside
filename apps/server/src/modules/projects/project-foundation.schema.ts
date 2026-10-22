import type { FastifySchema } from 'fastify';
import { resultSchema } from '../auth/auth.schema.js';
const userId = '00000000-0000-4000-8000-000000000001';
const orgId = '00000000-0000-4000-8000-000000000002';
export const categoryQuery = {
  type: 'object',
  description: '可选分类筛选，无请求体；不传参数查询所有启用分类。',
  additionalProperties: false,
  properties: {
    // HTTP query天然是字符串；本接口局部转型，不改全局AJV配置。
    categoryLevel: {
      type: 'string',
      enum: ['1', '2', '3'],
      description: '可选独立级别：1=一级、2=二级、3=三级，各级无父子关系；省略查询所有级别。',
      examples: ['1'],
    },
    keyword: {
      type: 'string',
      description:
        '可选模糊搜索词，去除首尾空白后匹配名称、编码或别名；省略/空白不筛选，%及_保留旧LIKE通配语义。大小写兼容待验收。',
      examples: ['图片'],
    },
  },
  examples: [{ categoryLevel: '1', keyword: '图片' }, {}],
};
export const categoryItem = {
  type: 'object',
  additionalProperties: false,
  description: '启用的独立项目分类。',
  required: ['id', 'categoryCode', 'categoryName', 'categoryLevel', 'sortNo'],
  properties: {
    id: {
      type: 'integer',
      minimum: 1,
      description: '分类主键，正整数；保留旧数值字段格式，不代表与旧库数据互通。',
      examples: [11],
    },
    categoryCode: {
      type: 'string',
      description: '全表唯一的稳定分类编码。',
      examples: ['IMAGE_CLASSIFICATION'],
    },
    categoryName: {
      type: 'string',
      description: '同级唯一的分类展示名称。',
      examples: ['图片分类'],
    },
    categoryLevel: {
      type: 'integer',
      enum: [1, 2, 3],
      description: '独立分类级别：1=一级、2=二级、3=三级，无父子关系。',
      examples: [1],
    },
    sortNo: {
      type: 'integer',
      description: '同级展示排序值；越小越靠前，相同按分类ID升序。',
      examples: [10],
    },
  },
  examples: [
    {
      id: 11,
      categoryCode: 'IMAGE_CLASSIFICATION',
      categoryName: '图片分类',
      categoryLevel: 1,
      sortNo: 10,
    },
  ],
};
export const categoriesResponse = {
  type: 'array',
  description: '按级别、展示顺序、ID升序排列的启用分类；无匹配或尚未维护字典时返回空数组。',
  items: categoryItem,
  examples: [[categoryItem.examples[0]], []],
};
export const requesterParams = {
  type: 'object',
  description: '本人需求方路径参数，两项均必填，无请求体。',
  required: ['requesterType', 'requesterId'],
  additionalProperties: false,
  properties: {
    requesterType: {
      type: 'string',
      enum: ['INDIVIDUAL', 'ORGANIZATION'],
      description:
        '需求方账号类型，必填：INDIVIDUAL=个人、ORGANIZATION=组织，统一账号仅支持INDIVIDUAL本人；ORGANIZATION选择未开放，返回400。',
      examples: ['INDIVIDUAL'],
    },
    requesterId: {
      type: 'string',
      format: 'uuid',
      description:
        '需求方用户ID，必填，须等于当前登录用户ID；新库为UUID，旧数值ID尚未转换，不能混用。',
      examples: [userId],
    },
  },
  examples: [{ requesterType: 'INDIVIDUAL', requesterId: userId }],
};
export const requesterResponse = {
  type: 'object',
  description: '服务端用户/组织资料生成的本人需求方信息；没有副作用，不认领文件。',
  required: ['requesterType', 'requesterId', 'requesterName', 'orgId', 'orgVerifyStatus'],
  additionalProperties: false,
  properties: {
    requesterType: requesterParams.properties.requesterType,
    requesterId: requesterParams.properties.requesterId,
    requesterName: {
      type: 'string',
      description: '个人按昵称(姓名)展示，缺一项时取另一项；组织取有效成员关系选定组织的名称。',
      examples: ['小明(王小明)'],
    },
    orgId: {
      type: 'string',
      format: 'uuid',
      nullable: true,
      description:
        '组织ID，UUID字符串；个人账号为null；组织账号按OWNER优先、最早加入、关系ID升序选取有效组织。',
      examples: [null, orgId],
    },
    orgVerifyStatus: {
      type: 'string',
      nullable: true,
      enum: ['PENDING', 'APPROVED', 'REJECTED', null],
      description:
        '组织认证：PENDING=待审核、APPROVED=通过、REJECTED=拒绝；个人为null。仅回填，不要求审核通过。',
      examples: [null, 'PENDING'],
    },
  },
  examples: [
    {
      requesterType: 'INDIVIDUAL',
      requesterId: userId,
      requesterName: '小明(王小明)',
      orgId: null,
      orgVerifyStatus: null,
    },
  ],
};
export function projectFoundationSchema(
  operationId: string,
  summary: string,
  description: string,
  response: Record<string, unknown>,
): FastifySchema {
  const errors = {
    400: '参数或需求方类型不合法，或组织/个人资料不完整。',
    401: '未登录或会话已失效。',
    403: '没有有效NAVIGATOR授权、请求其他账号或请求来源不可信。',
    404: '需求方用户不存在。',
    500: '内部处理失败。',
    503: '数据库或服务暂不可用。',
  };
  return {
    operationId,
    summary,
    tags: ['Project'],
    description: `${description} 无请求体，只读无副作用。须有效登录及服务端当前NAVIGATOR角色，不从User.role、注册参数或客户端角色声明推导。注册自带三角色，登录默认EXPERT。Web用会话Cookie并遵循来源校验；桌面/无浏览器头的普通API客户端用Bearer，不得混用Cookie与Authorization。`,
    security: [{ webSession: [] }, { desktopSession: [] }],
    response: {
      200: resultSchema(response),
      ...Object.fromEntries(
        Object.entries(errors).map(([status, message]) => [
          status,
          {
            ...resultSchema({ type: 'null', description: '失败时业务数据固定null。' }),
            description: message,
            examples: [{ code: Number(status), message, data: null }],
          },
        ]),
      ),
    },
  };
}
