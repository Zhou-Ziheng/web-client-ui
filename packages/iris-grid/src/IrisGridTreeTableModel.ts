/* eslint class-methods-use-this: "off" */
import memoize from 'memoize-one';
import { GridRange, ModelIndex } from '@deephaven/grid';
import { Column, Row, Table, TreeRow, TreeTable } from '@deephaven/jsapi-shim';
import IrisGridTableModel, { UIRow } from './IrisGridTableModel';
import { assertNotNull, assertNotUndefined } from './IrisGrid';

export interface UITreeRow extends UIRow {
  isExpanded: boolean;
  hasChildren: boolean;
  depth: number;
}
class IrisGridTreeTableModel extends IrisGridTableModel<UITreeRow> {
  // table: TreeTable

  applyBufferedViewport(
    viewportTop: number,
    viewportBottom: number,
    columns: Column[]
  ): void {
    this.table.setViewport(viewportTop, viewportBottom, columns);
  }

  textForCell(x: number, y: number): string {
    const column = this.columns[x];
    const row = this.row(y);
    if (row != null && column != null) {
      if (!row.hasChildren && column.constituentType != null) {
        const value = this.valueForCell(x, y);
        return this.displayString(value, column.constituentType, column.name);
      }
    }

    return super.textForCell(x, y);
  }

  extractViewportRow(row: TreeRow, columns: Column[]): UITreeRow {
    const { isExpanded, hasChildren, depth } = row;
    return {
      ...super.extractViewportRow(row, columns),
      isExpanded,
      hasChildren,
      depth,
    };
  }

  async snapshot(
    ranges: GridRange[],
    includeHeaders?: boolean,
    formatValue?: (value: unknown, column: Column) => unknown
  ): Promise<unknown[][]> {
    assertNotNull(this.viewport);
    const { columns } = this.viewport;
    const result = [];

    if (includeHeaders) {
      result.push(columns.map(c => c.name));
    }

    assertNotNull(this.viewportData);
    const viewportRange = new GridRange(
      0,
      this.viewportData?.offset,
      columns.length,
      this.viewportData?.offset + this.viewportData?.rows.length
    );

    for (let i = 0; i < ranges.length; i += 1) {
      const intersection = GridRange.intersection(viewportRange, ranges[i]);

      assertNotNull(intersection);
      assertNotNull(intersection.startRow);
      assertNotNull(intersection.endRow);

      for (let r = intersection.startRow; r <= intersection.endRow; r += 1) {
        const resultRow = [];
        const viewportRow = this.viewportData.rows[
          r - this.viewportData.offset
        ];
        assertNotNull(intersection.startColumn);
        assertNotNull(intersection.endColumn);
        for (
          let c = intersection.startColumn;
          c <= intersection.endColumn;
          c += 1
        ) {
          assertNotUndefined(formatValue);
          resultRow.push(
            formatValue(viewportRow.data.get(c)?.value, this.columns[c])
          );
        }
        result.push(resultRow);
      }
    }

    return result;
  }

  get groupedColumns(): [] {
    return [];
  }

  get hasExpandableRows(): boolean {
    return true;
  }

  get isChartBuilderAvailable(): boolean {
    return false;
  }

  get isSelectDistinctAvailable(): boolean {
    return false;
  }

  get isReversible(): boolean {
    return false;
  }

  isFilterable(columnIndex: ModelIndex): boolean {
    return this.getCachedFilterableColumnSet(
      this.columns,
      this.groupedColumns
    ).has(columnIndex);
  }

  isColumnMovable(column: ModelIndex): boolean {
    return column >= this.groupedColumns.length;
  }

  isRowExpandable(y: ModelIndex): boolean {
    const row = this.row(y);
    return row?.hasChildren ?? false;
  }

  isRowExpanded(y: ModelIndex): boolean {
    const row = this.row(y);
    return row?.isExpanded ?? false;
  }

  setRowExpanded(y: number, isExpanded: boolean): void {
    this.table.setExpanded(y, isExpanded);
  }

  depthForRow(y: number): number {
    const row = this.row(y);
    return (row?.depth ?? 1) - 1;
  }

  getCachedFilterableColumnSet = memoize(
    (columns: Column[], groupedColumns: Column[]) =>
      new Set(
        (groupedColumns?.length > 0 ? groupedColumns : columns).map(c1 =>
          columns.findIndex(c2 => c1.name === c2.name)
        )
      )
  );
}

export default IrisGridTreeTableModel;