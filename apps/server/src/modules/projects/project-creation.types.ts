export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
export type Education = 'PHD' | 'MASTER' | 'BACHELOR' | 'COLLEGE' | 'BELOW_COLLEGE';
export type Employment = 'FULL_TIME' | 'PART_TIME' | 'UNLIMITED';
export type AttachmentType = 'STANDARD_REFERENCE' | 'CASE' | 'OTHER';
export interface ProjectAttachmentInput {
  id?: number | null;
  attachmentType?: AttachmentType | null;
  objectKey?: string | null;
  uploadToken?: string | null;
  sortNo?: number | null;
}
export interface ProjectSaveInput {
  operation: 'SAVE_DRAFT' | 'CREATE_PROJECT';
  requesterType?: 'INDIVIDUAL' | 'ORGANIZATION' | null;
  requesterId?: string | null;
  projectName?: string | null;
  projectDescription?: string | null;
  categoryLevel1Id?: number | null;
  categoryLevel2Id?: number | null;
  categoryLevel3Ids?: number[] | null;
  difficultyLevel?: Difficulty | null;
  projectQuantity?: number | null;
  quantityUnit?: string | null;
  deadline?: string | null;
  requiredHeadcount?: number | null;
  educationRequirement?: Education | null;
  employmentType?: Employment | null;
  experienceRequirement?: string | null;
  workSummary?: string | null;
  specialRequirement?: string | null;
  mandatoryRequirement?: string | null;
  standardContent?: string | null;
  standardLink?: string | null;
  attachments?: ProjectAttachmentInput[] | null;
  versionNo?: number | null;
}
