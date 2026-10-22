import type { FastifySchema } from 'fastify';
import { resultSchema } from '../auth/auth.schema.js';
const uid = '00000000-0000-4000-8000-000000000001';
const localTime = '2026-10-19 18:00:00';
const str = (description: string, example: string | null, maxLength?: number) => ({
  type: 'string',
  nullable: true,
  description,
  examples: [example],
  ...(maxLength ? { maxLength } : {}),
});
const integer = (description: string, example: number | null) => ({
  type: 'integer',
  nullable: true,
  minimum: -2147483648,
  maximum: 2147483647,
  description,
  examples: [example],
});
const choice = (description: string, values: string[], example: string | null) => ({
  ...str(description, example),
  enum: [...values, null],
});
export const projectAttachmentBody = {
  type: 'object',
  additionalProperties: false,
  description: '附件完整集合中的一项；新增须用途/对象Key/凭证，保留已有附件可只传id或objectKey。',
  properties: {
    id: integer(
      '已有附件ID；可选/null，非null时必须属于当前项目且ACTIVE，此时忽略用途/Key/凭证，排序可更新。',
      501,
    ),
    attachmentType: choice(
      '新增附件条件必填：STANDARD_REFERENCE=标准参考、CASE=实操案例、OTHER=其他。保留已有附件时不修改用途。',
      ['STANDARD_REFERENCE', 'CASE', 'OTHER'],
      'STANDARD_REFERENCE',
    ),
    objectKey: str(
      '新增时条件必填，登录上传PROJECT_ATTACHMENT返回的对象Key；也可用当前有效附件的Key保留，无需重复凭证。去除首尾空白。',
      'project-attachment/2026/10/19/example.pdf',
      500,
    ),
    uploadToken: str(
      '新增时条件必填，一次性上传认领凭证；必须为当前用户上传，已认领/过期/文件不存在拒绝；不返回草稿响应。',
      'a'.repeat(43),
      128,
    ),
    sortNo: {
      ...integer(
        '展示顺序，可选/null：新增默认0，保留旧附件时不传保持原值；整数0—2147483647，越小越靠前。',
        0,
      ),
      minimum: 0,
    },
  },
  examples: [
    { id: 501 },
    {
      attachmentType: 'STANDARD_REFERENCE',
      objectKey: 'project-attachment/2026/10/19/example.pdf',
      uploadToken: 'a'.repeat(43),
      sortNo: 0,
    },
  ],
};
export const projectPublishExample = {
  operation: 'CREATE_PROJECT',
  requesterType: 'INDIVIDUAL',
  requesterId: uid,
  projectName: '商品图片分类标注',
  projectDescription: '按规范标注商品类目',
  categoryLevel1Id: 11,
  categoryLevel2Id: 21,
  categoryLevel3Ids: [31],
  difficultyLevel: 'MEDIUM',
  projectQuantity: 10000,
  quantityUnit: '张',
  deadline: '2099-12-31 18:00:00',
  requiredHeadcount: 20,
  educationRequirement: 'BACHELOR',
  employmentType: 'PART_TIME',
  experienceRequirement: '有图片分类经验',
  workSummary: '判断图片类目',
  specialRequirement: null,
  mandatoryRequirement: '通过项目准入测试',
  standardContent: '分类结果须与主体商品一致',
  standardLink: null,
  attachments: [],
};
export const projectSaveBody = {
  type: 'object',
  additionalProperties: false,
  required: ['operation'],
  description:
    '当前完整表单快照，非部分更新；字段省略/null清空原值，学历回落BACHELOR；附件省略/null保持原附件。发布校验按旧Service实际规则，见字段说明。',
  properties: {
    operation: {
      type: 'string',
      enum: ['SAVE_DRAFT', 'CREATE_PROJECT'],
      description: '必填操作：SAVE_DRAFT=保存草稿，仅校验已填值；CREATE_PROJECT=完整校验并发布。',
      examples: ['SAVE_DRAFT'],
    },
    requesterType: choice(
      '可省略/null，以当前账号为准；统一账号传INDIVIDUAL；ORGANIZATION需求方选择尚未开放，返回400。',
      ['INDIVIDUAL', 'ORGANIZATION'],
      'INDIVIDUAL',
    ),
    requesterId: {
      ...str(
        '可省略/null，当前需求方用户ID；传入须等于当前用户，新库为UUID，旧数值ID不可混用。',
        uid,
      ),
      format: 'uuid',
    },
    projectName: str(
      '项目名称；发布条件必填，同需求方已发布未删除项目不能重名。trim后空白转null，最多128字符。',
      '商品图片分类标注',
      128,
    ),
    projectDescription: str(
      '项目背景/目标/交付描述；可选，trim后空白转null。旧字段文案称发布必填，实际Service未强制，本接口保留实际校验。',
      '按规范标注商品类目',
    ),
    categoryLevel1Id: integer(
      '独立一级分类ID；发布条件必填，须存在且ENABLED、categoryLevel=1；省略/null清空。',
      11,
    ),
    categoryLevel2Id: integer(
      '独立二级分类ID；发布条件必填，须存在且ENABLED、categoryLevel=2；省略/null清空。',
      21,
    ),
    categoryLevel3Ids: {
      type: 'array',
      nullable: true,
      maxItems: 20,
      description:
        '独立三级标签ID，最多20项，不允许重复/null元素，顺序保留；省略/null清空，发布至少一项，须全部ENABLED且级别3。',
      items: {
        type: 'integer',
        minimum: 1,
        maximum: 2147483647,
        description: '单个启用三级分类ID，正整数。',
        examples: [31],
      },
      examples: [[31], []],
    },
    difficultyLevel: choice(
      '项目难度，发布条件必填：EASY=简单、MEDIUM=中等、HARD=困难；省略/null清空。',
      ['EASY', 'MEDIUM', 'HARD'],
      'MEDIUM',
    ),
    projectQuantity: {
      type: 'number',
      nullable: true,
      description:
        '项目量级，单位见quantityUnit；发布条件必填，填写时须大于0。数据库DECIMAL(20,4)，超过4位小数按数据库规则舍入；极大JSON数字精度兼容待验收。省略/null清空。',
      examples: [10000],
    },
    quantityUnit: str(
      '项目量级单位，发布条件必填，trim后空白转null，最多30字符，例如张/条/帧。',
      '张',
      30,
    ),
    deadline: {
      ...str(
        '截止时间，发布条件必填，上海时间yyyy-MM-dd HH:mm:ss，无时区后缀，须晚于草稿创建时间；首次保存以当前时间校验，省略/null清空。',
        '2099-12-31 18:00:00',
      ),
      pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$',
    },
    requiredHeadcount: integer(
      '需求人数，单位人；发布条件必填，填写时必须大于0的32位整数；省略/null清空。',
      20,
    ),
    educationRequirement: choice(
      '最低学历：PHD=博士、MASTER=研究生、BACHELOR=本科、COLLEGE=大专、BELOW_COLLEGE=大专以下；省略/null默认BACHELOR，含已有草稿更新。',
      ['PHD', 'MASTER', 'BACHELOR', 'COLLEGE', 'BELOW_COLLEGE'],
      'BACHELOR',
    ),
    employmentType: choice(
      '用工类型，发布条件必填：FULL_TIME=全职、PART_TIME=兼职、UNLIMITED=不限；省略/null清空。',
      ['FULL_TIME', 'PART_TIME', 'UNLIMITED'],
      'PART_TIME',
    ),
    experienceRequirement: str(
      '经验要求，可选；trim后空白转null，省略/null清空。',
      '有图片分类经验',
    ),
    workSummary: str(
      '工作简介，可选；旧文案称发布必填，实际Service未强制，保留实际校验；trim后空白转null，省略/null清空。',
      '判断图片类目',
    ),
    specialRequirement: str('特殊要求，可选；trim后空白转null，省略/null清空。', null),
    mandatoryRequirement: str(
      '必备要求；发布条件必填，按旧Service实际规则校验；trim后空白转null，省略/null清空。',
      '通过项目准入测试',
    ),
    standardContent: str(
      '标准正文/作业规范；发布条件必填。旧注释称与链接二选一，但实际Service要求正文，链接不能替代；trim后空白转null，省略/null清空。',
      '分类结果须与主体商品一致',
    ),
    standardLink: str(
      '外部标准文档链接，可选，不验证URL可访问性；最多2000字符，trim后空白转null，省略/null清空，不能代替发布所需正文。',
      null,
      2000,
    ),
    attachments: {
      type: 'array',
      nullable: true,
      description:
        '附件完整集合，省略/null保留、空数组移除全部、非空数组保留所列旧附件并认领新附件；未列旧附件标记DELETED并释放台账，不立即删除对象。所有变化与项目同事务。',
      items: projectAttachmentBody,
      examples: [[], [projectAttachmentBody.examples[1]]],
    },
    versionNo: integer(
      '更新或发布已有草稿时条件必填，须等于查询得到的版本；不传返回400，过期返回409。首次保存可省略；首次版本0，之后每次成功写入递增1。',
      0,
    ),
  },
  examples: [{ operation: 'SAVE_DRAFT' }, projectPublishExample],
};
const node = choice(
  '项目当前节点；草稿为null，发布为RECRUIT_PROJECT_MANAGER=招募策略官；其余节点由后续推进：PRODUCTION_PLAN=生产计划、ENTRANCE_EXAM=准入考试、STANDARD_TRAINING=标准培训、RECRUIT_EXECUTION_EXPERT=招募执行专家、PERSONNEL_MANAGEMENT=人员管理、PRODUCTION_TASK=生产任务、COMPLETED=结项；本接口不招募或创建生产计划。',
  [
    'RECRUIT_PROJECT_MANAGER',
    'PRODUCTION_PLAN',
    'ENTRANCE_EXAM',
    'STANDARD_TRAINING',
    'RECRUIT_EXECUTION_EXPERT',
    'PERSONNEL_MANAGEMENT',
    'PRODUCTION_TASK',
    'COMPLETED',
  ],
  null,
);
const timeField = (description: string, nullable = false) => ({
  type: 'string',
  ...(nullable ? { nullable: true } : {}),
  description: `${description}，上海时间yyyy-MM-dd HH:mm:ss，无时区后缀${nullable ? '；尚未发生为null' : ''}。`,
  examples: [nullable ? null : localTime],
});
export const projectMutation = {
  type: 'object',
  additionalProperties: false,
  description: '实际保存/发布结果，不隐式创建策略官任职、生产计划、成员或事件。',
  required: [
    'id',
    'projectNo',
    'operation',
    'status',
    'currentNodeCode',
    'versionNo',
    'updatedAt',
    'publishedAt',
  ],
  properties: {
    id: {
      type: 'integer',
      minimum: 1,
      description: '新库项目正整数ID，保持旧JSON数值类型，不与旧库ID互通。',
      examples: [3001],
    },
    projectNo: {
      type: 'string',
      description:
        '首次保存生成且不再改变的唯一平台编号，PRJ+上海时间yyyyMMddHHmmss+8位大写随机后缀。',
      examples: ['PRJ20261019180000A1B2C3D4'],
    },
    operation: projectSaveBody.properties.operation,
    status: {
      type: 'string',
      enum: ['DRAFT', 'PUBLISHED'],
      description: '写入后状态：DRAFT=草稿、PUBLISHED=已发布。',
      examples: ['DRAFT'],
    },
    currentNodeCode: node,
    versionNo: {
      type: 'integer',
      minimum: 0,
      description: '最新版本，首次写入0，每次成功更新递增1；更新草稿须回传。',
      examples: [0],
    },
    updatedAt: timeField('本次保存完成时间'),
    publishedAt: timeField('正式发布时间', true),
  },
  examples: [
    {
      id: 3001,
      projectNo: 'PRJ20261019180000A1B2C3D4',
      operation: 'SAVE_DRAFT',
      status: 'DRAFT',
      currentNodeCode: null,
      versionNo: 0,
      updatedAt: localTime,
      publishedAt: null,
    },
  ],
};
export const projectAttachmentResponse = {
  type: 'object',
  additionalProperties: false,
  description: '当前ACTIVE附件，仅返回服务端台账元数据，不含上传凭证。',
  required: [
    'id',
    'attachmentType',
    'fileName',
    'objectKey',
    'extension',
    'contentType',
    'fileSize',
    'fileHash',
    'sortNo',
    'status',
  ],
  properties: {
    id: { type: 'integer', description: '项目附件正整数ID，用于后续保留附件。', examples: [501] },
    attachmentType: {
      type: 'string',
      enum: ['STANDARD_REFERENCE', 'CASE', 'OTHER'],
      description: '用途：STANDARD_REFERENCE=标准参考、CASE=实操案例、OTHER=其他。',
      examples: ['STANDARD_REFERENCE'],
    },
    fileName: {
      type: 'string',
      description: '台账原始文件名，不信任客户端元数据。',
      examples: ['standard.pdf'],
    },
    objectKey: {
      type: 'string',
      description: '台账对象Key，读取须经文件代理鉴权，不是公开URL。',
      examples: ['project-attachment/2026/10/19/example.pdf'],
    },
    extension: { type: 'string', description: '台账扩展名，小写且不含点。', examples: ['pdf'] },
    contentType: { type: 'string', description: '台账MIME类型。', examples: ['application/pdf'] },
    fileSize: { type: 'integer', description: '台账文件大小，单位字节。', examples: [123] },
    fileHash: {
      type: 'string',
      description: '台账SHA-256摘要，64位十六进制。',
      examples: ['a'.repeat(64)],
    },
    sortNo: { type: 'integer', description: '展示顺序，升序，相同按附件ID升序。', examples: [0] },
    status: {
      type: 'string',
      enum: ['ACTIVE'],
      description: '附件状态，草稿接口仅返回ACTIVE=有效附件。',
      examples: ['ACTIVE'],
    },
  },
  examples: [
    {
      id: 501,
      attachmentType: 'STANDARD_REFERENCE',
      fileName: 'standard.pdf',
      objectKey: 'project-attachment/2026/10/19/example.pdf',
      extension: 'pdf',
      contentType: 'application/pdf',
      fileSize: 123,
      fileHash: 'a'.repeat(64),
      sortNo: 0,
      status: 'ACTIVE',
    },
  ],
};
const form = projectSaveBody.properties;
const formFields = Object.fromEntries(
  Object.entries(form).filter(
    ([name]) =>
      !['operation', 'requesterType', 'requesterId', 'attachments', 'versionNo'].includes(name),
  ),
);
// 请求中的三级分类顺序与名称快照均持久化；响应无需operation/uploadToken。
export const projectDraftDetail = {
  type: 'object',
  nullable: true,
  additionalProperties: false,
  description:
    '本人完整草稿；无草稿为null。尚未涉及生产量级要求，不返回productionRequirements字段。',
  properties: {
    ...formFields,
    id: projectMutation.properties.id,
    projectNo: projectMutation.properties.projectNo,
    requesterType: {
      type: 'string',
      enum: ['INDIVIDUAL', 'ORGANIZATION'],
      description: '需求方账号类型：INDIVIDUAL=个人、ORGANIZATION=组织。',
      examples: ['INDIVIDUAL'],
    },
    requesterId: {
      type: 'string',
      format: 'uuid',
      description: '本人需求方用户ID，新库UUID字符串。',
      examples: [uid],
    },
    requesterName: {
      type: 'string',
      description: '需求方名称；个人查询时按当前昵称(姓名)回填，组织使用保存时的名称快照。',
      examples: ['小明(王小明)'],
    },
    categoryLevel1Name: str('一级分类名称快照；未选择为null，不随字典改名而变化。', null),
    categoryLevel2Name: str('二级分类名称快照；未选择为null。', null),
    categoryLevel3Ids: {
      type: 'array',
      description: '三级分类ID，按保存时选择顺序；未选为空数组。',
      items: { type: 'integer', description: '三级分类ID，正整数。', examples: [31] },
      examples: [[]],
    },
    categoryLevel3Names: {
      type: 'array',
      description: '三级分类名称快照，与ID一一对应，未选为空数组。',
      items: { type: 'string', description: '三级分类名称快照。', examples: ['商品标注'] },
      examples: [[]],
    },
    status: projectMutation.properties.status,
    currentNodeCode: node,
    versionNo: projectMutation.properties.versionNo,
    creatorUid: { type: 'string', description: '创建人UID，来自认证身份。', examples: [uid] },
    creatorName: str('沿用旧创建服务草稿响应，该字段未填充，固定null；不用于权限判断。', null),
    createdAt: timeField('草稿首次创建时间'),
    updatedAt: timeField('草稿最近保存时间'),
    attachments: {
      type: 'array',
      description: '当前有效附件，按sortNo、id升序；没有附件为空数组。',
      items: projectAttachmentResponse,
      examples: [[], projectAttachmentResponse.examples],
    },
  },
};
const draftProperties = projectDraftDetail.properties;
export const projectDraftExample = {
  ...Object.fromEntries(Object.keys(formFields).map((name) => [name, null])),
  id: 3001,
  projectNo: 'PRJ20261019180000A1B2C3D4',
  requesterType: 'INDIVIDUAL',
  requesterId: uid,
  requesterName: '小明(王小明)',
  categoryLevel1Name: null,
  categoryLevel2Name: null,
  categoryLevel3Ids: [],
  categoryLevel3Names: [],
  educationRequirement: 'BACHELOR',
  status: 'DRAFT',
  currentNodeCode: null,
  versionNo: 0,
  creatorUid: uid,
  creatorName: null,
  createdAt: localTime,
  updatedAt: localTime,
  attachments: [],
};
export const projectDraftResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['hasDraft', 'draft'],
  description: '本人唯一未删除草稿查询结果。',
  properties: {
    hasDraft: {
      type: 'boolean',
      description: '是否存在本人未删除草稿；不存在为false且draft=null。',
      examples: [false],
    },
    draft: {
      ...projectDraftDetail,
      required: Object.keys(draftProperties),
      examples: [projectDraftExample, null],
    },
  },
  examples: [
    { hasDraft: false, draft: null },
    { hasDraft: true, draft: projectDraftExample },
  ],
};
export function projectCreationSchema(
  operationId: string,
  summary: string,
  response: Record<string, unknown>,
): FastifySchema {
  const errors = {
    400: '参数、必填字段、分类、数值、截止时间或附件不合法，或已有草稿缺versionNo。',
    401: '未登录或会话失效。',
    403: '需求方非本人、附件非本人上传/凭证错误，或请求来源不可信。',
    404: '本人需求方用户不存在。',
    409: '草稿版本冲突、同名项目、附件已认领/凭证过期或数据约束冲突。',
    500: '内部处理失败。',
    503: '数据库或服务暂不可用。',
  };
  return {
    operationId,
    summary,
    tags: ['Project'],
    description:
      '按旧Controller/全局Security/Service实际行为：只要求有效登录及本人数据范围，不额外要求NAVIGATOR；旧文案中的领航员限制与代码不一致。注册自带三角色，登录默认EXPERT，其他管理接口继续当前会话角色校验。Web用HttpOnly Cookie，写请求校验来源；普通API/桌面用Bearer，禁止凭据混用。' +
      (operationId === 'getCurrentProjectDraft'
        ? '无请求体，只读本人唯一未删除草稿，不产生写入副作用；不存在时hasDraft=false、draft=null。分类返回名称快照，附件仅返回ACTIVE且不含上传凭证。'
        : '保存锁创建人、检查草稿版本，项目/分类快照/附件认领释放同事务；发布校验完整性和同名项目后进入招募策略官节点，不代替后续招募。完整快照语义和实际必填规则见字段。首次重复请求若已有草稿但没回传版本返回400；发布后不再有草稿，新请求可创建下一份草稿。此接口不声明发布重试幂等键。'),
    security: [{ webSession: [] }, { desktopSession: [] }],
    response: {
      200: resultSchema(response),
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
