import type { Prisma } from '@prisma/client';
import { projectTime } from './project-time.js';

export const projectDetailInclude = {
  categories: { orderBy: [{ categoryLevel: 'asc' }, { sortNo: 'asc' }, { id: 'asc' }] },
  attachments: {
    where: { status: 'ACTIVE' },
    orderBy: [{ sortNo: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      attachmentType: true,
      fileName: true,
      objectKey: true,
      extension: true,
      contentType: true,
      fileSize: true,
      fileHash: true,
      sortNo: true,
      status: true,
    },
  },
} as const satisfies Prisma.ProjectInclude;

export type ProjectDetailRecord = Prisma.ProjectGetPayload<{
  include: typeof projectDetailInclude;
}>;
export async function projectDetailData(tx: Prisma.TransactionClient, draft: ProjectDetailRecord) {
  const { categories, attachments, ...project } = draft;
  const first = categories.find((c) => c.categoryLevel === 1);
  const second = categories.find((c) => c.categoryLevel === 2);
  const third = categories.filter((c) => c.categoryLevel === 3);
  let requesterName = draft.requesterName;
  if (draft.requesterType === 'INDIVIDUAL') {
    const user = await tx.user.findUnique({ where: { id: draft.requesterId } });
    if (user) requesterName = displayName(user.displayName, user.realName, requesterName);
  }
  return {
    id: project.id,
    projectNo: project.projectNo,
    requesterType: project.requesterType,
    requesterId: project.requesterId,
    requesterName,
    projectName: project.projectName,
    projectDescription: project.projectDescription,
    categoryLevel1Id: first?.categoryId ?? null,
    categoryLevel2Id: second?.categoryId ?? null,
    categoryLevel1Name: first?.categoryNameSnapshot ?? null,
    categoryLevel2Name: second?.categoryNameSnapshot ?? null,
    categoryLevel3Ids: third.map((c) => c.categoryId),
    categoryLevel3Names: third.map((c) => c.categoryNameSnapshot),
    difficultyLevel: project.difficultyLevel,
    projectQuantity: project.projectQuantity?.toNumber() ?? null,
    quantityUnit: project.quantityUnit,
    deadline: project.deadline ? projectTime(project.deadline) : null,
    requiredHeadcount: project.requiredHeadcount,
    educationRequirement: project.educationRequirement,
    employmentType: project.employmentType,
    experienceRequirement: project.experienceRequirement,
    workSummary: project.workSummary,
    specialRequirement: project.specialRequirement,
    mandatoryRequirement: project.mandatoryRequirement,
    standardContent: project.standardContent,
    standardLink: project.standardLink,
    status: project.status,
    currentNodeCode: project.currentNodeCode,
    versionNo: project.versionNo,
    creatorUid: project.createdBy,
    creatorName: null,
    createdAt: projectTime(project.createdAt),
    updatedAt: projectTime(project.updatedAt),
    attachments,
  };
}

export function displayName(nickname: string, realName: string | null, fallback: string) {
  const nick = nickname.trim(),
    real = realName?.trim();
  return nick && real ? `${nick}(${real})` : nick || real || fallback;
}
