import * as XLSX from 'xlsx';
import { Prisma } from '@prisma/client';
import { AuthError } from '../auth/auth.error.js';
import { parseProjectTime } from '../projects/project-time.js';
import type {
  ExamConfigInput,
  ExamFileInput,
  ExamPaperInput,
  ExamQuestionInput,
} from './exam-config.types.js';
import { examQuestionRows } from './exam-import-template.js';
import { examArchive } from './exam-import-archive.js';
import {
  workbookImages,
  rejectLegacyPictures,
  type ImportCell,
  type ImportAsset,
} from './exam-import-images.js';
import { narrativeRows, configKey, configValue, normalizeTable } from './exam-import-narrative.js';
export const EXAM_SOURCE_LIMIT = 10 * 1024 * 1024;
export const EXAM_TEXT_LIMIT = 1_000_000;
export const questionHeaders = examQuestionRows[0]!;
export interface ImportBinding {
  target: ExamFileInput[];
  asset: ImportAsset;
  location: string;
}
export interface ParsedExam {
  config: ExamConfigInput;
  bindings: ImportBinding[];
}
export const importBad = (message: string) => new AuthError(400, 'VALIDATION_ERROR', message);
export const cell = (text = '', assets: ImportAsset[] = []): ImportCell => ({ text, assets });
const blank = (c: ImportCell) => !c.text.trim() && !c.assets.length;
const optional = (value?: string) => value?.trim() || null;
export function importScore(text: string | undefined, label: string): number | null {
  if (!text?.trim()) return null;
  try {
    const number = new Prisma.Decimal(text.trim());
    if (
      !number.isFinite() ||
      number.lte(0) ||
      number.gt('99999999.99') ||
      number.decimalPlaces() > 2
    )
      throw Error();
    return number.toNumber();
  } catch {
    throw importBad(`${label}必须为最多两位小数的正数，且不超过99999999.99`);
  }
}
function positive(text: string, label: string) {
  if (!/^[+]?\d+$/.test(text) || Number(text) < 1 || Number(text) > 2147483647)
    throw importBad(`${label}必须为32位正整数`);
  return Number(text);
}
function metadata(rows: ImportCell[][]) {
  if (rows[0]?.map((c) => c.text.trim()).join('\0') !== '配置项\0值')
    throw importBad('考试配置表头必须为：配置项、值');
  const values = new Map<string, string>();
  for (const row of rows.slice(1)) {
    if (row.length !== 2 || row.some((c) => c.assets.length))
      throw importBad('考试配置必须为两列纯文本');
    const key = configKey(row[0]!.text.trim());
    if (
      ![
        'formatVersion',
        'examName',
        'durationMinutes',
        'registrationDeadline',
        'fullScore',
        'passScore',
      ].includes(key)
    )
      throw importBad('存在未知考试配置项');
    if (values.has(key)) throw importBad('考试配置项重复');
    values.set(key, configValue(key, row[1]!.text.trim()));
  }
  if (values.has('formatVersion') && values.get('formatVersion') !== '1')
    throw importBad('格式版本必须为1');
  return values;
}
const richText = (value: string) =>
  optional(value)
    ?.replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('\r\n', '\n')
    .replaceAll('\n', '<br/>') ?? null;
export function buildExamImport(values: Map<string, string>, rows: ImportCell[][]): ParsedExam {
  if (rows[0]?.map((c) => c.text.trim()).join('\0') !== questionHeaders.join('\0'))
    throw importBad('题目表头不符合导入格式');
  const examName = optional(values.get('examName')!);
  if ((examName?.length ?? 0) > 128) throw importBad('考试名称超过128字符');
  const deadline = optional(values.get('registrationDeadline')!);
  if (deadline) parseProjectTime(deadline);
  const duration = optional(values.get('durationMinutes')!);
  const config: ExamConfigInput = {
    projectId: 0,
    examName,
    durationMinutes: duration ? positive(duration, '答题时限') : null,
    registrationDeadline: deadline,
    fullScore: importScore(values.get('fullScore'), '试卷满分'),
    passScore: importScore(values.get('passScore'), '及格分数'),
    decisionRule: null,
    tieBreakRule: null,
    papers: [],
    gradingRounds: [],
  };
  const papers = new Map<string, ExamPaperInput>(),
    numbers = new Set<string>();
  const bindings: ImportBinding[] = [];
  let textLength = 0;
  const bind = (target: ExamFileInput[], asset: ImportAsset, location: string) => {
    if (bindings.length >= 100 || bindings.filter((b) => b.target === target).length >= 20)
      throw importBad('每道题每类附件最多20个，一次解析最多100个附件');
    bindings.push({ target, asset, location });
  };
  for (const row of rows.slice(1)) {
    if (row.every(blank)) continue;
    if (row.length > 8) throw importBad('题目存在多余列');
    const cells = Array.from({ length: 8 }, (_, index) => row[index] ?? cell());
    textLength += cells.reduce((sum, c) => sum + c.text.length, 0);
    if (textLength > EXAM_TEXT_LIMIT) throw importBad('题目总文本超过限制');
    const name = optional(cells[0]!.text) ?? '试卷1',
      number = positive(cells[1]!.text.trim(), '题号');
    if (name.length > 100) throw importBad('试卷名称超过100字符');
    const key = `${name}\0${number}`;
    if (numbers.has(key)) throw importBad('同一试卷的题号重复');
    numbers.add(key);
    const paper = papers.get(name) ?? { paperName: name, questions: [] };
    papers.set(name, paper);
    if (papers.size > 20 || paper.questions.length >= 200)
      throw importBad('最多20张试卷，每张最多200道题');
    if ([0, 1, 4, 5].some((i) => cells[i]!.assets.length))
      throw importBad('附件只能放在题干、答案或对应附件列');
    const required = cells[5]!.text.trim().toLowerCase();
    if (
      ![
        '',
        '是',
        '必答',
        '必填',
        'true',
        '1',
        '否',
        '选答',
        '选填',
        '非必答',
        '非必填',
        'false',
        '0',
      ].includes(required)
    )
      throw importBad('必答列取值无效');
    const score = importScore(cells[4]!.text, '题目分值');
    const question: ExamQuestionInput = {
      questionContent: richText(cells[2]!.text),
      questionFiles: [],
      referenceAnswer: richText(cells[3]!.text),
      referenceFiles: [],
      score,
      scoreSource: score == null ? 'AUTO' : 'MANUAL',
      requiredFlag: !['否', '选答', '选填', '非必答', '非必填', 'false', '0'].includes(required),
    };
    const location = `${name}第${number}题`;
    for (const [index, target] of [
      [2, question.questionFiles!],
      [3, question.referenceFiles!],
      [6, question.questionFiles!],
      [7, question.referenceFiles!],
    ] as const) {
      for (const asset of cells[index]!.assets) bind(target, asset, location);
      if (index >= 6)
        for (const name of cells[index]!.text.split('|')
          .map((n) => n.trim())
          .filter(Boolean))
          bind(target, { name }, location);
    }
    if (!question.questionContent && !bindings.some((b) => b.target === question.questionFiles))
      throw importBad(`${location}题干和附件至少填写一项`);
    if (!question.referenceAnswer && !bindings.some((b) => b.target === question.referenceFiles))
      throw importBad(`${location}参考答案和附件至少填写一项`);
    paper.questions.push(question);
  }
  if (!papers.size) throw importBad('至少需要一道题目');
  config.papers = [...papers.values()];
  if (config.papers.every((p) => p.questions.every((q) => q.score != null))) {
    const totals = config.papers.map((p) =>
      p.questions.reduce((sum, q) => sum.add(q.score!), new Prisma.Decimal(0)),
    );
    if (totals.every((t) => t.equals(totals[0]!))) config.fullScore = totals[0]!.toNumber();
  }
  if (config.passScore != null && config.fullScore != null && config.passScore > config.fullScore)
    throw importBad('及格分数不能高于满分');
  return { config, bindings };
}
export function parseExamText(bytes: Buffer): ParsedExam {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw importBad('TXT必须使用UTF-8编码');
  }
  if (text.length > EXAM_TEXT_LIMIT) throw importBad('TXT内容过长');
  const lines = text.split(/\r\n|[\n\r\u0085\u2028\u2029]/);
  if (!text.includes('[考试配置]') && !text.includes('[题目]')) {
    const rows = lines.filter((l) => l.trim()).map((l) => l.split('\t').map((s) => cell(s)));
    const table = normalizeTable(rows);
    return table ? buildExamImport(new Map(), table) : narrativeRows(lines.map((l) => cell(l)));
  }
  const config: ImportCell[][] = [],
    questions: ImportCell[][] = [],
    seen = new Set<string>();
  let current: ImportCell[][] | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (['[考试配置]', '[题目]'].includes(line)) {
      if (seen.has(line)) throw importBad('重复的配置或题目段');
      seen.add(line);
      current = line === '[考试配置]' ? config : questions;
      continue;
    }
    if (!current) throw importBad('TXT必须以配置或题目段标识开始');
    current.push(
      line
        .split('\t')
        .map((s) =>
          cell(
            s.replace(/\\([nt\\])/g, (_, c: string) =>
              c === 'n' ? '\n' : c === 't' ? '\t' : '\\',
            ),
          ),
        ),
    );
    if (config.length > 20 || questions.length > 4001) throw importBad('TXT超过允许行数');
  }
  return buildExamImport(metadata(config), questions);
}
export function parseExamExcel(source: Buffer): ParsedExam {
  try {
    const archive = source.subarray(0, 2).toString() === 'PK' ? examArchive(source) : null;
    const images = archive
      ? workbookImages(archive)
      : new Map<string, Map<string, ImportAsset[]>>();
    if (!archive) {
      // SheetJS不提供旧BIFF图片锚点；有绘图记录时明确拒绝，防止静默丢题。
      const compound = XLSX.CFB.read(source, { type: 'buffer' });
      const stream = compound.FileIndex.find((f: { name: string; content?: Uint8Array }) =>
        /^(Workbook|Book)$/i.test(f.name),
      )?.content;
      if (stream) rejectLegacyPictures(Buffer.from(stream));
    }
    const workbook = XLSX.read(source, { type: 'buffer', cellFormula: true, sheetStubs: true });
    let configRows: ImportCell[][] | undefined;
    const combined: ImportCell[][] = [],
      lines: ImportCell[] = [];
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name]!;
      if (sheet['!merges']?.length) throw importBad('固定模板不支持合并单元格');
      const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
      if (range.e.r >= 4001 || range.e.c >= 8) throw importBad('Excel超过4001行或8列限制');
      const pictures = images.get(name) ?? new Map<string, ImportAsset[]>();
      const last = Math.max(range.e.r, ...[...pictures.keys()].map((k) => Number(k.split(':')[0])));
      const rows: ImportCell[][] = [];
      for (let row = 0; row <= last; row++) {
        const cells: ImportCell[] = [];
        for (let col = 0; col < 8; col++) {
          const c = sheet[XLSX.utils.encode_cell({ r: row, c: col })] as
            XLSX.CellObject | undefined;
          if (c?.f !== undefined) throw importBad('模板不支持公式，请粘贴为值后导入');
          const assets = pictures.get(`${row}:${col}`) ?? [];
          cells.push(cell(c ? XLSX.utils.format_cell(c) : '', assets));
        }
        // 保留模板中显式空白单元格，同时剔除读取器补齐的尾部空列。
        while (
          cells.length &&
          blank(cells[cells.length - 1]!) &&
          !sheet[XLSX.utils.encode_cell({ r: row, c: cells.length - 1 })]
        )
          cells.pop();
        if (!cells.every(blank)) rows.push(cells);
      }
      if (name === '考试配置') {
        if (rows.length > 20) throw importBad('考试配置超过允许行数');
        configRows = rows;
      } else {
        const table = normalizeTable(rows);
        if (table) {
          if (!combined.length) combined.push(table[0]!);
          for (const row of table.slice(1)) {
            if (
              workbook.SheetNames.length - Number(workbook.SheetNames.includes('考试配置')) > 1 &&
              !row[0]!.text.trim()
            )
              row[0] = cell(name);
            combined.push(row);
          }
        } else for (const row of rows) for (const c of row) if (!blank(c)) lines.push(c);
      }
    }
    if (combined.length) {
      if (lines.length) throw importBad('Excel不支持混合题目表和自由文本');
      return buildExamImport(configRows ? metadata(configRows) : new Map(), combined);
    }
    const config = configRows
      ? [...metadata(configRows)].map(([key, value]) => cell(`${key}：${value}`))
      : [];
    return narrativeRows([...config, ...lines]);
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw importBad('Excel文件无效、已加密或不符合导入格式');
  }
}
