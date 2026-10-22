import type { FastifySchema } from 'fastify';
import { resultSchema } from '../auth/auth.schema.js';
import { managerCandidate, managerCandidatesQuery } from './project-manager.schema.js';
const properties = {
  userId: managerCandidate.properties.userId,
  uid: managerCandidate.properties.uid,
  name: managerCandidate.properties.name,
  avatarUrl: managerCandidate.properties.avatarUrl,
  currentProjectCount: managerCandidate.properties.currentProjectCount,
};
export const handlerExample = {
  userId: '00000000-0000-4000-8000-000000000002',
  uid: 'handler',
  name: '小明(王小明)',
  avatarUrl: null,
  currentProjectCount: 0,
  currentHandler: true,
};
export const handlerCandidates = {
  type: 'array',
  description:
    '全部ACTIVE候选，含主策略官本人；按负责项目数升序、信用分降序、ID升序，无匹配为空数组。',
  items: {
    type: 'object',
    additionalProperties: false,
    description: '负责人候选卡片，不返回手机号或信用分。',
    required: [...Object.keys(properties), 'currentHandler'],
    properties: {
      ...properties,
      currentHandler: {
        type: 'boolean',
        description: '是否当前招募环节负责人；尚未指定时全部false。',
        examples: [true],
      },
    },
  },
  examples: [[handlerExample], []],
};
export const handlerBody = {
  type: 'object',
  additionalProperties: false,
  required: ['projectId', 'handlerUserId'],
  description: '指定唯一招募负责人；允许本人及重复指定，不支持清空。',
  properties: {
    projectId: {
      type: 'integer',
      minimum: 1,
      maximum: 2147483647,
      description: '必填项目ID，32位正整数。',
      examples: [3001],
    },
    handlerUserId: {
      type: 'string',
      format: 'uuid',
      description: '必填候选用户UUID，须ACTIVE；统一账号自带PM，无需候选当前会话切到PM。',
      examples: [handlerExample.userId],
    },
  },
  examples: [{ projectId: 3001, handlerUserId: handlerExample.userId }],
};
export function handlerSchema(write: boolean): FastifySchema {
  return {
    tags: ['Project'],
    operationId: write ? 'changeExpertRecruitmentHandler' : 'getExpertRecruitmentHandlerCandidates',
    summary: write ? '指定或更换招募执行专家环节负责人' : '查询招募执行专家环节负责人候选人',
    description:
      '仅当前PM会话且为该项目ASSIGNED主策略官可操作；创建人、协作负责人和被替换策略官不能代办。不按项目当前节点限制，不推进节点或项目版本。' +
      (write
        ? '项目锁串行更新任职，管理主线轮次和PENDING事件同事务，故障全部回滚。交接不是完成招募；真实投递归14，跨领域支线重算归04。'
        : '只读一致快照；统一账号按ACTIVE筛选，不按旧User.role或组织归属筛选。'),
    security: [{ webSession: [] }, { desktopSession: [] }],
    ...(write
      ? { body: handlerBody }
      : {
          querystring: {
            ...managerCandidatesQuery,
            description: '必填项目ID，无请求体，无分页或关键词。',
            properties: { projectId: managerCandidatesQuery.properties.projectId },
            examples: [{ projectId: '3001' }],
          },
        }),
    response: {
      200: {
        ...resultSchema(
          write ? { type: 'null', description: '成功无业务数据，固定null。' } : handlerCandidates,
        ),
        examples: [{ code: 200, message: '操作成功', data: write ? null : [handlerExample] }],
      },
      ...Object.fromEntries(
        Object.entries({
          400: '参数或候选无效',
          401: '会话失效',
          403: '非当前PM主策略官或来源不可信',
          404: '项目不存在',
          409: '任职并发变化',
          500: '事务内部失败',
          503: '数据库不可用',
        }).map(([code, message]) => [
          code,
          {
            ...resultSchema({ type: 'null', description: '失败无业务数据，固定null。' }),
            description: message,
            examples: [{ code: Number(code), message, data: null }],
          },
        ]),
      ),
    },
  };
}
