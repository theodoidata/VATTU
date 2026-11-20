// Xuất Excel (.xlsx) ngay trên trình duyệt
export type ExcelCol<T> = { header: string; width?: number; get: (row: T) => string | number | null | undefined };
export type ExcelSheet = { name: string; columns: ExcelCol<any>[]; rows: any[] };

/** Tạo 1 sheet (giữ đúng kiểu dữ liệu từng dòng) */
export function sheet<T>(name: string, rows: T[], columns: ExcelCol<T>[]): ExcelSheet {
  return { name, rows, columns };
}

export async function exportExcel(fileName: string, sheets: ExcelSheet[]) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const data = sheets.map(s => ({
    sheet: s.name.replace(/[\\/?*[\]:]/g, '-').slice(0, 31),
    columns: s.columns.map(c => ({ width: c.width ?? 16 })),
    stickyRowsCount: 1,
    data: [
      s.columns.map(c => ({ value: c.header, fontWeight: 'bold' as const, backgroundColor: '#E6F1FE' })),
      ...s.rows.map(r => s.columns.map(c => {
        const v = c.get(r);
        if (typeof v === 'number') return { value: v, type: Number };
        return { value: v == null ? '' : String(v), type: String };
      })),
    ],
  }));
  await writeXlsxFile(data as any).toFile(fileName.endsWith('.xlsx') ? fileName : fileName + '.xlsx');
}
