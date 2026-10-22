import { Prisma } from '@prisma/client';

export type SubjectType = 'INDIVIDUAL' | 'ORGANIZATION';
export interface RecruitmentQuery {
  projectId: number;
  subjectType?: SubjectType;
  keyword?: string;
  current?: number;
  size?: number;
}
export interface RecruitmentCandidate {
  subjectId: string;
  subjectType: SubjectType;
  realName: string | null;
  nickname: string | null;
  organizationName: string | null;
  avatarUrl: string | null;
  supervisorName: string | null;
  supervisorNickname: string | null;
  description: string | null;
  assignment: {
    assignmentId: number;
    status: string;
    productionRequirement: number | null;
    operatorHeadcount: number | null;
    inspectorHeadcount: number | null;
  } | null;
}
// 同一投影用于候选读取与写前资格复查；统一账号无需旧账号类型/单值角色过滤。
export function candidateSql(excludedIds: string[], query: RecruitmentQuery, subjectId?: string) {
  const excluded = Prisma.join(excludedIds);
  const keyword = query.keyword?.trim();
  // 用POSITION作字面子串搜索，避免把用户输入的%/_解释为通配符。
  return Prisma.sql`WITH candidates AS (
    SELECT u."id" AS "subjectId", 'INDIVIDUAL'::text AS "subjectType",
      u."realName", u."displayName" AS "nickname", NULL::text AS "organizationName", u."avatarUrl",
      NULL::text AS "supervisorName", NULL::text AS "supervisorNickname", u."bio" AS "description"
    FROM "User" u WHERE u."status"='ACTIVE' AND u."id"::text NOT IN (${excluded})
      AND NOT EXISTS (SELECT 1 FROM "UserOrgRel" r WHERE r."userId"=u."id" AND r."joinStatus"='PENDING_ACTIVATION')
      ${query.subjectType ? Prisma.sql`AND ${query.subjectType}='INDIVIDUAL'` : Prisma.empty}
      ${subjectId ? Prisma.sql`AND u."id"=${subjectId}::uuid` : Prisma.empty}
      ${keyword ? Prisma.sql`AND (POSITION(${keyword} IN COALESCE(u."realName",''))>0 OR POSITION(${keyword} IN u."displayName")>0 OR POSITION(${keyword} IN u."uid")>0)` : Prisma.empty}
    UNION ALL
    SELECT o."id", 'ORGANIZATION'::text, NULL::text, NULL::text, o."name", o."logoUrl",
      owner."realName", owner."displayName", o."description"
    FROM "Organization" o
    JOIN LATERAL (
      SELECT u."realName", u."displayName", u."uid" FROM "UserOrgRel" r JOIN "User" u ON u."id"=r."userId"
      WHERE r."orgId"=o."id" AND r."position"='OWNER' AND r."joinStatus" IN ('ACTIVE','EXIT_APPROVING','PENDING_LEAVE')
        AND u."status"='ACTIVE' ORDER BY r."joinedAt", r."id" LIMIT 1
    ) owner ON true
    WHERE o."status"='ACTIVE' AND o."deleted"=false
      AND NOT EXISTS (SELECT 1 FROM "UserOrgRel" r WHERE r."orgId"=o."id" AND r."position"='OWNER'
        AND r."joinStatus" IN ('ACTIVE','EXIT_APPROVING','PENDING_LEAVE') AND r."userId"::text IN (${excluded}))
      ${query.subjectType ? Prisma.sql`AND ${query.subjectType}='ORGANIZATION'` : Prisma.empty}
      ${subjectId ? Prisma.sql`AND o."id"=${subjectId}::uuid` : Prisma.empty}
      ${
        keyword
          ? Prisma.sql`AND (POSITION(${keyword} IN o."name")>0 OR EXISTS (
        SELECT 1 FROM "UserOrgRel" r JOIN "User" u ON u."id"=r."userId"
        WHERE r."orgId"=o."id" AND r."position"='OWNER' AND r."joinStatus" IN ('ACTIVE','EXIT_APPROVING','PENDING_LEAVE')
          AND u."status"='ACTIVE' AND POSITION(${keyword} IN u."uid")>0))`
          : Prisma.empty
      }
  )`;
}
export const candidateAssignmentSql = (projectId: number) => Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT a.* FROM "ProjectExpertAssignment" a WHERE a."projectId"=${projectId}
      AND a."subjectType"=c."subjectType" AND
        ((c."subjectType"='INDIVIDUAL' AND a."expertUserId"=c."subjectId") OR
         (c."subjectType"='ORGANIZATION' AND a."organizationId"=c."subjectId"))
    ORDER BY a."id" DESC LIMIT 1
  ) a ON true`;
