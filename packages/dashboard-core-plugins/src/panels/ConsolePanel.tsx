// Wrapper for the Console for use in a golden layout container
// Will probably need to handle window popping out from golden layout here.
import React, { PureComponent, ReactElement, RefObject } from 'react';
import shortid from 'shortid';
import debounce from 'lodash.debounce';
import { connect } from 'react-redux';
import {
  CommandHistoryStorage,
  Console,
  ConsoleConstants,
} from '@deephaven/console';
import { PanelEvent } from '@deephaven/dashboard';
import { IdeSession, VariableDefinition } from '@deephaven/jsapi-shim';
import Log from '@deephaven/log';
import {
  getCommandHistoryStorage,
  getTimeZone,
  RootState,
} from '@deephaven/redux';
import { Container, EventEmitter } from '@deephaven/golden-layout';
import { assertNotNull } from '@deephaven/utils';
import { JSZipObject } from 'jszip';
import { ConsoleEvent } from '../events';
import './ConsolePanel.scss';
import Panel from './Panel';
import { getDashboardSessionWrapper } from '../redux';

const log = Log.module('ConsolePanel');

const DEBOUNCE_PANEL_STATE_UPDATE = 500;

const DEFAULT_PANEL_STATE = Object.freeze({
  consoleSettings: {},
  itemIds: [],
});

interface ConsoleSettings {
  isClosePanelsOnDisconnectEnabled?: boolean;
}

interface PanelState {
  consoleSettings: ConsoleSettings;
  itemIds: [string, string][];
}

type ItemIds = Map<string, string>;

interface SessionWrapper {
  session: IdeSession;
  config: {
    type: string;
    id: string;
  };
}
interface ConsolePanelProps {
  commandHistoryStorage: CommandHistoryStorage;
  glContainer: Container;
  glEventHub: EventEmitter;

  panelState: PanelState;

  sessionWrapper: SessionWrapper;

  timeZone: string;
  unzip: (file: File) => Promise<JSZipObject[]>;
}

interface ConsolePanelState {
  consoleSettings: ConsoleSettings;
  itemIds: ItemIds;

  objectMap: Map<string, VariableDefinition>;

  // eslint-disable-next-line react/no-unused-state
  panelState: PanelState;
  error: unknown;
}

export class ConsolePanel extends PureComponent<
  ConsolePanelProps,
  ConsolePanelState
> {
  static defaultProps = {
    panelState: null,
    unzip: null,
  };

  static COMPONENT = 'ConsolePanel';

  static TITLE = 'Console';

  constructor(props: ConsolePanelProps) {
    super(props);

    this.handleFocusCommandHistory = this.handleFocusCommandHistory.bind(this);
    this.handleOpenObject = this.handleOpenObject.bind(this);
    this.handleCloseObject = this.handleCloseObject.bind(this);
    this.handleResize = this.handleResize.bind(this);
    this.handleSettingsChange = this.handleSettingsChange.bind(this);
    this.handleShow = this.handleShow.bind(this);
    this.handleTabBlur = this.handleTabBlur.bind(this);
    this.handleTabFocus = this.handleTabFocus.bind(this);
    this.handlePanelMount = this.handlePanelMount.bind(this);

    this.consoleRef = React.createRef();

    const { panelState: initialPanelState } = props;
    const panelState = {
      ...DEFAULT_PANEL_STATE,
      ...(initialPanelState || {}),
    };
    const { consoleSettings, itemIds } = panelState;

    this.state = {
      consoleSettings,
      itemIds: new Map(itemIds),

      objectMap: new Map(),
      error: undefined,
      // eslint-disable-next-line react/no-unused-state
      panelState, // Dehydrated panel state that can load this panel
    };
  }

  componentDidMount(): void {
    const { glEventHub } = this.props;
    // Need to close the disconnected panels when we're first loaded,
    // as they may have been saved with the dashboard
    this.closeDisconnectedPanels();
    glEventHub.on(PanelEvent.MOUNT, this.handlePanelMount);
    this.subscribeToFieldUpdates();
  }

  componentDidUpdate(
    prevProps: ConsolePanelProps,
    prevState: ConsolePanelState
  ): void {
    const { consoleSettings, itemIds } = this.state;
    if (
      prevState.consoleSettings !== consoleSettings ||
      prevState.itemIds !== itemIds
    ) {
      this.savePanelState();
    }
  }

  componentWillUnmount(): void {
    const { glEventHub } = this.props;
    this.savePanelState.flush();
    glEventHub.off(PanelEvent.MOUNT, this.handlePanelMount);
    this.objectSubscriptionCleanup?.();
  }

  consoleRef: RefObject<Console>;

  objectSubscriptionCleanup?: () => void;

  subscribeToFieldUpdates(): void {
    const { sessionWrapper } = this.props;
    const { session } = sessionWrapper;

    this.objectSubscriptionCleanup = session.subscribeToFieldUpdates(
      updates => {
        log.debug('Got updates', updates);
        this.setState(({ objectMap }) => {
          const { updated, created, removed } = updates;

          // Remove from the array if it's been removed OR modified. We'll add it back after if it was modified.
          const objectsToRemove = [...updated, ...removed];
          const newObjectMap = new Map(objectMap);
          objectsToRemove.forEach(toRemove => {
            const { title } = toRemove;
            if (title) {
              newObjectMap.delete(title);
            }
          });

          // Now add all the modified and updated widgets back in
          const objectsToAdd = [...updated, ...created];
          objectsToAdd.forEach(toAdd => {
            if (toAdd.title) {
              newObjectMap.set(toAdd.title, toAdd);
            }
          });

          return { objectMap: newObjectMap };
        });
      }
    );
  }

  setItemId(name: string, id: string): void {
    this.setState(({ itemIds }) => {
      const newItemIds = new Map(itemIds);
      newItemIds.set(name, id);
      return { itemIds: newItemIds };
    });
  }

  getItemId(name: string, createIfNecessary = true): string | undefined {
    const { itemIds } = this.state;
    let id = itemIds.get(name);
    if (id == null && createIfNecessary) {
      id = shortid.generate();
      this.setItemId(name, id);
    }
    return id;
  }

  handleTabBlur(): void {
    if (this.consoleRef && this.consoleRef.current) {
      ((this.consoleRef.current as unknown) as HTMLElement).blur();
    }
  }

  handleTabFocus(): void {
    if (this.consoleRef) {
      this.consoleRef.current?.focus();
    }
  }

  handlePanelMount(panel: {
    props: { id: string; metadata: { sourcePanelId: string } };
  }): void {
    const { itemIds } = this.state;
    const panelId = panel?.props?.id;
    const sourceId = panel?.props?.metadata?.sourcePanelId;
    if (panelId && sourceId) {
      // Check if the panel was created from a panel in this console
      const pandelIds = new Set(itemIds.values());
      if (pandelIds.has(sourceId)) {
        // The Chart Panel does not have name so map panelId to panelId
        this.setItemId(panelId, panelId);
      }
    }
  }

  handleFocusCommandHistory(): void {
    const { glEventHub } = this.props;
    glEventHub.emit(ConsoleEvent.FOCUS_HISTORY);
  }

  handleResize(): void {
    this.updateDimensions();
  }

  handleShow(): void {
    this.updateDimensions();
  }

  handleOpenObject(object: VariableDefinition): void {
    const { sessionWrapper } = this.props;
    const { session } = sessionWrapper;
    this.openWidget(object, session);
  }

  handleCloseObject(object: VariableDefinition): void {
    const { title } = object;
    if (title) {
      const id = this.getItemId(title, false);
      const { glEventHub } = this.props;
      glEventHub.emit(PanelEvent.CLOSE, id);
    }
  }

  handleSettingsChange(consoleSettings: Record<string, unknown>): void {
    const { glEventHub } = this.props;
    log.debug('handleSettingsChange', consoleSettings);
    this.setState({
      consoleSettings,
    });
    glEventHub.emit(ConsoleEvent.SETTINGS_CHANGED, consoleSettings);
  }

  /**
   * @param {VariableDefinition} widget The widget to open
   * @param {dh.Session} session The session object
   */
  openWidget(widget: VariableDefinition, session: IdeSession): void {
    const { glEventHub } = this.props;
    const { title } = widget;
    assertNotNull(title);
    const panelId = this.getItemId(title);
    const openOptions = {
      fetch: () => session.getObject(widget),
      panelId,
      widget,
    };

    log.debug('openWidget', openOptions);

    glEventHub.emit(PanelEvent.OPEN, openOptions);
  }

  addCommand(command: string, focus = true, execute = false): void {
    this.consoleRef.current?.addCommand(command, focus, execute);
  }

  /**
   * Close the disconnected panels from this session
   * @param {boolean} force True to force the panels closed regardless of the current setting
   */
  closeDisconnectedPanels(force = false): void {
    const { consoleSettings, itemIds } = this.state;
    const { isClosePanelsOnDisconnectEnabled = true } = consoleSettings;
    if (!isClosePanelsOnDisconnectEnabled && !force) {
      return;
    }

    const panelIdsToClose = [...itemIds.values()];
    const { glEventHub } = this.props;
    panelIdsToClose.forEach(panelId => {
      glEventHub.emit(PanelEvent.CLOSE, panelId);
    });

    this.setState({ itemIds: new Map() });
  }

  savePanelState = debounce((): void => {
    const { consoleSettings, itemIds } = this.state;
    const panelState = {
      consoleSettings,
      itemIds: [...itemIds],
    };
    log.debug('Saving panel state', panelState);
    // eslint-disable-next-line react/no-unused-state
    this.setState({ panelState });
  }, DEBOUNCE_PANEL_STATE_UPDATE);

  updateDimensions(): void {
    this.consoleRef.current?.updateDimensions();
  }

  render(): ReactElement {
    const {
      commandHistoryStorage,
      glContainer,
      glEventHub,
      sessionWrapper,
      timeZone,
      unzip,
    } = this.props;
    const { consoleSettings, error, objectMap } = this.state;
    const { config, session } = sessionWrapper;
    const { id: sessionId, type: language } = config;

    return (
      <Panel
        componentPanel={this}
        glContainer={glContainer}
        glEventHub={glEventHub}
        onResize={this.handleResize}
        onShow={this.handleShow}
        onTabFocus={this.handleTabFocus}
        onTabBlur={this.handleTabBlur}
        errorMessage={error != null ? `${error}` : undefined}
      >
        <>
          {session && (
            <Console
              ref={this.consoleRef}
              settings={consoleSettings}
              session={session}
              focusCommandHistory={this.handleFocusCommandHistory}
              openObject={this.handleOpenObject}
              closeObject={this.handleCloseObject}
              commandHistoryStorage={commandHistoryStorage}
              onSettingsChange={this.handleSettingsChange}
              language={language}
              statusBarChildren={
                <>
                  <div>&nbsp;</div>
                  <div>{ConsoleConstants.LANGUAGE_MAP.get(language)}</div>
                </>
              }
              scope={sessionId}
              timeZone={timeZone}
              objectMap={objectMap}
              unzip={unzip}
            />
          )}
        </>
      </Panel>
    );
  }
}

const mapStateToProps = (
  state: RootState,
  ownProps: { localDashboardId: string }
) => ({
  commandHistoryStorage: getCommandHistoryStorage(
    state
  ) as CommandHistoryStorage,
  sessionWrapper: getDashboardSessionWrapper(state, ownProps.localDashboardId),
  timeZone: getTimeZone(state),
});

export default connect(mapStateToProps, null, null, { forwardRef: true })(
  ConsolePanel
);
