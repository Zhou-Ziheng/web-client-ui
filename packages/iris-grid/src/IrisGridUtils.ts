import {
  GridRange,
  GridRangeIndex,
  GridUtils,
  IndexCallback,
  ModelIndex,
  ModelSizeMap,
  MoveOperation,
} from '@deephaven/grid';
import dh, {
  Column,
  DateWrapper,
  FilterCondition,
  LongWrapper,
  RollupConfig,
  Sort,
  Table,
  TableData,
} from '@deephaven/jsapi-shim';
import { DateUtils, TableUtils } from '@deephaven/jsapi-utils';
import Log from '@deephaven/log';
import { GridState } from 'packages/grid/src/Grid';
import { assert } from 'console';
import AdvancedSettings from './sidebar/AdvancedSettings';
import AggregationUtils from './sidebar/aggregations/AggregationUtils';
import AggregationOperation from './sidebar/aggregations/AggregationOperation';
import IrisGridModel from './IrisGridModel';
import IrisGrid, {
  AdvancedFilter,
  assertNotNull,
  assertNotUndefined,
  InputFilter,
  IrisGridProps,
  IrisGridState,
  QuickFilter,
} from './IrisGrid';
import { UIRollupConfig } from './sidebar/RollupRows';
import { AggregationSettings } from './sidebar/aggregations/Aggregations';
import { Options } from './AdvancedFilterCreator';
import { CellData, PendingDataMap, UIRow } from './IrisGridTableModel';
import { string } from 'prop-types';
import { FormattingRule } from '@deephaven/jsapi-utils';
import { ReverseType } from '@deephaven/jsapi-utils';

const log = Log.module('IrisGridUtils');

// export type SavedFilters = {
//   number
// }

interface DehydratedIrisGridState {
  advancedFilters: [
    number,
    {
      options: Options;
    }
  ][];
  advancedSettings: AdvancedFilter[];
  aggregationSettings: AggregationSettings;
  customColumnFormatMap: [string, FormattingRule][];
  isFilterBarShown: boolean;
  quickFilters: [
    number,
    {
      text: string;
    }
  ][];
  sorts: {
    column: number;
    isAbs: boolean;
    direction: string;
  }[];
  userColumnWidths: [string, number][];
  userRowHeights: [number, number][];
  customColumns: string[];
  conditionalFormats: FormattingRule[];
  reverseType: ReverseType;
  rollupConfig: UIRollupConfig | null;
  showSearchBar: boolean;
  searchValue: string;
  selectDistinctColumns: string[];
  selectedSearchColumns: string[];
  invertSearchColumns: boolean;
  pendingDataMap;
  frozenColumns: string[];
}

type DehydratedPendingDataMap<T> = [number, { data: [string, T][] }][];
class IrisGridUtils {
  /**
   * Exports the state from Grid component to a JSON stringifiable object
   * @param {IrisGridModel} model The table model to export the Grid state for
   * @param {Object} gridState The state of the Grid to export
   * @returns {Object} An object that can be stringified and imported with {{@link hydrateGridState}}
   */
  static dehydrateGridState(
    model: IrisGridModel,
    gridState: Pick<
      IrisGridProps,
      'isStuckToBottom' | 'isStuckToRight' | 'movedColumns' | 'movedRows'
    >
  ): {
    isStuckToBottom: boolean;
    isStuckToRight: boolean;
    movedColumns: { from: string; to: string }[];
    movedRows: { from: number; to: number }[];
  } {
    const {
      isStuckToBottom,
      isStuckToRight,
      movedColumns,
      movedRows,
    } = gridState;

    const { columns } = model;
    return {
      isStuckToBottom,
      isStuckToRight,
      movedColumns: [...movedColumns]
        .filter(
          ({ to, from }) =>
            to >= 0 && to < columns.length && from >= 0 && from < columns.length
        )
        .map(({ to, from }) => ({
          to: columns[to].name,
          from: columns[from].name,
        })),
      movedRows: [...movedRows],
    };
  }

  /**
   * Import a state for Grid that was exported with {{@link dehydrateGridState}}
   * @param {IrisGridModel} model The table model to import the state for
   * @param {Object} gridState The state of the panel that was saved
   * @returns {Object} The gridState props to set on the Grid
   */
  static hydrateGridState(
    model: IrisGridModel,
    gridState: {
      isStuckToBottom: boolean;
      isStuckToRight: boolean;
      movedColumns: { from: string | number; to: string | number }[];
      movedRows: { from: number; to: number }[];
    },
    customColumns = []
  ): Pick<
    IrisGridProps,
    'isStuckToBottom' | 'isStuckToRight' | 'movedColumns' | 'movedRows'
  > {
    const {
      isStuckToBottom,
      isStuckToRight,
      movedColumns,
      movedRows,
    } = gridState;

    const { columns } = model;
    const customColumnNames = IrisGridUtils.parseCustomColumnNames(
      customColumns
    );
    const columnNames = columns
      .map(({ name }) => name)
      .concat(customColumnNames);

    return {
      isStuckToBottom,
      isStuckToRight,
      movedColumns: [...movedColumns]
        .map(({ to, from }) => {
          if (
            (typeof to === 'string' || (to as unknown) instanceof String) &&
            (typeof from === 'string' || (from as unknown) instanceof String)
          ) {
            return {
              to: columnNames.findIndex(name => name === to),
              from: columnNames.findIndex(name => name === from),
            };
          }
          if (typeof to === 'string') throw Error('string');
          if (typeof from === 'string') throw Error('string');
          return { to, from };
        })
        .filter(
          ({ to, from }) =>
            to != null &&
            to >= 0 &&
            to < columnNames.length &&
            from != null &&
            from >= 0 &&
            from < columnNames.length
        ),
      movedRows: [...movedRows],
    };
  }

  /**
   * Exports the state from IrisGrid to a JSON stringifiable object
   * @param {IrisGridModel} model The table model to export the state for
   * @param {Object} irisGridState The current state of the IrisGrid
   */
  static dehydrateIrisGridState(
    model: IrisGridModel,
    irisGridState: IrisGridState
  ): DehydratedIrisGridState {
    const {
      aggregationSettings = { aggregations: [], showOnTop: false },
      advancedSettings = [],
      advancedFilters,
      customColumnFormatMap,
      isFilterBarShown,
      metrics,
      quickFilters,
      customColumns,
      conditionalFormats = [],
      reverseType,
      rollupConfig = null,
      showSearchBar,
      searchValue,
      selectDistinctColumns,
      selectedSearchColumns,
      sorts,
      invertSearchColumns,
      pendingDataMap = new Map(),
      frozenColumns,
    } = irisGridState;
    assertNotNull(metrics);
    const { userColumnWidths, userRowHeights } = metrics;
    const { columns } = model;
    return {
      advancedFilters: IrisGridUtils.dehydrateAdvancedFilters(
        columns,
        advancedFilters
      ),
      advancedSettings: [...advancedSettings],
      aggregationSettings,
      customColumnFormatMap: [...customColumnFormatMap],
      isFilterBarShown,
      quickFilters: IrisGridUtils.dehydrateQuickFilters(quickFilters),
      sorts: IrisGridUtils.dehydrateSort(sorts),
      userColumnWidths: [...userColumnWidths]
        .filter(
          ([columnIndex]) =>
            columnIndex != null &&
            columnIndex >= 0 &&
            columnIndex < columns.length
        )
        .map(([columnIndex, width]) => [columns[columnIndex].name, width]),
      userRowHeights: [...userRowHeights],
      customColumns: [...customColumns],
      conditionalFormats: [...conditionalFormats],
      reverseType,
      rollupConfig,
      showSearchBar,
      searchValue,
      selectDistinctColumns: [...selectDistinctColumns],
      selectedSearchColumns,
      invertSearchColumns,
      pendingDataMap: IrisGridUtils.dehydratePendingDataMap(
        columns,
        pendingDataMap
      ),
      frozenColumns,
    };
  }

  /**
   * Import a state for IrisGrid that was exported with {{@link dehydrateIrisGridState}}
   * @param {IrisGridModel} model The table model to import the state with
   * @param {Object} irisGridState The saved IrisGrid state
   */
  static hydrateIrisGridState(
    model: IrisGridModel,
    irisGridState: DehydratedIrisGridState
  ): IrisGridState {
    const {
      advancedFilters,
      advancedSettings = [],
      aggregationSettings = { aggregations: [], showOnTop: false },
      customColumnFormatMap,
      isFilterBarShown,
      quickFilters,
      sorts,
      customColumns,
      conditionalFormats,
      userColumnWidths,
      userRowHeights,
      reverseType,
      rollupConfig = null,
      showSearchBar,
      searchValue,
      selectDistinctColumns,
      selectedSearchColumns,
      invertSearchColumns = true,
      pendingDataMap = [],
      frozenColumns,
    } = irisGridState;
    const { columns, formatter } = model;
    return {
      advancedFilters: IrisGridUtils.hydrateAdvancedFilters(
        columns,
        advancedFilters,
        formatter.timeZone
      ),
      advancedSettings: new Map([
        ...AdvancedSettings.DEFAULTS,
        ...advancedSettings,
      ]),
      aggregationSettings,
      customColumnFormatMap: new Map(customColumnFormatMap),
      isFilterBarShown,
      quickFilters: IrisGridUtils.hydrateQuickFilters(
        columns,
        quickFilters,
        formatter.timeZone
      ),
      sorts: IrisGridUtils.hydrateSort(columns, sorts),
      userColumnWidths: new Map(
        userColumnWidths
          .map(([column, width]) => {
            if (typeof column === 'string' || column instanceof String) {
              return [columns.findIndex(({ name }) => name === column), width];
            }
            return [column, width];
          })
          .filter(
            ([column]) =>
              column != null && column >= 0 && column < columns.length
          )
      ),
      customColumns,
      conditionalFormats,
      userRowHeights: new Map(userRowHeights),
      reverseType,
      rollupConfig,
      showSearchBar,
      searchValue,
      selectDistinctColumns,
      selectedSearchColumns,
      invertSearchColumns,
      pendingDataMap: IrisGridUtils.hydratePendingDataMap(
        columns,
        pendingDataMap
      ),
      frozenColumns,
    };
  }

  /**
   * Export the IrisGridPanel state.
   * @param {IrisGridModel} model The table model the state is being dehydrated with
   * @param {Object} irisGridPanelState The current IrisGridPanel state
   * @returns {Object} The dehydrated IrisGridPanel state
   */
  static dehydrateIrisGridPanelState(
    model: IrisGridModel,
    irisGridPanelState: {
      // This needs to be changed after IrisGridPanel is done
      isSelectingPartition: unknown;
      partition: unknown;
      partitionColumn: Column;
    }
  ) {
    const {
      isSelectingPartition,
      partition,
      partitionColumn,
    } = irisGridPanelState;

    return {
      isSelectingPartition,
      partition,
      partitionColumn: partitionColumn ? partitionColumn.name : null,
    };
  }

  /**
   * Import the saved IrisGridPanel state.
   * @param {IrisGridModel} model The model the state is being hydrated with
   * @param {Object} irisGridPanelState Exported IrisGridPanel state
   * @returns {Object} The state to apply to the IrisGridPanel
   */
  static hydrateIrisGridPanelState(
    model: IrisGridModel,
    irisGridPanelState: {
      // This needs to be changed after IrisGridPanel is done
      isSelectingPartition: unknown;
      partition: unknown;
      partitionColumn: string;
    }
  ) {
    const {
      isSelectingPartition,
      partition,
      partitionColumn,
    } = irisGridPanelState;

    const { columns } = model;
    return {
      isSelectingPartition,
      partition,
      partitionColumn:
        partitionColumn != null
          ? IrisGridUtils.getColumnByName(columns, partitionColumn)
          : null,
    };
  }

  /**
   * Export the quick filters to JSON striginfiable object
   * @param quickFilters The quick filters to dehydrate
   * @returns The dehydrated quick filters
   */
  static dehydrateQuickFilters(
    quickFilters: Map<number, QuickFilter>
  ): [number, { text: string }][] {
    return [...quickFilters].map(([columnIndex, quickFilter]) => {
      const { text } = quickFilter;
      return [columnIndex, { text }];
    });
  }

  /**
   * Import the saved quick filters to apply to the columns. Does not actually apply the filters.
   * @param {dh.Column[]} columns The columns the filters will be applied to
   * @param {Object[]} savedQuickFilters Exported quick filters definitions
   * @param {string} timeZone The time zone to make this value in if it is a date type. E.g. America/New_York
   * @returns {QuickFilter[]} The quick filters to apply to the columns
   */
  static hydrateQuickFilters(
    columns: Column[],
    savedQuickFilters: [number, { text: string }][],
    timeZone: string
  ): Map<number, QuickFilter | null> {
    const importedFilters = savedQuickFilters.map(
      ([columnIndex, quickFilter]: [number, { text: string }]): [
        number,
        { text: string; filter: FilterCondition | null }
      ] => {
        const { text } = quickFilter;

        let filter = null;
        try {
          const column = IrisGridUtils.getColumn(columns, columnIndex);
          if (column != null) {
            filter = TableUtils.makeQuickFilter(column, text, timeZone);
          }
        } catch (error) {
          log.error('hydrateQuickFilters error with', text, error);
        }

        return [columnIndex, { text, filter }];
      }
    );

    return new Map(importedFilters);
  }

  /**
   * Export the advanced filters from the provided columns to JSON striginfiable object
   * @param columns The columns for the filters
   * @param advancedFilters The advanced filters to dehydrate
   * @returns {Object} The dehydrated advanced filters
   */
  static dehydrateAdvancedFilters(
    columns: Column[],
    advancedFilters: Map<number, AdvancedFilter>
  ): [number, { options: Options }][] {
    return [...advancedFilters].map(([columnIndex, advancedFilter]) => {
      const column = IrisGridUtils.getColumn(columns, columnIndex);
      assertNotNull(column);
      const options = IrisGridUtils.dehydrateAdvancedFilterOptions(
        column,
        advancedFilter.options
      );
      return [columnIndex, { options }];
    });
  }

  /**
   * Import the saved advanced filters to apply to the columns. Does not actually apply the filters.
   * @param {dh.Columns[]} columns The columns the filters will be applied to
   * @param {Object[]} savedAdvancedFilters Exported advanced filters definitions
   * @param {string} timeZone The time zone to make this filter in if it is a date type. E.g. America/New_York
   * @returns {AdvancedFilter[]} The advanced filters to apply to the columns
   */
  static hydrateAdvancedFilters(
    columns: Column[],
    savedAdvancedFilters: [number, { options: Options }][],
    timeZone: string
  ): Map<number, AdvancedFilter> {
    const importedFilters = savedAdvancedFilters.map(
      ([columnIndex, advancedFilter]: [number, { options: Options }]): [
        number,
        { options: Options; filter: FilterCondition | null }
      ] => {
        const column = IrisGridUtils.getColumn(columns, columnIndex);
        assertNotNull(column);
        const options = IrisGridUtils.hydrateAdvancedFilterOptions(
          column,
          advancedFilter.options
        );
        let filter = null;

        try {
          const column = IrisGridUtils.getColumn(columns, columnIndex);
          if (column != null) {
            filter = TableUtils.makeAdvancedFilter(column, options, timeZone);
          }
        } catch (error) {
          log.error('hydrateAdvancedFilters error with', options, error);
        }

        return [columnIndex, { options, filter }];
      }
    );

    return new Map(importedFilters);
  }

  static dehydrateAdvancedFilterOptions(
    column: Column,
    options: Options
  ): Options {
    const { selectedValues, ...otherOptions } = options;
    return {
      selectedValues: selectedValues.map((value: unknown) =>
        IrisGridUtils.dehydrateValue(value, column?.type)
      ),
      ...otherOptions,
    };
  }

  static hydrateAdvancedFilterOptions(
    column: Column,
    options: Options
  ): Options {
    const { selectedValues, ...otherOptions } = options;
    return {
      selectedValues: selectedValues.map(value =>
        IrisGridUtils.hydrateValue(value, column?.type)
      ),
      ...otherOptions,
    };
  }

  static dehydratePendingDataMap(
    columns: Column[],
    pendingDataMap: Map<number, UIRow>
  ): DehydratedPendingDataMap<CellData> {
    return [...pendingDataMap].map(
      ([rowIndex, { data }]: [number, { data: Map<ModelIndex, CellData> }]) => [
        rowIndex,
        {
          data: [...data].map(([c, value]) => [
            columns[c].name,
            IrisGridUtils.dehydrateValue(value, columns[c].type) as CellData,
          ]),
        },
      ]
    );
  }

  static hydratePendingDataMap(
    columns: Column[],
    pendingDataMap: DehydratedPendingDataMap<CellData>
  ): Map<
    number,
    { data: Map<ModelIndex | null, CellData | LongWrapper | null> }
  > {
    const columnMap = new Map<string, number>();
    const getColumnIndex = (columnName: string) => {
      if (!columnMap.has(columnName)) {
        columnMap.set(
          columnName,
          columns.findIndex(({ name }) => name === columnName)
        );
      }
      return columnMap.get(columnName);
    };

    return new Map(
      pendingDataMap.map(
        ([rowIndex, { data }]: [number, { data: [string, CellData][] }]) => [
          rowIndex,
          {
            data: new Map(
              data.map(([columnName, value]) => {
                const index = getColumnIndex(columnName);
                assertNotUndefined(index);
                return [
                  getColumnIndex(columnName) ?? null,
                  IrisGridUtils.hydrateValue(value, columns[index].type),
                ];
              })
            ),
          },
        ]
      )
    );
  }

  /**
   * Dehydrates/serializes a value for storage.
   * @param {Any} value The value to dehydrate
   * @param {String} columnType The column type
   */
  static dehydrateValue<T>(value: T, columnType: string) {
    if (TableUtils.isDateType(columnType)) {
      return IrisGridUtils.dehydrateDateTime(
        (value as unknown) as number | DateWrapper | Date
      );
    }

    if (TableUtils.isLongType(columnType)) {
      return IrisGridUtils.dehydrateLong(value);
    }

    return value;
  }

  /**
   * Hydrate a value from it's serialized state
   * @param {Any} value The dehydrated value that needs to be hydrated
   * @param {String} columnType The type of column
   */
  static hydrateValue<T>(value: T, columnType: string) {
    if (TableUtils.isDateType(columnType)) {
      return IrisGridUtils.hydrateDateTime((value as unknown) as string);
    }

    if (TableUtils.isLongType(columnType)) {
      return IrisGridUtils.hydrateLong((value as unknown) as string);
    }

    return value;
  }

  static dehydrateDateTime(value: number | DateWrapper | Date): string | null {
    return value != null
      ? dh.i18n.DateTimeFormat.format(DateUtils.FULL_DATE_FORMAT, value)
      : null;
  }

  static hydrateDateTime(value: string): DateWrapper | null {
    return value != null
      ? dh.i18n.DateTimeFormat.parse(DateUtils.FULL_DATE_FORMAT, value)
      : null;
  }

  static dehydrateLong<T>(value: T): string | null {
    return value != null ? `${value}` : null;
  }

  static hydrateLong(value: string): LongWrapper | null {
    return value != null ? dh.LongWrapper.ofString(value) : null;
  }

  /**
   * Export the sorts from the provided table sorts to JSON stringifiable object
   * @param {dh.Sort[]} sorts The table sorts
   * @returns {Object} The dehydrated sorts
   */
  static dehydrateSort(sorts: Sort[]) {
    return sorts.map(sort => {
      const { column, isAbs, direction } = sort;
      return {
        column: column.index,
        isAbs,
        direction,
      };
    });
  }

  /**
   * Import the saved sorts to apply to the table. Does not actually apply the sort.
   * @param {dh.Column[]} columns The columns the sorts will be applied to
   * @param {Object[]} sorts Exported sort definitions
   * @returns {dh.Sort[]} The sorts to apply to the table
   */
  static hydrateSort(
    columns: Column[],
    sorts: { column: number; isAbs: boolean; direction: string }[]
  ): Sort[] {
    return (
      sorts
        .map(sort => {
          const { column: columnIndex, isAbs, direction } = sort;
          if (direction === TableUtils.sortDirection.reverse) {
            return dh.Table.reverse();
          }
          const column = IrisGridUtils.getColumn(columns, columnIndex);
          if (column != null) {
            let columnSort = column.sort();
            if (isAbs) {
              columnSort = columnSort.abs();
            }
            if (direction === TableUtils.sortDirection.descending) {
              columnSort = columnSort.desc();
            } else {
              columnSort = columnSort.asc();
            }
            return columnSort;
          }

          return null;
        })
        // If we can't find the column any more, it's null, filter it out
        // If the item is a reverse sort item, filter it out - it will get applied with the `reverseType` property
        // This should only happen when loading a legacy dashboard
        .filter(
          item =>
            item != null && item.direction !== TableUtils.sortDirection.reverse
        ) as Sort[]
    );
  }

  /**
   * Pulls just the table settings from the panel state, eg. filters/sorts
   * @param {Object} panelState The dehydrated panel state
   * @returns {Object} A dehydrated table settings object, { partition, partitionColumn, advancedFilters, quickFilters, sorts }
   */
  static extractTableSettings(panelState, inputFilters = []) {
    const { irisGridPanelState, irisGridState } = panelState;
    const { partitionColumn, partition } = irisGridPanelState;
    const { advancedFilters, quickFilters, sorts } = irisGridState;

    return {
      advancedFilters,
      inputFilters,
      partition,
      partitionColumn,
      quickFilters,
      sorts,
    };
  }

  /**
   * Applies the passed in table settings directly to the provided table
   * @param {dh.Table} table The table to apply the settings to
   * @param {Object} tableSettings Dehydrated table settings extracted with `extractTableSettings`
   * @param {string} timeZone The time zone to make this value in if it is a date type. E.g. America/New_York
   */
  static applyTableSettings(table: Table, tableSetting, timeZone: string) {
    const { columns } = table;
    const quickFilters = IrisGridUtils.getFiltersFromFilterMap(
      IrisGridUtils.hydrateQuickFilters(
        columns,
        tableSettings.quickFilters,
        timeZone
      )
    );
    const advancedFilters = IrisGridUtils.getFiltersFromFilterMap(
      IrisGridUtils.hydrateAdvancedFilters(
        columns,
        tableSettings.advancedFilters,
        timeZone
      )
    );
    const inputFilters = IrisGridUtils.getFiltersFromInputFilters(
      columns,
      tableSettings.inputFilters,
      timeZone
    );
    const sorts = IrisGridUtils.hydrateSort(columns, tableSettings.sorts);

    let filters = [...quickFilters, ...advancedFilters];
    const { partition, partitionColumn: partitionColumnName } = tableSettings;
    if (partition && partitionColumnName) {
      const partitionColumn = IrisGridUtils.getColumnByName(
        columns,
        partitionColumnName
      );
      if (partitionColumn) {
        const partitionFilter = partitionColumn
          .filter()
          .eq(dh.FilterValue.ofString(partition));
        filters = [partitionFilter, ...filters];
      }
    }
    filters = [...inputFilters, ...filters];

    table.applyFilter(filters);
    table.applySort(sorts);
  }

  static getInputFiltersForColumns(
    columns: Column[],
    inputFilters: InputFilter[] = []
  ): InputFilter[] {
    return inputFilters.filter(({ name, type }) =>
      columns.find(
        ({ name: columnName, type: columnType }) =>
          columnName === name && columnType === type
      )
    );
  }

  static getFiltersFromInputFilters(
    columns: Column[],
    inputFilters = [],
    timeZone: string
  ) {
    return inputFilters
      .map(({ name, type, value }) => {
        const column = columns.find(
          ({ name: columnName, type: columnType }) =>
            columnName === name && columnType === type
        );
        if (column) {
          try {
            return TableUtils.makeQuickFilter(column, value, timeZone);
          } catch (e) {
            // It may be unable to create it because user hasn't completed their input
            log.debug('Unable to create input filter', e);
          }
        }

        return null;
      })
      .filter(filter => filter != null) as FilterCondition[];
  }

  static getFiltersFromFilterMap(
    filterMap: Map<number, QuickFilter | AdvancedFilter | null>
  ): FilterCondition[] {
    const filters = [];

    const keys = Array.from(filterMap.keys());
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      const item = filterMap.get(key);
      if (item && item.filter != null) {
        filters.push(item.filter);
      }
    }

    return filters;
  }

  /**
   * Get array of hidden column indexes
   * @param {Map} userColumnWidths Map of user column widths
   * @returns {number[]} Array of hidden column indexes
   */
  static getHiddenColumns(userColumnWidths: ModelSizeMap): number[] {
    return [...userColumnWidths.entries()]
      .filter(([, value]) => value === 0)
      .map(([key]) => key);
  }

  static parseCustomColumnNames(customColumns: string[]): string[] {
    return customColumns.map(customColumn => customColumn.split('=')[0]);
  }

  static getRemovedCustomColumnNames(
    oldCustomColumns: string[],
    customColumns: string[]
  ): string[] {
    const oldCustomColumnsNames = IrisGridUtils.parseCustomColumnNames(
      oldCustomColumns
    );
    const customColumnNames = IrisGridUtils.parseCustomColumnNames(
      customColumns
    );
    return oldCustomColumnsNames.filter(
      oldCustomColumnName => !customColumnNames.includes(oldCustomColumnName)
    );
  }

  static removeSortsInColumns(sorts: Sort[], columnNames: string[]): Sort[] {
    return sorts.filter(sort => !columnNames.includes(sort.column.name));
  }

  static removeFiltersInColumns<T>(
    columns: Column[],
    filters: Map<number, T>,
    removedColumnNames: string[]
  ): Map<number, T> {
    const columnNames = columns.map(({ name }) => name);
    const newFilter = new Map(filters);
    removedColumnNames.forEach(columnName =>
      newFilter.delete(columnNames.indexOf(columnName))
    );
    return newFilter;
  }

  static removeColumnFromMovedColumns(
    columns: Column[],
    movedColumns: MoveOperation[],
    removedColumnNames: string[]
  ): MoveOperation[] {
    const columnNames = columns.map(({ name }) => name);
    let newMoves = [...movedColumns];
    for (let i = 0; i < removedColumnNames.length; i += 1) {
      const removedColumnName = removedColumnNames[i];
      let removedColumnIndex = columnNames.findIndex(
        name => name === removedColumnName
      );
      const moves = [];
      for (let j = 0; j < newMoves.length; j += 1) {
        const move = newMoves[j];
        const newMove = { ...move };
        // remove the move if it's a removed column move
        // from-=1 & to-=! if the from/to column is placed after the removed column
        if (removedColumnIndex !== move.from) {
          if (move.from > removedColumnIndex) {
            newMove.from -= 1;
          }
          if (move.to >= removedColumnIndex) {
            newMove.to -= 1;
          }
          if (newMove.from !== newMove.to) {
            moves.push(newMove);
          }
        }
        // get the next index of the removed column after the move
        if (move.from === removedColumnIndex) {
          removedColumnIndex = move.to;
        } else if (
          move.from < removedColumnIndex &&
          removedColumnIndex < move.to
        ) {
          removedColumnIndex -= 1;
        } else if (
          move.to <= removedColumnIndex &&
          removedColumnIndex < move.from
        ) {
          removedColumnIndex += 1;
        }
      }
      newMoves = moves;
      columnNames.splice(
        columnNames.findIndex(name => name === removedColumnName),
        1
      );
    }
    return newMoves;
  }

  static removeColumnsFromSelectDistinctColumns(
    selectDistinctColumns: string[],
    removedColumnNames: string[]
  ): string[] {
    return selectDistinctColumns.filter(
      columnName => !removedColumnNames.includes(columnName)
    );
  }

  static getVisibleColumnsInRange(
    tableColumns: Column[],
    left: number,
    right: number,
    movedColumns: MoveOperation[],
    hiddenColumns: number[]
  ): Column[] {
    const columns = [] as Column[];
    for (let i = left; i <= right; i += 1) {
      const modelIndex = GridUtils.getModelIndex(i, movedColumns);
      if (
        modelIndex >= 0 &&
        modelIndex < tableColumns.length &&
        !hiddenColumns.includes(modelIndex)
      ) {
        columns.push(tableColumns[modelIndex]);
      }
    }
    return columns;
  }

  static getPrevVisibleColumns(
    tableColumns: Column[],
    startIndex: number,
    count: number,
    movedColumns: MoveOperation[],
    hiddenColumns: number[]
  ): Column[] {
    const columns = [];
    let i = startIndex;
    while (i >= 0 && columns.length < count) {
      const modelIndex = GridUtils.getModelIndex(i, movedColumns);
      if (
        modelIndex >= 0 &&
        modelIndex < tableColumns.length &&
        !hiddenColumns.includes(modelIndex)
      ) {
        columns.unshift(tableColumns[modelIndex]);
      }
      i -= 1;
    }
    return columns;
  }

  static getNextVisibleColumns(
    tableColumns: Column[],
    startIndex: ModelIndex,
    count: number,
    movedColumns: MoveOperation[],
    hiddenColumns: number[]
  ): Column[] {
    const columns = [];
    let i = startIndex;
    while (i < tableColumns.length && columns.length < count) {
      const modelIndex = GridUtils.getModelIndex(i, movedColumns);
      if (
        modelIndex >= 0 &&
        modelIndex < tableColumns.length &&
        !hiddenColumns.includes(modelIndex)
      ) {
        columns.push(tableColumns[modelIndex]);
      }
      i += 1;
    }
    return columns;
  }

  static getColumnsToFetch(
    tableColumns: Column[],
    viewportColumns: Column[],
    alwaysFetchColumnNames: string[]
  ): Column[] {
    const columnsToFetch = [...viewportColumns];
    alwaysFetchColumnNames.forEach(columnName => {
      const column = tableColumns.find(({ name }) => name === columnName);
      if (column != null && !viewportColumns.includes(column)) {
        columnsToFetch.push(column);
      }
    });
    return columnsToFetch;
  }

  static getModelViewportColumns(
    columns: Column[],
    left: number | null,
    right: number | null,
    movedColumns: MoveOperation[],
    hiddenColumns: number[] = [],
    alwaysFetchColumnNames: string[] = [],
    bufferPages: number = 0
  ) {
    if (left == null || right == null) {
      return null;
    }

    const columnsCenter = IrisGridUtils.getVisibleColumnsInRange(
      columns,
      left,
      right,
      movedColumns,
      hiddenColumns
    );
    const bufferWidth = columnsCenter.length * bufferPages;
    const columnsLeft = IrisGridUtils.getPrevVisibleColumns(
      columns,
      left - 1,
      bufferWidth,
      movedColumns,
      hiddenColumns
    );
    const columnsRight = IrisGridUtils.getNextVisibleColumns(
      columns,
      right + 1,
      bufferWidth,
      movedColumns,
      hiddenColumns
    );

    const bufferedColumns = [...columnsLeft, ...columnsCenter, ...columnsRight];

    return IrisGridUtils.getColumnsToFetch(
      columns,
      bufferedColumns,
      alwaysFetchColumnNames
    );
  }

  /**
   * Get the dh.RangeSet representation of the provided ranges.
   * Ranges are sorted prior to creating the RangeSet. Only the rows are taken into account,
   * RangeSet does not have an option for columns.
   * @param {GridRange[]} ranges The ranges to get the range set for
   * @returns {dh.RangeSet} The rangeset for the provided ranges
   */
  static rangeSetFromRanges(ranges: GridRange[]) {
    const rangeSets = ranges
      .slice()
      .sort((a, b): number => {
        assertNotNull(a.startRow);
        assertNotNull(b.startRow);
        return a.startRow - b.startRow;
      })
      .map(range => {
        const { startRow, endRow } = range;
        return dh.RangeSet.ofRange(startRow, endRow);
      });
    return dh.RangeSet.ofRanges(rangeSets);
  }

  /**
   * Validate whether the ranges passed in are valid to take a snapshot from.
   * Multiple selections are valid if all of the selected rows have the same columns selected.
   *
   * @param ranges The ranges to validate
   * @returns True if the ranges are valid, false otherwise
   */
  static isValidSnapshotRanges(ranges: GridRange[]): boolean {
    if (!ranges || ranges.length === 0) {
      return false;
    }

    // To verify all the rows selected have the same set of columns selected, build a map with string representations
    // of each range.
    const rangeMap = new Map();
    for (let i = 0; i < ranges.length; i += 1) {
      const range = ranges[i];
      const rowMapIndex = `${range.startRow}:${range.endRow}`;
      const columnMapIndex = `${range.startColumn}:${range.endColumn}`;
      if (!rangeMap.has(rowMapIndex)) {
        rangeMap.set(rowMapIndex, []);
      }
      rangeMap.get(rowMapIndex).push(columnMapIndex);
    }

    const keys = [...rangeMap.keys()];
    const matchColumnRanges = rangeMap.get(keys[0]).sort().join(',');
    for (let i = 1; i < keys.length; i += 1) {
      if (rangeMap.get(keys[i]).sort().join(',') !== matchColumnRanges) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if the provided value is a valid table index
   * @param {any} value A value to check if it's a valid table index
   */
  static isValidIndex(value: unknown): boolean {
    if (!Number.isInteger(value)) {
      return false;
    }
    if (!(typeof value === 'number')) {
      return false;
    }
    return value >= 0;
  }

  /**
   * Returns all columns used in any of the ranges provided
   * @param {GridRange[]} ranges The model ranges to get columns for
   * @param {dh.Column[]} allColumns All the columns to pull from
   * @returns {dh.Column[]} The columns selected in the range
   */
  static columnsFromRanges(
    ranges: GridRange[],
    allColumns: Column[]
  ): Column[] {
    if (!ranges || ranges.length === 0) {
      return [];
    }
    if (ranges[0].startColumn === null && ranges[0].endColumn === null) {
      // Snapshot of all the columns
      return allColumns;
    }

    const columnSet = new Set() as Set<number>;
    for (let i = 0; i < ranges.length; i += 1) {
      const range = ranges[i];
      for (
        let c = range.startColumn ?? (0 as number);
        c <= (range.endColumn ?? allColumns.length - 1);
        c += 1
      ) {
        columnSet.add(c);
      }
    }
    return [...columnSet].map(c => allColumns[c]);
  }

  /**
   * Transforms an iris data snapshot into a simple data matrix
   * @param {dh.TableData} data The Iris formatted table data
   * @returns {unknown[][]} A matrix of the values of the data
   */
  static snapshotDataToMatrix(data: TableData) {
    const { columns, rows } = data;
    const result = [];
    for (let r = 0; r < rows.length; r += 1) {
      const row = rows[r];
      const rowData = [];
      for (let c = 0; c < columns.length; c += 1) {
        const column = columns[c];
        const value = row.get(column);
        rowData.push(value);
      }
      result.push(rowData);
    }
    return result;
  }

  /**
   * Hydrate model rollup config
   * @param {Array} originalColumns Original model columns
   * @param {Object} config Dehydrated rollup config
   * @param {Object} aggregationSettings Aggregation settings
   * @returns {Object} Rollup config for the model
   */
  static getModelRollupConfig(
    originalColumns: Column[],
    config: UIRollupConfig,
    aggregationSettings: AggregationSettings
  ): RollupConfig | null {
    if ((config?.columns?.length ?? 0) === 0) {
      return null;
    }

    const {
      columns: groupingColumns = [],
      showConstituents: includeConstituents = true,
      showNonAggregatedColumns = true,
      includeDescriptions = true,
    } = config ?? {};
    const { aggregations = [] } = aggregationSettings ?? {};
    const aggregationColumns = aggregations.map(
      ({ operation, selected, invert }) =>
        AggregationUtils.isRollupOperation(operation)
          ? []
          : AggregationUtils.getOperationColumnNames(
              originalColumns,
              operation,
              selected,
              invert
            )
    );

    const aggregationMap = {} as Record<AggregationOperation, string[]>;
    // Aggregation columns should show first, add them first
    for (let i = 0; i < aggregations.length; i += 1) {
      aggregationMap[aggregations[i].operation] = aggregationColumns[i];
    }

    if (showNonAggregatedColumns) {
      // Filter out any column that already has an aggregation or grouping
      const nonAggregatedColumnSet = new Set(
        originalColumns
          .map(c => c.name)
          .filter(name => !groupingColumns.includes(name))
      );
      aggregationColumns.forEach(columns => {
        columns.forEach(name => nonAggregatedColumnSet.delete(name));
      });

      if (nonAggregatedColumnSet.size > 0) {
        const existingColumns =
          aggregationMap[AggregationOperation.FIRST] ?? [];
        aggregationMap[AggregationOperation.FIRST] = [
          ...existingColumns,
          ...nonAggregatedColumnSet,
        ];
      }
    }

    return {
      groupingColumns,
      includeConstituents,
      includeDescriptions,
      aggregations: aggregationMap,
    };
  }

  /**
   * @param {Map} pendingDataMap Map of pending data
   * @returns {Map} A map with the errors in the pending data
   */
  static getPendingErrors(pendingDataMap: Map<number, UIRow>): void {
    pendingDataMap.forEach((row, rowIndex) => {
      if (!IrisGridUtils.isValidIndex(rowIndex)) {
        throw new Error(`Invalid rowIndex ${rowIndex}`);
      }

      const { data } = row;
      data.forEach((value, columnIndex) => {
        if (!IrisGridUtils.isValidIndex(columnIndex)) {
          throw new Error(`Invalid columnIndex ${columnIndex}`);
        }
      });
    });
  }

  /**
   * Retrieves a column from the provided array at the index, or `null` and logs an error if it's invalid
   *
   * @param {dh.Columns[]} columns The columns to get the column from
   * @param {Number} columnIndex The column index to get
   */
  static getColumn(columns: Column[], columnIndex: number): Column | null {
    if (columnIndex < columns.length) {
      return columns[columnIndex];
    }

    log.error('Unable to retrieve column', columnIndex, '>=', columns.length);

    return null;
  }

  /**
   * Retrieves a column from the provided array matching the name, or `null` and logs an error if not found
   * @param {dh.Column[]} columns The columns to get the column from
   * @param {String} columnName The column name to retrieve
   */
  static getColumnByName(
    columns: Column[],
    columnName: string
  ): Column | undefined {
    const column = columns.find(({ name }) => name === columnName);
    if (column == null) {
      log.error(
        'Unable to retrieve column by name',
        columnName,
        columns.map(({ name }) => name)
      );
    }

    return column;
  }

  /**
   * Get filter configs with column names changed to indexes, exclude missing columns
   * @param {dh.Column[]} columns The columns to get column indexes from
   * @param {Object[]} filters Filter configs
   * @returns {Object[]} Updated filter configs with column names changed to indexes
   */
  static changeFilterColumnNamesToIndexes(
    columns: Column[],
    filters: { name: string; filter: unknown }[]
  ) {
    return filters
      .map(({ name, filter }) => {
        const index = columns.findIndex(column => column.name === name);
        return index < 0 ? null : [index, filter];
      })
      .filter(filterConfig => filterConfig != null);
  }
}

export default IrisGridUtils;