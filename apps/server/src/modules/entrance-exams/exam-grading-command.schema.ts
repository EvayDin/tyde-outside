import type { FastifySchema } from 'fastify';
import { resultSchema } from '../auth/auth.schema.js';
const id = (description: string) => ({
  type: 'integer',
  minimum: 1,
  maximum: 2147483647,
  description,
});
const optionalText = (description: string) => ({
  type: 'string',
  nullable: true,
  maxLength: 5000,
  description,
});
export const manualGradingExample = {
  projectId: 3001,
  examId: 5001,
  attemptId: 11001,
  gradingRecordId: 10001,
  conclusionSummary: '答案完整，本轮通过',
  items: [{ questionId: 8001, correctness: 'CORRECT', gradingOpinion: '步骤正确' }],
};
export const gradingSubmitExample = {
  attemptId: 11001,
  gradingRecordId: 10001,
  recordStatus: 'COMPLETED',
  score: 20,
  roundResult: 'ADMITTED',
  gradingStatus: 'COMPLETED',
  finalResult: 'ADMITTED',
};
export const manualGradingSchema: FastifySchema = {
  tags: ['准入考试阅卷'],
  summary: '提交手动阅卷结果',
  operationId: 'submitEntranceExamManualGrading',
  description:
    '已登录三角色账号仅在该考生绑定版本的本轮人工阅卷人池内可提交，管理详情资格不代替写权限。须已交卷且前轮全部完成，允许关闭考试和历史版本。完整判定实际试卷全部题目，正确题分数相加后与绑定版本准入线比较；结果一次锁定，重复提交409。同事务激活紧接下一轮、按轮次结论投票裁决、普通有效接单准入创建PENDING_CONFIRM成员及结算阅卷待办。下一轮AUTO写provider=mock待派发事实，由显式mock命令领取执行；050—052提供失败重试、人工补偿及专用HMAC回调，不连接真实Agent。事件尚未实际投递，转项审批由12消费裁决事实，完整多来源卡片快照刷新待回补。',
  body: {
    type: 'object',
    additionalProperties: false,
    description: '提交一轮完整人工判定，字段均按实际应试记录定位。',
    required: ['projectId', 'examId', 'attemptId', 'gradingRecordId', 'items'],
    properties: {
      projectId: id('考试所属项目ID。'),
      examId: id('考试ID，可为已关闭考试。'),
      attemptId: id('已交卷应试记录ID。'),
      gradingRecordId: id('该应试本轮人工判卷记录ID。'),
      conclusionSummary: optionalText(
        '本轮总结，最多5000字；省略/null/空白按得分与本轮结论自动生成。',
      ),
      items: {
        type: 'array',
        minItems: 1,
        maxItems: 500,
        description: '实际试卷全部题目的判定，1至500道，不得重复、遗漏或混入其他题。',
        items: {
          type: 'object',
          additionalProperties: false,
          description: '一道题的人工判定。',
          required: ['questionId', 'correctness'],
          properties: {
            questionId: id('实际作答试卷的题目ID，必须已有同应试答案与本轮逐题记录。'),
            correctness: {
              type: 'string',
              enum: ['CORRECT', 'INCORRECT'],
              description: 'CORRECT=正确计该题全分；INCORRECT=错误计0分；不允许PENDING或部分分。',
            },
            gradingOpinion: optionalText(
              '本题意见，最多5000字；省略/null/空白保存null，其余去除首尾空白。',
            ),
          },
        },
      },
    },
    examples: [manualGradingExample],
  },
  response: {
    200: {
      ...resultSchema({
        type: 'object',
        additionalProperties: false,
        description: '已锁定本轮的得分和考试整体结果；不跨轮累计得分。',
        required: Object.keys(gradingSubmitExample),
        properties: {
          attemptId: id('应试记录ID。'),
          gradingRecordId: id('本轮执行记录ID。'),
          recordStatus: {
            type: 'string',
            enum: ['COMPLETED'],
            description: 'COMPLETED=本轮已提交并锁定。',
          },
          score: {
            type: 'number',
            minimum: 0,
            description: '本轮卷面得分，最多两位小数，0分保留。',
          },
          roundResult: {
            type: 'string',
            enum: ['ADMITTED', 'ELIMINATED'],
            description:
              '本轮票：ADMITTED=达到绑定版本准入线，ELIMINATED=未达到；不等于最终考试结论。',
          },
          gradingStatus: {
            type: 'string',
            enum: ['IN_PROGRESS', 'COMPLETED'],
            description: 'IN_PROGRESS=后续轮次尚未完成；COMPLETED=全部轮次完成并裁决。',
          },
          finalResult: {
            type: 'string',
            enum: ['PENDING', 'ADMITTED', 'ELIMINATED'],
            description:
              '最终结论：PENDING=待定，ADMITTED=准入，ELIMINATED=淘汰。按绑定版本多数票/人工优先及平票规则裁决，不以当前轮替代整体结果。',
          },
        },
      }),
      description: '人工提交与必要副作用在同一事务成功。',
      examples: [{ code: 200, message: '操作成功', data: gradingSubmitExample }],
    },
    ...Object.fromEntries(
      [400, 401, 403, 404, 409, 500, 503].map((code) => [
        code,
        {
          ...resultSchema({ type: 'null', description: '失败时业务数据固定为null。' }),
          description: `${code}：${({ 400: '未交卷、轮次未开放、前轮未完成或逐题判定/来源不完整', 401: '会话失效或未登录', 403: '不在本轮人工池或请求来源不可信', 404: '考试、应试或执行记录不存在或归属不符', 409: '重复提交、下一轮状态或准入成员来源并发冲突', 500: '绑定配置或准入接单来源损坏，事务回滚', 503: '数据库等依赖不可用' } as Record<number, string>)[code]}。`,
          examples: [{ code, message: '操作失败', data: null }],
        },
      ]),
    ),
  },
};
