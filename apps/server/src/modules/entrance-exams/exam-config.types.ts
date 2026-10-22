export interface ExamFileInput {
  uploadedFileId?: string | null;
  objectKey: string;
  uploadToken?: string | null;
  fileName?: string;
  extension?: string;
  contentType?: string;
  size?: number;
  fileHash?: string | null;
  url?: string | null;
  sensitive?: boolean;
}
export interface ExamQuestionInput {
  questionContent?: string | null;
  questionFiles?: ExamFileInput[] | null;
  requiredFlag?: boolean | null;
  score?: number | null;
  scoreSource?: 'AUTO' | 'MANUAL' | null;
  referenceAnswer?: string | null;
  referenceFiles?: ExamFileInput[] | null;
}
export interface ExamPaperInput {
  paperName?: string | null;
  questions: ExamQuestionInput[];
}
export interface ExamRoundInput {
  gradingMode: 'AUTO' | 'MANUAL';
  toolCode?: string | null;
  toolName?: string | null;
  toolConfig?: unknown;
  toolFiles?: ExamFileInput[] | null;
  reviewerUserIds?: string[] | null;
}
export interface ExamConfigInput {
  projectId: number;
  examName?: string | null;
  durationMinutes?: number | null;
  registrationDeadline?: string | null;
  fullScore?: number | null;
  passScore?: number | null;
  decisionRule?: 'MAJORITY' | 'MANUAL_PRIORITY' | null;
  tieBreakRule?: 'STRICT' | 'LENIENT' | null;
  papers: ExamPaperInput[];
  gradingRounds: ExamRoundInput[];
}
export interface ExamEditInput extends ExamConfigInput {
  examId: number;
  expectedCurrentVersionId: number;
}
