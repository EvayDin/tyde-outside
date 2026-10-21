import { AttendanceApplicationService } from './attendance-application.service.js';
import type { AttendanceApplyInput } from './attendance-application.domain.js';
import {
  attendanceApplicationBody,
  attendanceWithdrawBody,
  attendanceApplicationResponse,
} from './attendance-application.schema.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { API_PREFIX } from '@tyde/shared';
import type { Config } from '../../config/index.js';
import type { AuthPrincipal, AuthService } from '../auth/auth.service.js';
import { AuthError } from '../auth/auth.error.js';
import { validateTransport } from '../auth/security.js';
import { AttendanceService, type AttendanceUpdate } from './attendance.service.js';
import type { ScheduleInput } from './attendance-domain.js';
import { HolidayCalendarService } from './holiday-calendar.service.js';
import {
  attendanceSchema,
  attendanceQuery,
  holidayQuery,
  attendanceResponse,
  holidayResponse,
  scheduleBody,
  scheduleHeaders,
  scheduleResponse,
  attendanceUpdateBody,
  attendanceUpdateResponse,
} from './attendance.schema.js';
export async function attendanceRoutes(
  parent: FastifyInstance,
  service: AttendanceService,
  auth: AuthService,
  config: Config,
  holiday = new HolidayCalendarService(),
) {
  await parent.register(async (app) => {
    const identities = new WeakMap<FastifyRequest, AuthPrincipal>();
    const applications = new AttendanceApplicationService(service.db);
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
    app.get<{ Querystring: { month: string; orgId?: string } }>(
      `${API_PREFIX}/organizations/attendance`,
      {
        schema: {
          ...attendanceSchema(
            'listMyAttendance',
            '获取我的排班考勤',
            '只能查询本人，组织成员须传orgId，无组织EXPERT不传。月历补齐整月，查询不创建考勤；返回本人最新申请及逐日操作权限；申请经主管审批后生效，查询不推进流程，打卡写入口尚未接入。',
            attendanceResponse,
          ),
          querystring: attendanceQuery,
        },
      },
      async (req) => ({
        code: 200,
        message: '操作成功',
        data: await service.month(req.query.month, req.query.orgId, identities.get(req)!),
      }),
    );
    app.get<{ Querystring: { month: string; orgId?: string } }>(
      `${API_PREFIX}/organizations/calendar/holidays`,
      {
        schema: {
          ...attendanceSchema(
            'getHolidayCalendar',
            '获取月度节假日日历',
            '所有登录用户可查，orgId仅兼容。读取公开年度中国节假日数据，内存缓存24小时；远程失败优先使用已有校验缓存，其次使用随服务发布且按官方通知核对的2026年基线。仅覆盖全国已公布放假/调休，不推算普通周末或其他年份；无缓存且无该年基线时503。年度公告调整须更新随包基线。',
            holidayResponse,
          ),
          querystring: holidayQuery,
        },
      },
      async (req) => ({
        code: 200,
        message: '操作成功',
        data: await holiday.month(req.query.month),
      }),
    );
    app.put<{ Body: ScheduleInput; Headers: { 'idempotency-key': string } }>(
      `${API_PREFIX}/users/me/schedules/batch`,
      {
        bodyLimit: 256 * 1024,
        schema: {
          ...attendanceSchema(
            'batchMySchedules',
            '无组织执行专家为本人排班',
            '仅无有效组织的EXPERT；最多366条，REST不能含班次，WORK不支持跨日。幂等结果与排班同事务保存，相同标准化参数及key重放，不同参数同键409。组织关系后续变化时仍须满足权限。排班不自动制造打卡记录。',
            scheduleResponse,
          ),
          body: scheduleBody,
          headers: scheduleHeaders,
        },
      },
      async (req) => ({
        code: 200,
        message: '操作成功',
        data: await service.batch(req.headers['idempotency-key'], req.body, identities.get(req)!),
      }),
    );
    app.post<{ Body: AttendanceApplyInput }>(
      `${API_PREFIX}/organizations/attendance/apply`,
      {
        schema: {
          ...attendanceSchema(
            'applyAttendance',
            '提交本人请假或考勤修正申请',
            '仅有效组织MEMBER/ADMIN本人可提交，由当前有效主管审批；主管本人使用直接变更，无组织专家不支持。同日请假/修正互斥，一条待审申请，重复409。LEAVE须提供排班内同日时段，批准后按日标记LEAVE；部分时段不拆分日状态。CORRECTION仅当天/历史且不接受LEAVE目标。versionNo来自月历dailyVersionNo，无日考勤显式null；审批前复查排班/考勤版本，变化409。提交不修改考勤。',
            attendanceApplicationResponse,
          ),
          body: attendanceApplicationBody,
        },
      },
      async (req) => ({
        code: 200,
        message: '操作成功',
        data: await applications.apply(req.body, identities.get(req)!),
      }),
    );
    app.post<{ Body: { applicationId: string; flowVersionNo: number } }>(
      `${API_PREFIX}/organizations/attendance/withdraw`,
      {
        schema: {
          ...attendanceSchema(
            'withdrawAttendance',
            '撤回本人待审考勤申请',
            '仅本人可撤回PENDING考勤申请，使用流程版本；不受当前是否离组限制，不恢复组织身份。组织→流程→节点加锁，撤回/审批仅一个成功，已处理或过期版本409。撤回取消节点并追加日志，不修改日考勤。退出组织等其他业务不能从此撤回。',
            attendanceApplicationResponse,
          ),
          body: attendanceWithdrawBody,
        },
      },
      async (req) => ({
        code: 200,
        message: '操作成功',
        data: await applications.withdraw(req.body, identities.get(req)!),
      }),
    );
    app.post<{ Body: AttendanceUpdate }>(
      `${API_PREFIX}/organizations/attendance/update`,
      {
        schema: {
          ...attendanceSchema(
            'updateAttendance',
            '人工修正考勤',
            '仅有效组织主管/管理员可直接修正指定组织已有日考勤，普通成员不能调用；禁止修正未来日期。日考勤版本锁、修正前后快照与审计同事务保存；当前未接实时通知投递。',
            attendanceUpdateResponse,
          ),
          body: attendanceUpdateBody,
        },
      },
      async (req) => ({
        code: 200,
        message: '操作成功',
        data: await service.update(req.body, identities.get(req)!),
      }),
    );
  });
}
