import type { FastifySchema } from 'fastify';
import { resultSchema } from '../auth/auth.schema.js';
import { examFileSnapshots } from './exam-query.schema.js';
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
const roundResult = {
  type: 'string',
  nullable: true,
  enum: ['ADMITTED', 'ELIMINATED', null],
  description: '本轮结论：ADMITTED=通过，ELIMINATED=淘汰；尚无结论为null，不等于最终考试结果。',
};
const summary = {
  type: 'object',
  additionalProperties: false,
  description:
    '考生绑定版本的一轮配置及该考生真实执行记录；无执行记录时各结果字段为null，不创建任务。',
  required: [
    'gradingRoundId',
    'gradingRecordId',
    'roundNo',
    'gradingMode',
    'status',
    'score',
    'roundResult',
    'conclusionSummary',
    'errorMessage',
  ],
  properties: {
    gradingRoundId: id('考生绑定版本中的轮次配置ID。'),
    gradingRecordId: id('该考生本轮执行记录ID；尚未生成时null。', true),
    roundNo: id('判卷轮次序号，从1开始。'),
    gradingMode: {
      type: 'string',
      enum: ['AUTO', 'MANUAL'],
      description: 'AUTO=自动工具判卷，MANUAL=人工判卷。',
    },
    status: {
      type: 'string',
      nullable: true,
      enum: ['WAITING', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', null],
      description:
        'WAITING=等待前轮完成，PENDING=待执行，PROCESSING=处理中，COMPLETED=已完成，FAILED=失败；无执行记录时null。',
    },
    score: {
      type: 'number',
      nullable: true,
      description: '本轮得分，最多两位小数；无分数时null，0分保留；不跨轮相加。',
    },
    roundResult,
    conclusionSummary: text('本轮结论总结；未填写/无记录时null。', true),
    errorMessage: text('自动阅卷失败原因；无错误或无记录时null，沿存储原值展示。', true),
  },
};
const firstRound = {
  gradingRoundId: 9001,
  gradingRecordId: 10001,
  roundNo: 1,
  gradingMode: 'MANUAL',
  status: 'COMPLETED',
  score: 0,
  roundResult: 'ELIMINATED',
  conclusionSummary: '本轮未通过',
  errorMessage: null,
};
export const examGradingDetailExample = {
  examId: 5001,
  attemptId: 11001,
  candidateUid: 'candidate-uid',
  candidateName: '小明(王小明)',
  passScore: 12,
  gradingStatus: 'IN_PROGRESS',
  finalResult: 'PENDING',
  rounds: [
    firstRound,
    {
      gradingRoundId: 9002,
      gradingRecordId: null,
      roundNo: 2,
      gradingMode: 'AUTO',
      status: null,
      score: null,
      roundResult: null,
      conclusionSummary: null,
      errorMessage: null,
    },
  ],
  selectedRound: firstRound,
  questions: [
    {
      questionId: 8001,
      sequenceNo: 1,
      questionContent: '请说明判断依据',
      questionFiles: null,
      score: 20,
      referenceAnswer: '示例参考答案',
      referenceFiles: null,
      answerId: 12001,
      answerContent: '考生答案',
      answerFiles: [
        {
          uploadedFileId: '00000000-0000-4000-8000-000000000001',
          fileName: 'answer.txt',
          objectKey: 'entrance-exam-attachment/example.txt',
          extension: 'txt',
          contentType: 'text/plain',
          fileSize: 20,
          fileHash: null,
        },
      ],
      answeredFlag: true,
      correctness: 'INCORRECT',
      gradingOpinion: '依据不完整',
    },
  ],
};
export const examGradingDetailSchema: FastifySchema = {
  operationId: 'getEntranceExamGradingDetail',
  summary: '查询考生阅卷详情',
  tags: ['EntranceExam'],
  description:
    '当前PM须为项目生效主策略官或招募协作负责人；NAVIGATOR须在项目任一未删除考试的历史人工轮次阅卷池内。按当前会话角色及真实业务关系鉴权，EXPERT/OPS不开放。项目须已发布，考试须未删除且属于该项目，允许CLOSED考试；应试须属于该考试并已绑定版本及试卷，否则404/400。试卷、准入线和轮次始终读取该考生绑定版本，编辑后不混入新版本。已进入但未交卷也可查看，finalResult沿存储值（通常PENDING），不自动创建答案/判卷任务或派发Agent。roundNo省略/null默认第一轮，不存在返回400；无记录的轮次结果为null，未作答题answeredFlag=false，其余答案及判定为null。使用RepeatableRead只读事务，重复调用无副作用。逐题答案及判定来自真实存储；交卷与阅卷写入口尚未接入。返回附件快照不额外授予文件下载权限。Web使用Cookie并校验来源，桌面使用Bearer，不混用。',
  security: [{ webSession: [] }, { desktopSession: [] }],
  body: {
    type: 'object',
    additionalProperties: false,
    description: '考生应试记录与选中判卷轮次定位参数。',
    required: ['projectId', 'examId', 'attemptId'],
    properties: {
      projectId: id('必填已发布项目ID。'),
      examId: id('必填该项目未删除考试ID。'),
      attemptId: id('必填该考试下应试记录ID，须已绑定版本和试卷。'),
      roundNo: id('可选判卷轮次序号；省略/null取1，非空须为正整数并存在于应试绑定版本中。', true),
    },
    examples: [{ projectId: 3001, examId: 5001, attemptId: 11001, roundNo: 1 }],
  },
  response: {
    200: resultSchema({
      type: 'object',
      additionalProperties: false,
      description: '考生实际作答的历史卷面和所选轮次逐题判卷详情。',
      required: Object.keys(examGradingDetailExample),
      properties: {
        examId: id('考试ID。'),
        attemptId: id('应试记录ID。'),
        candidateUid: text('应试记录平台UID快照。'),
        candidateName: text(
          '实时昵称(真实姓名)，缺失依次回退昵称、真实姓名、应试快照名、快照UID；不修改快照。',
        ),
        passScore: { type: 'number', description: '考生绑定考试版本的准入线，最多两位小数。' },
        gradingStatus: {
          type: 'string',
          enum: ['NOT_STARTED', 'PENDING', 'IN_PROGRESS', 'COMPLETED'],
          description:
            '整体阅卷进度：NOT_STARTED=未交卷，PENDING=待阅卷，IN_PROGRESS=阅卷中，COMPLETED=阅卷完成。',
        },
        finalResult: {
          type: 'string',
          enum: ['PENDING', 'ADMITTED', 'ELIMINATED'],
          description:
            '最终考试结论：PENDING=尚无最终结果（含未交卷），ADMITTED=考试通过，ELIMINATED=淘汰；考试通过不表示已入项。',
        },
        rounds: {
          type: 'array',
          description: '考生绑定版本的全部轮次，按roundNo升序；不因缺执行记录而省略配置轮次。',
          items: summary,
        },
        selectedRound: summary,
        questions: {
          type: 'array',
          description:
            '仅实际分配试卷的题目，按sequenceNo升序；合并该考生答案及所选轮次判定，空卷为空数组。',
          items: {
            type: 'object',
            additionalProperties: false,
            description:
              '一道题的题干/参考答案、考生答案及所选轮次判定；JSON快照保留未知历史字段。',
            required: Object.keys(examGradingDetailExample.questions[0]!),
            properties: {
              questionId: id('题目ID。'),
              sequenceNo: id('卷内题序，从1开始。'),
              questionContent: text('题干富文本，仅附件题可为null。', true),
              questionFiles: examFileSnapshots,
              score: { type: 'number', description: '本题分值，最多两位小数。' },
              referenceAnswer: text('参考答案富文本，未配置为null。', true),
              referenceFiles: examFileSnapshots,
              answerId: id('该考生该题的答案记录ID；无答案时null。', true),
              answerContent: text('考生文本答案；仅附件或未作答时null。', true),
              answerFiles: examFileSnapshots,
              answeredFlag: {
                type: 'boolean',
                description:
                  '答案记录answeredFlag为true才为true；无答案记录为false，不根据文本或附件重新推断。',
              },
              correctness: {
                type: 'string',
                nullable: true,
                enum: ['PENDING', 'CORRECT', 'INCORRECT', null],
                description:
                  '所选轮次本题判定：PENDING=待判，CORRECT=正确，INCORRECT=错误；尚无逐题判卷记录为null，不伪造PENDING。',
              },
              gradingOpinion: text('所选轮次本题阅卷意见；未填写或无逐题记录为null。', true),
            },
          },
        },
      },
      examples: [examGradingDetailExample],
    }),
    ...Object.fromEntries(
      [400, 401, 403, 404, 500, 503].map((code) => [
        code,
        {
          ...resultSchema({ type: 'null', description: '失败时业务数据固定null。' }),
          description: `${code}：${({ 400: '参数非法、项目未发布、考生未绑定试卷或轮次不存在', 401: '未登录或会话失效', 403: '当前角色、任职、阅卷资格或请求来源不符', 404: '项目、考试或应试记录不存在或归属不符', 500: '绑定版本/试卷异常或服务内部错误', 503: '服务依赖不可用' } as Record<number, string>)[code]}。`,
          examples: [{ code, message: '操作失败', data: null }],
        },
      ]),
    ),
  },
};
