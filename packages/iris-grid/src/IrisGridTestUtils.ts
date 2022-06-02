import { GridRangeIndex, ModelSizeMap } from '@deephaven/grid';
import dh, {
  Column,
  FilterCondition,
  Row,
  TableViewportSubscription,
} from '@deephaven/jsapi-shim';
import { Formatter } from '@deephaven/jsapi-utils';
import IrisGridProxyModel from './IrisGridProxyModel';

class IrisGridTestUtils {
  static DEFAULT_TYPE = 'java.lang.String';

  static valueForCell(
    rowIndex: GridRangeIndex,
    columnIndex: GridRangeIndex,
    formatValue: boolean
  ): string {
    let value = `${rowIndex},${columnIndex}`;
    if (formatValue) {
      value = `(${value})`;
    }
    return value;
  }

  static makeColumn(
    name: string,
    type: string = IrisGridTestUtils.DEFAULT_TYPE,
    index = 0
  ): Column {
    return new Column({ index, name, type });
  }

  static makeColumns(count = 5): Column[] {
    const columns = [];
    for (let i = 0; i < count; i += 1) {
      columns.push(this.makeColumn(`${i}`, IrisGridTestUtils.DEFAULT_TYPE, i));
    }
    return columns;
  }

  static makeUserColumnWidths(count = 5): ModelSizeMap {
    const userColumnWidths = new Map();
    for (let i = 0; i < count; i += 1) {
      userColumnWidths.set(i.toString(), 100);
    }
    return userColumnWidths;
  }

  static makeRow(i: number): Row {
    const row = new dh.Row({ index: i, name: `${i}` });

    row.get = jest.fn(column =>
      IrisGridTestUtils.valueForCell(i, column.index)
    );

    return row;
  }

  static makeFilter(): FilterCondition {
    return new dh.FilterCondition();
  }

  static makeSort(): Sort {
    return new dh.Sort();
  }

  static makeTable(
    columns = IrisGridTestUtils.makeColumns(),
    size = 1000000000
  ) {
    const table = new dh.Table({ columns, size });
    table.copy = jest.fn(() => Promise.resolve(table));
    return table;
  }

  static makeInputTable(keyColumns = []) {
    return new dh.InputTable(keyColumns);
  }

  static makeSubscription(table = IrisGridTestUtils.makeTable()) {
    return new TableViewportSubscription({ table });
  }

  static makeModel(
    table = IrisGridTestUtils.makeTable(),
    formatter = new Formatter(),
    inputTable = null
  ): IrisGridProxyModel {
    return new IrisGridProxyModel(table, formatter, inputTable);
  }
}

export default IrisGridTestUtils;