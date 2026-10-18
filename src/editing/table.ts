export interface TableData { rows: string[][]; align: ('left' | 'center' | 'right')[] }
function splitRow(line: string) {
  let source = line.trim();
  if (source.startsWith('|')) source = source.slice(1);
  if (source.endsWith('|') && !source.endsWith('\\|')) source = source.slice(0, -1);
  const cells: string[] = []; let cell = '', escaped = false, code = false;
  for (const char of source) {
    if (escaped) { cell += char === '|' ? '|' : `\\${char}`; escaped = false; }
    else if (char === '\\') escaped = true;
    else if (char === '`') { code = !code; cell += char; }
    else if (char === '|' && !code) { cells.push(cell.trim()); cell = ''; }
    else cell += char;
  }
  if (escaped) cell += '\\';
  cells.push(cell.trim()); return cells;
}
export function parseTable(source: string): TableData | null {
  const lines = source.trim().split('\n');
  if (lines.length < 2) return null;
  const separators = splitRow(lines[1]);
  if (!separators.length || !separators.every(s => /^:?-{3,}:?$/.test(s))) return null;
  const count = separators.length;
  const rows = [lines[0], ...lines.slice(2)].map(line => { const cells = splitRow(line); return Array.from({ length: count }, (_, i) => cells[i] || ''); });
  return { rows, align: separators.map(s => s.startsWith(':') && s.endsWith(':') ? 'center' : s.endsWith(':') ? 'right' : 'left') };
}
export function serializeTable(table: TableData) {
  const row = (cells: string[]) => `| ${cells.map(cell => cell.replace(/\r?\n/g, '<br>').replace(/(?<!\\)\|/g, '\\|')).join(' | ')} |`;
  return [row(table.rows[0]), row(table.align.map(a => a === 'center' ? ':---:' : a === 'right' ? '---:' : ':---')), ...table.rows.slice(1).map(row)].join('\n');
}
export function tableAt(content: string, cursor: number) {
  const lines = content.split('\n');
  const index = content.slice(0, cursor).split('\n').length - 1;
  let fence = false;
  for (let i = 0; i <= index; i++) if (/^\s*(`{3,}|~{3,})/.test(lines[i])) fence = !fence;
  if (fence) return null;
  let start = index, end = index;
  while (start > 0 && lines[start - 1].includes('|') && lines[start - 1].trim()) start--;
  while (end < lines.length - 1 && lines[end + 1].includes('|') && lines[end + 1].trim()) end++;
  const text = lines.slice(start, end + 1).join('\n');
  const data = parseTable(text); if (!data) return null;
  const from = lines.slice(0, start).reduce((n, line) => n + line.length + 1, 0);
  return { from, to: from + text.length, data };
}
