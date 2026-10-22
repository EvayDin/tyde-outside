import type { ExamLocator } from './exam-access.js';
import type { GradingItemInput } from './exam-grading-rules.js';
export interface AutoRetryInput extends ExamLocator {
  gradingRecordId: number;
}
export interface AutoCompensateInput extends AutoRetryInput {
  items: GradingItemInput[];
  summary?: string | null;
  compensationReason?: string | null;
}
export interface AutoCallbackInput {
  projectId: number;
  attemptId: number;
  examVersionId: number;
  paperId: number;
  roundNo: number;
  gradingRecordId: number;
  toolTraceId: string;
  status: 'SUCCEEDED' | 'FAILED';
  items?: GradingItemInput[] | null;
  summary?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}
