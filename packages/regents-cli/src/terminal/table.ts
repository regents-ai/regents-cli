import { renderPanel } from "./panel.js";
import { alignCell, CLI_PALETTE, escapeTerminalText, tone } from "./palette.js";

export interface TableColumn {
  header: string;
  align?: "left" | "right" | "center";
  color?: string;
  minWidth?: number;
}

export interface TableRow {
  cells: readonly string[];
  colors?: readonly (string | undefined)[];
}

export const renderTablePanel = (
  title: string,
  columns: readonly TableColumn[],
  rows: readonly TableRow[],
  options?: { borderColor?: string; titleColor?: string },
): string => {
  const safeColumns = columns.map((column) => ({
    ...column,
    header: escapeTerminalText(column.header),
  }));
  const safeRows = rows.map((row) => ({
    ...row,
    cells: row.cells.map(escapeTerminalText),
  }));
  const widths = safeColumns.map((column, index) => {
    const headerWidth = column.header.length;
    const rowWidths = safeRows.map((row) => (row.cells[index] ?? "").length);
    return Math.max(column.minWidth ?? 0, headerWidth, ...rowWidths, 3);
  });

  const header = safeColumns
    .map((column, index) => alignCell(tone(column.header, column.color ?? CLI_PALETTE.title, true), widths[index] ?? 3, column.align))
    .join(" │ ");
  const separator = widths.map((width) => "─".repeat(width)).join("─┼─");
  const body = safeRows.map((row) =>
    safeColumns
      .map((column, index) => {
        const cell = row.cells[index] ?? "";
        const cellColor = row.colors?.[index] ?? column.color ?? CLI_PALETTE.primary;
        return alignCell(tone(cell, cellColor), widths[index] ?? 3, column.align);
      })
      .join(" │ "),
  );

  return renderPanel(title, [header, separator, ...body], options);
};
