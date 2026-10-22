import { expertTasksBody, expertTasksResponse } from './expert-task.schema.js';
import type { ExpertTaskQuery } from './expert-task-query.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { API_PREFIX } from '@tyde/shared';
import type { Config } from '../../config/index.js';
import type { AuthPrincipal, AuthService } from '../auth/auth.service.js';
import { AuthError } from '../auth/auth.error.js';
import { validateTransport } from '../auth/security.js';
import { ExpertAssignmentService } from './expert-assignment.service.js';
import {
  expertSchema,
  myProjectsResponse,
  myProjectsQuery,
  assignmentDetailQuery,
  assignmentDetailResponse,
  projectOwnerCandidatesResponse,
} from './expert-assignment.schema.js';
export async function expertAssignmentRoutes(
  parent: FastifyInstance,
  service: ExpertAssignmentService,
  auth: AuthService,
  config: Config,
) {
  await parent.register(async (app) => {
    const identities = new WeakMap<FastifyRequest, AuthPrincipal>();
    app.addHook('onRequest', async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (
        !req.headers['x-tyde-client'] &&
        !req.headers.origin &&
        !req.headers.cookie &&
        !Object.keys(req.headers).some((k) => k.startsWith('sec-fetch-'))
      )
        req.headers['x-tyde-client'] = 'desktop';
      let client;
      try {
        client = validateTransport(req.headers, req.method, [
          ...config.webOrigins,
          ...config.desktopOrigins,
        ]);
      } catch {
        throw new AuthError(403, 'ORIGIN_NOT_ALLOWED', '请求来源或会话凭据组合不可信');
      }
      const token =
        client === 'desktop'
          ? req.headers.authorization?.replace(/^Bearer /, '')
          : req.cookies[config.cookieSecure ? '__Host-tyde_session' : 'tyde_session'];
      identities.set(req, await auth.authenticate(token, client));
    });
    app.post<{ Body: ExpertTaskQuery }>(
      `${API_PREFIX}/expert-assignments/my-tasks`,
      {
        schema: {
          ...expertSchema(
            'myExpertTasks',
            '查询当前用户需要处理的执行专家任务卡片',
            '本人分配及有效多组织身份聚合；部分迁移，生产/审批/转项待对应任务接回，未迁移写入口按钮为false。',
            expertTasksResponse,
          ),
          body: expertTasksBody,
        },
      },
      async (req) => ({
        code: 200,
        message: '操作成功',
        data: await service.myTasks(req.body, identities.get(req)!),
      }),
    );
    app.get<{ Querystring: { assignmentId: string } }>(
      `${API_PREFIX}/expert-assignments/project-owner-candidates`,
      {
        schema: {
          ...expertSchema(
            'expertProjectOwnerCandidates',
            '查询组织接单时可选择的项目负责人',
            '按assignmentId定位组织，仅该组织有效主管可查；包含正常账号的在组、退出审批中及待离职成员，支持主管同时管理多个组织。',
            projectOwnerCandidatesResponse,
          ),
          querystring: assignmentDetailQuery,
        },
      },
      async (req) => ({
        code: 200,
        message: '操作成功',
        data: await service.projectOwnerCandidates(
          Number(req.query.assignmentId),
          identities.get(req)!,
        ),
      }),
    );
    app.get<{ Querystring: { keyword?: string } }>(
      `${API_PREFIX}/expert-assignments/my-projects`,
      {
        schema: {
          ...expertSchema(
            'myExpertProjects',
            '查询我的项目',
            '仅个人执行专家/组织普通成员已接单项目；有效组织参与身份优先。主管和项目负责人不列入普通成员口径；四种准入状态均展示，节点读取事实。',
            myProjectsResponse,
          ),
          querystring: myProjectsQuery,
        },
      },
      async (req) => ({
        code: 200,
        message: '操作成功',
        data: await service.myProjects(req.query.keyword, identities.get(req)!),
      }),
    );
    app.get<{ Querystring: { assignmentId: string } }>(
      `${API_PREFIX}/expert-assignments/detail`,
      {
        schema: {
          ...expertSchema(
            'expertAssignmentDetail',
            '查询执行专家任务详情',
            '个人任务仅分配本人可查；组织任务已ACCEPTED时有效组织成员可查，其余状态仅有效组织主管可查。保留projectDetail/productionPlan结构，需求数值取当前分配。',
            assignmentDetailResponse,
          ),
          querystring: assignmentDetailQuery,
        },
      },
      async (req) => {
        const id = Number(req.query.assignmentId);
        if (!Number.isSafeInteger(id) || id > 2147483647)
          throw new AuthError(400, 'VALIDATION_ERROR', 'assignmentId超出32位正整数范围');
        return {
          code: 200,
          message: '操作成功',
          data: await service.detail(id, identities.get(req)!),
        };
      },
    );
  });
}
