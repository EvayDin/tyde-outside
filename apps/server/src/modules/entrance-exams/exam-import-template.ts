import * as XLSX from 'xlsx';

export type ExamTemplateType = 'EXCEL' | 'TXT' | 'REDOC';
export const examConfigRows = [
  ['配置项', '值'],
  ['格式版本', '1'],
  ['考试名称', '示例准入考试'],
  ['答题时限', '60'],
  ['截止日期', ''],
  ['试卷满分', '20'],
  ['及格线分数', '12'],
];
export const examQuestionRows = [
  ['试卷名称', '题号', '题干', '参考答案', '分值', '必答', '题干附件', '答案附件'],
  ['试卷1', '1', '请描述操作步骤。', '按规范完成操作。', '10', '是', '', ''],
  ['试卷1', '2', '请选择正确选项。\nA. 选项一\nB. 选项二', 'A', '10', '是', '', ''],
];
export function examImportTemplate(type: ExamTemplateType) {
  let content: Buffer;
  let extension: string;
  let contentType: string;
  if (type === 'EXCEL') {
    const workbook = XLSX.utils.book_new();
    const config = XLSX.utils.aoa_to_sheet(examConfigRows);
    config['!cols'] = [{ wch: 28 }, { wch: 35 }];
    const questions = XLSX.utils.aoa_to_sheet(examQuestionRows);
    questions['!cols'] = Array.from({ length: 8 }, (_, i) => ({
      wch: i === 2 || i === 3 ? 45 : 20,
    }));
    XLSX.utils.book_append_sheet(workbook, config, '考试配置');
    XLSX.utils.book_append_sheet(workbook, questions, '题目');
    content = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
    extension = 'xlsx';
    contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  } else if (type === 'TXT') {
    const rows = (values: string[][]) =>
      values.map((row) => row.map((cell) => cell.replaceAll('\n', '\\n')).join('\t')).join('\n');
    content = Buffer.from(
      `[考试配置]\n${rows(examConfigRows)}\n\n[题目]\n${rows(examQuestionRows)}\n`,
    );
    extension = 'txt';
    contentType = 'text/plain;charset=UTF-8';
  } else {
    const escape = (value: string) =>
      value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('\n', '<br />');
    const table = (rows: string[][]) =>
      `<table header-row="true"><tbody>\n${rows.map((row) => `<tr>${row.map((cell) => `<td><p>${escape(cell)}</p></td>`).join('')}</tr>`).join('\n')}\n</tbody></table>`;
    content = Buffer.from(
      `<title>准入考试导入模板 v1</title>\n<h1>考试配置</h1>\n${table(examConfigRows)}\n<h1>题目</h1>\n${table(examQuestionRows)}\n`,
    );
    extension = 'xml';
    contentType = 'application/xml;charset=UTF-8';
  }
  return { filename: `entrance-exam-import-v1.${extension}`, contentType, content };
}
