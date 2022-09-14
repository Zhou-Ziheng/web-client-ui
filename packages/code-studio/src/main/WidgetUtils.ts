import { ChartModel, ChartModelFactory } from '@deephaven/chart';
import dh, {
  Table,
  VariableTypeUnion,
  IdeConnection,
} from '@deephaven/jsapi-shim';
import {
  IrisGridModel,
  IrisGridModelFactory,
  IrisGridUtils,
} from '@deephaven/iris-grid';
import { getTimeZone, store } from '@deephaven/redux';
import {
  ChartPanelMetadata,
  GLChartPanelState,
  isChartPanelTableMetadata,
} from '@deephaven/dashboard-core-plugins';

export type GridPanelMetadata = {
  table: string;
};

export const createChartModel = async (
  connection: IdeConnection,
  metadata: ChartPanelMetadata,
  panelState?: GLChartPanelState
): Promise<ChartModel> => {
  let settings;
  let tableName;
  let figureName;
  let tableSettings;

  if (isChartPanelTableMetadata(metadata)) {
    settings = metadata.settings;
    tableName = metadata.table;
    figureName = '';
    tableSettings = metadata.tableSettings;
  } else {
    settings = {};
    tableName = '';
    figureName = metadata.figure;
    tableSettings = {};
  }
  if (panelState) {
    if (panelState.tableSettings) {
      tableSettings = panelState.tableSettings;
    }
    if (panelState.table) {
      tableName = panelState.table;
    }
    if (panelState.figure) {
      figureName = panelState.figure;
    }
    if (panelState.settings) {
      settings = {
        ...settings,
        ...panelState.settings,
      };
    }
  }

  if (figureName) {
    const definition = {
      title: figureName,
      name: figureName,
      type: dh.VariableType.FIGURE,
    };
    const figure = await connection.getObject(definition);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ChartModelFactory.makeModel(settings as any, figure);
  }

  const definition = {
    title: figureName,
    name: tableName,
    type: dh.VariableType.TABLE,
  };
  const table = await connection.getObject(definition);

  IrisGridUtils.applyTableSettings(
    table,
    tableSettings,
    getTimeZone(store.getState())
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ChartModelFactory.makeModelFromSettings(settings as any, table);
};

export const createGridModel = async (
  connection: IdeConnection,
  metadata: GridPanelMetadata,
  type: VariableTypeUnion = dh.VariableType.TABLE
): Promise<IrisGridModel> => {
  const { table: tableName } = metadata;
  const definition = { title: tableName, name: tableName, type };
  const table = (await connection.getObject(definition)) as Table;
  return IrisGridModelFactory.makeModel(table);
};

export default { createChartModel, createGridModel };
