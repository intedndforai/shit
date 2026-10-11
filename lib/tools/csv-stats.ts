/** CSV parsing + column statistics for the `analyze_csv` tool. */

export interface CsvStats {
  rows: number;
  columns: Array<{
    name: string;
    type: "number" | "text";
    filled: number;
    distinct: number;
    min?: number;
    max?: number;
    mean?: number;
    topValues?: Array<{ value: string; count: number }>;
  }>;
}

/** Minimal RFC-4180-ish splitter: handles quotes, escaped quotes, and commas. */
export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      cells.push(current.trim());
      current = "";
    } else current += char;
  }

  cells.push(current.trim());
  return cells;
}

export function analyseCsv(input: string, maxRows = 5000): CsvStats {
  const lines = input.split(/\r?\n/).filter((line) => line.trim().length);
  if (!lines.length) throw new Error("The CSV is empty.");

  const header = parseCsvLine(lines[0]);
  const rows = lines.slice(1, maxRows + 1).map(parseCsvLine);

  const columns: CsvStats["columns"] = header.map((name, index) => {
    const values = rows.map((row) => row[index] ?? "").filter((value) => value !== "");
    const numbers = values.map(Number).filter((value) => Number.isFinite(value));
    const numeric = values.length > 0 && numbers.length === values.length;

    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);

    const column: CsvStats["columns"][number] = {
      name: name || `column_${index + 1}`,
      type: numeric ? "number" : "text",
      filled: values.length,
      distinct: counts.size,
    };

    if (numeric && numbers.length) {
      column.min = Math.min(...numbers);
      column.max = Math.max(...numbers);
      column.mean = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
    } else {
      column.topValues = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([value, count]) => ({ value: value.slice(0, 60), count }));
    }

    return column;
  });

  return { rows: rows.length, columns };
}