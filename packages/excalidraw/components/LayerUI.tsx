import clsx from "clsx";
import React from "react";

import {
  CLASSES,
  DEFAULT_SIDEBAR,
  DEFAULT_ELEMENT_PROPS,
  TOOL_TYPE,
  arrayToMap,
  capitalizeString,
  isShallowEqual,
} from "@excalidraw/common";

import { mutateElement } from "@excalidraw/element";

import { showSelectedShapeActions } from "@excalidraw/element";

import { ShapeCache } from "@excalidraw/element";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { actionToggleStats } from "../actions";
import { trackEvent } from "../analytics";
import { TunnelsContext, useInitializeTunnels } from "../context/tunnels";
import { UIAppStateContext } from "../context/ui-appState";
import { useAtom, useAtomValue } from "../editor-jotai";

import { t } from "../i18n";
import { calculateScrollCenter } from "../scene";

import {
  SelectedShapeActions,
  ShapesSwitcher,
  CompactShapeActions,
  ZoomActions,
  UndoRedoActions,
  ExitViewModeButton,
} from "./Actions";
import { LoadingMessage } from "./LoadingMessage";
import { LockButton } from "./LockButton";
import { MobileMenu } from "./MobileMenu";
import { PasteChartDialog } from "./PasteChartDialog";
import { Section } from "./Section";
import Stack from "./Stack";
import { UserList } from "./UserList";
import { PenModeButton } from "./PenModeButton";
import Footer from "./footer/Footer";
import { isSidebarDockedAtom } from "./Sidebar/Sidebar";
import MainMenu from "./main-menu/MainMenu";
import { ActiveConfirmDialog } from "./ActiveConfirmDialog";
import { useEditorInterface, useStylesPanelMode } from "./App";
import { OverwriteConfirmDialog } from "./OverwriteConfirm/OverwriteConfirm";
import { sidebarRightIcon } from "./icons";
import { DefaultSidebar } from "./DefaultSidebar";
import { TTDDialog } from "./TTDDialog/TTDDialog";
import { Stats } from "./Stats";
import ElementLinkDialog from "./ElementLinkDialog";
import { ErrorDialog } from "./ErrorDialog";
import { EyeDropper, activeEyeDropperAtom } from "./EyeDropper";
import { FixedSideContainer } from "./FixedSideContainer";
import { HelpDialog } from "./HelpDialog";
import { ImageExportDialog } from "./ImageExportDialog";
import { Island } from "./Island";
import { JSONExportDialog } from "./JSONExportDialog";
import { LaserPointerButton } from "./LaserPointerButton";
import { Toast } from "./Toast";
import { ToolButton } from "./ToolButton";
import {
  CircleIcon,
  CloseIcon,
  chevronRight,
  chevronLeftIcon,
  handIcon,
  RedoIcon,
} from "./icons";
import { WhiteboardTools } from "./WhiteboardTools";

import "./LayerUI.scss";
import "./Toolbar.scss";

import type { ActionManager } from "../actions/manager";

import type { Language } from "../i18n";
import type {
  AppProps,
  AppState,
  ExcalidrawProps,
  BinaryFiles,
  UIAppState,
  AppClassProperties,
} from "../types";

interface LayerUIProps {
  actionManager: ActionManager;
  appState: UIAppState;
  files: BinaryFiles;
  canvas: HTMLCanvasElement;
  setAppState: React.Component<any, AppState>["setState"];
  elements: readonly NonDeletedExcalidrawElement[];
  onLockToggle: () => void;
  onHandToolToggle: () => void;
  onPenModeToggle: AppClassProperties["togglePenMode"];
  showExitZenModeBtn: boolean;
  langCode: Language["code"];
  renderTopLeftUI?: ExcalidrawProps["renderTopLeftUI"];
  renderTopRightUI?: ExcalidrawProps["renderTopRightUI"];
  renderCustomStats?: ExcalidrawProps["renderCustomStats"];
  UIOptions: AppProps["UIOptions"];
  onExportImage: AppClassProperties["onExportImage"];
  renderWelcomeScreen: boolean;
  children?: React.ReactNode;
  app: AppClassProperties;
  isCollaborating: boolean;
  generateLinkForSelection?: AppProps["generateLinkForSelection"];
}

const DefaultMainMenu: React.FC<{
  UIOptions: AppProps["UIOptions"];
}> = ({ UIOptions }) => {
  return (
    <MainMenu __fallback>
      <MainMenu.DefaultItems.LoadScene />
      <MainMenu.DefaultItems.SaveToActiveFile />
      {/* FIXME we should to test for this inside the item itself */}
      {UIOptions.canvasActions.export && <MainMenu.DefaultItems.Export />}
      {/* FIXME we should to test for this inside the item itself */}
      {UIOptions.canvasActions.saveAsImage && (
        <MainMenu.DefaultItems.SaveAsImage />
      )}
      <MainMenu.DefaultItems.SearchMenu />
      <MainMenu.DefaultItems.Help />
      <MainMenu.DefaultItems.ClearCanvas />
      <MainMenu.Separator />
      <MainMenu.Group title="Excalidraw links">
        <MainMenu.DefaultItems.Socials />
      </MainMenu.Group>
      <MainMenu.Separator />
      <MainMenu.DefaultItems.ToggleTheme />
      <MainMenu.DefaultItems.ChangeCanvasBackground />
    </MainMenu>
  );
};

const DefaultOverwriteConfirmDialog = () => {
  return (
    <OverwriteConfirmDialog __fallback>
      <OverwriteConfirmDialog.Actions.SaveToDisk />
      <OverwriteConfirmDialog.Actions.ExportToImage />
    </OverwriteConfirmDialog>
  );
};

const LayerUI = ({
  actionManager,
  appState,
  files,
  setAppState,
  elements,
  canvas,
  onLockToggle,
  onHandToolToggle,
  onPenModeToggle,
  showExitZenModeBtn,
  renderTopLeftUI,
  renderTopRightUI,
  renderCustomStats,
  UIOptions,
  onExportImage,
  renderWelcomeScreen,
  children,
  app,
  isCollaborating,
  generateLinkForSelection,
}: LayerUIProps) => {
  const editorInterface = useEditorInterface();
  const stylesPanelMode = useStylesPanelMode();
  const isCompactStylesPanel = stylesPanelMode === "compact";
  const unifiedToolbar = UIOptions.unifiedToolbar;
  const [showProperties, setShowProperties] = React.useState(false);
  const [propertiesAnchor, setPropertiesAnchor] = React.useState({
    left: 12,
    bottom: 84,
  });
  React.useEffect(() => {
    if (!unifiedToolbar || !showProperties) {
      return;
    }
    const close = () => setShowProperties(false);
    const unsubscribe = app.onPointerDownEmitter.on(close);
    const outside = (event: PointerEvent) => {
      if (
        !(event.target as Element).closest?.(
          ".fc-editor-properties, [data-radix-popper-content-wrapper], [data-prevent-outside-click]",
        )
      ) {
        close();
      }
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("resize", close);
    return () => {
      unsubscribe();
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", close);
    };
  }, [app, showProperties, unifiedToolbar]);
  const openProperties = (anchor: HTMLElement) => {
    const bounds = anchor.getBoundingClientRect();
    const root = anchor.closest(".excalidraw")!.getBoundingClientRect();
    setPropertiesAnchor({
      left: Math.max(
        12,
        Math.min(bounds.left - root.left - 110, root.width - 304),
      ),
      bottom: root.bottom - bounds.top + 12,
    });
    setShowProperties(true);
  };
  const tunnels = useInitializeTunnels();

  const spacing = isCompactStylesPanel
    ? {
        menuTopGap: 4,
        toolbarColGap: 4,
        toolbarRowGap: 1,
        toolbarInnerRowGap: 0.5,
        islandPadding: 1,
        collabMarginLeft: 8,
      }
    : {
        menuTopGap: 6,
        toolbarColGap: 4,
        toolbarRowGap: 1,
        toolbarInnerRowGap: 1,
        islandPadding: 1,
        collabMarginLeft: 8,
      };

  const TunnelsJotaiProvider = tunnels.tunnelsJotai.Provider;

  const [eyeDropperState, setEyeDropperState] = useAtom(activeEyeDropperAtom);

  const renderJSONExportDialog = () => {
    if (!UIOptions.canvasActions.export) {
      return null;
    }

    return (
      <JSONExportDialog
        elements={elements}
        appState={appState}
        files={files}
        actionManager={actionManager}
        exportOpts={UIOptions.canvasActions.export}
        canvas={canvas}
        setAppState={setAppState}
      />
    );
  };

  const renderImageExportDialog = () => {
    if (
      !UIOptions.canvasActions.saveAsImage ||
      appState.openDialog?.name !== "imageExport"
    ) {
      return null;
    }

    return (
      <ImageExportDialog
        elements={elements}
        appState={appState}
        files={files}
        actionManager={actionManager}
        onExportImage={onExportImage}
        onCloseRequest={() => setAppState({ openDialog: null })}
        name={app.getName()}
      />
    );
  };

  const renderCanvasActions = () => (
    <div style={{ position: "relative" }}>
      {/* wrapping to Fragment stops React from occasionally complaining
                about identical Keys */}
      <tunnels.MainMenuTunnel.Out />
      {renderWelcomeScreen && <tunnels.WelcomeScreenMenuHintTunnel.Out />}
    </div>
  );

  const renderSelectedShapeActions = () => {
    const isCompactMode = isCompactStylesPanel && !unifiedToolbar;

    return (
      <Section
        heading="selectedShapeActions"
        className={clsx("selected-shape-actions zen-mode-transition", {
          "transition-left": appState.zenModeEnabled,
        })}
      >
        {isCompactMode ? (
          <Island
            className={clsx("compact-shape-actions-island")}
            padding={0}
            style={{
              // we want to make sure this doesn't overflow so subtracting the
              // approximate height of hamburgerMenu + footer
              maxHeight: `${appState.height - 166}px`,
            }}
          >
            <CompactShapeActions
              appState={appState}
              elementsMap={app.scene.getNonDeletedElementsMap()}
              renderAction={actionManager.renderAction}
              app={app}
              setAppState={setAppState}
            />
          </Island>
        ) : (
          <Island
            className={CLASSES.SHAPE_ACTIONS_MENU}
            padding={2}
            style={{
              // we want to make sure this doesn't overflow so subtracting the
              // approximate height of hamburgerMenu + footer
              maxHeight: `${appState.height - 166}px`,
            }}
          >
            <SelectedShapeActions
              appState={appState}
              elementsMap={app.scene.getNonDeletedElementsMap()}
              renderAction={actionManager.renderAction}
              app={app}
            />
          </Island>
        )}
      </Section>
    );
  };

  const renderSideContainer = () => {
    return (
      <FixedSideContainer side="left" className="shapes-section-container">
        {!appState.viewModeEnabled &&
          appState.openDialog?.name !== "elementLinkSelector" && (
            <Section heading="shapes" className="shapes-section">
              {(heading: React.ReactNode) => (
                <div style={{ position: "relative" }}>
                  {renderWelcomeScreen && (
                    <tunnels.WelcomeScreenToolbarHintTunnel.Out />
                  )}
                  <Stack.Col gap={spacing.toolbarColGap} align="start">
                    <Island
                      padding={spacing.islandPadding}
                      className={clsx("App-toolbar", {
                        "zen-mode": appState.zenModeEnabled,
                        "App-toolbar--compact": isCompactStylesPanel,
                      })}
                    >
                      {heading}
                      <Stack.Col gap={spacing.toolbarInnerRowGap}>
                        <PenModeButton
                          zenModeEnabled={appState.zenModeEnabled}
                          checked={appState.penMode}
                          onChange={() => onPenModeToggle(null)}
                          title={t("toolBar.penMode")}
                          penDetected={appState.penDetected}
                        />

                        <LockButton
                          checked={appState.activeTool.locked}
                          onChange={onLockToggle}
                          title={t("toolBar.lock")}
                        />

                        <div
                          className="App-toolbar__divider"
                          style={{ width: "20px", height: "1px" }}
                        />

                        <ShapesSwitcher
                          setAppState={setAppState}
                          activeTool={appState.activeTool}
                          UIOptions={UIOptions}
                          app={app}
                        />
                      </Stack.Col>
                    </Island>
                    {isCollaborating && (
                      <Island
                        style={{
                          marginTop: spacing.collabMarginLeft,
                          alignSelf: "center",
                          height: "fit-content",
                        }}
                      >
                        <LaserPointerButton
                          title={t("toolBar.laser")}
                          checked={appState.activeTool.type === TOOL_TYPE.laser}
                          onChange={() =>
                            app.setActiveTool({ type: TOOL_TYPE.laser })
                          }
                          isMobile
                        />
                      </Island>
                    )}
                    <Island
                      padding={0}
                      style={{
                        marginTop: spacing.toolbarColGap,
                        alignSelf: "center",
                        height: "fit-content",
                      }}
                    >
                      {renderTopRightUI?.(
                        editorInterface.formFactor === "phone",
                        appState,
                      )}
                    </Island>
                  </Stack.Col>
                </div>
              )}
            </Section>
          )}
      </FixedSideContainer>
    );
  };

  const renderFixedSideContainer = () => {
    const shouldRenderSelectedShapeActions = showSelectedShapeActions(
      appState,
      elements,
    );

    const shouldShowStats =
      appState.stats.open &&
      !appState.zenModeEnabled &&
      !appState.viewModeEnabled &&
      appState.openDialog?.name !== "elementLinkSelector";

    return (
      <FixedSideContainer side="top">
        <div className="App-menu App-menu_top">
          <Stack.Col
            gap={spacing.menuTopGap}
            className={clsx("App-menu_top__left")}
          >
            {renderCanvasActions()}
            <div
              className={clsx("selected-shape-actions-container", {
                "selected-shape-actions-container--compact":
                  isCompactStylesPanel,
              })}
            >
              {appState.showToolSettings && shouldRenderSelectedShapeActions && (
                <div style={{ position: "relative", zIndex: 100 }}>
                  <ToolButton
                    type="button"
                    icon={CloseIcon}
                    title={t("buttons.close") || "Close"}
                    aria-label={t("buttons.close") || "Close"}
                    onClick={() => setAppState({ showToolSettings: false })}
                    style={{
                      position: "absolute",
                      top: 0,
                      right: 0,
                      zIndex: 1,
                    }}
                  />
                  {renderSelectedShapeActions()}
                </div>
              )}
            </div>
          </Stack.Col>
          <div
            className={clsx(
              "layer-ui__wrapper__top-right zen-mode-transition",
              {
                "transition-right": appState.zenModeEnabled,
                "layer-ui__wrapper__top-right--compact": isCompactStylesPanel,
              },
            )}
          >
            <div style={{ marginRight: 8 }}>
              <ToolButton
                type="button"
                icon={CircleIcon}
                title={
                  appState.showToolSettings
                    ? "Hide tool settings"
                    : "Show tool settings"
                }
                aria-label={
                  appState.showToolSettings
                    ? "Hide tool settings"
                    : "Show tool settings"
                }
                onClick={() =>
                  setAppState({ showToolSettings: !appState.showToolSettings })
                }
                selected={appState.showToolSettings}
              />
            </div>
            <tunnels.DefaultSidebarTriggerTunnel.Out />
            {appState.collaborators.size > 0 && (
              <UserList
                collaborators={appState.collaborators}
                userToFollow={appState.userToFollow?.socketId || null}
              />
            )}
            {shouldShowStats && (
              <Stats
                app={app}
                onClose={() => {
                  actionManager.executeAction(actionToggleStats);
                }}
                renderCustomStats={renderCustomStats}
              />
            )}
          </div>
        </div>
      </FixedSideContainer>
    );
  };

  const renderSidebars = () => {
    if (UIOptions.library === false) {
      return null;
    }
    return (
      <DefaultSidebar
        __fallback
        onDock={(docked) => {
          trackEvent(
            "sidebar",
            `toggleDock (${docked ? "dock" : "undock"})`,
            `(${
              editorInterface.formFactor === "phone" ? "mobile" : "desktop"
            })`,
          );
        }}
      />
    );
  };

  const isSidebarDocked = useAtomValue(isSidebarDockedAtom);
  const toolbarHidden = !!appState.toolbarHidden;
  const penBase = appState.currentItemPenMode === "brush" ? 15 : 4;
  const inkThickness =
    (appState.currentItemStrokeWidth / DEFAULT_ELEMENT_PROPS.strokeWidth) *
    penBase;

  const renderUnifiedToolbar = () => (
    <>
      {showProperties && !toolbarHidden && !appState.viewModeEnabled && (
        <div
          className="fc-editor-properties"
          role="dialog"
          aria-label="画笔与对象属性"
          style={propertiesAnchor}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setShowProperties(false);
            }
          }}
        >
          <ToolButton
            type="button"
            icon={CloseIcon}
            aria-label="关闭属性"
            title="关闭属性"
            onClick={() => setShowProperties(false)}
          />
          {appState.activeTool.type === "freedraw" && (
            <>
              <div role="group" aria-label="笔型" className="fc-pen-types">
                {(
                  [
                    ["hard", "画笔"],
                    ["brush", "钢笔"],
                    ["highlighter", "荧光笔"],
                    ["dashed", "虚线笔"],
                    ["rainbow", "彩虹笔"],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={
                      (appState.currentItemPenMode || "hard") === mode
                    }
                    onClick={() => setAppState({ currentItemPenMode: mode })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="fc-pen-mode">
                粗细
                <input
                  aria-label="书写粗细"
                  type="range"
                  min="1"
                  max="40"
                  step="0.5"
                  value={inkThickness}
                  onChange={(event) =>
                    setAppState({
                      currentItemStrokeWidth:
                        (Number(event.target.value) / penBase) *
                        DEFAULT_ELEMENT_PROPS.strokeWidth,
                    })
                  }
                />
                <output>{Math.round(inkThickness * 100) / 100}</output>
              </label>
            </>
          )}
          {renderSelectedShapeActions()}
        </div>
      )}
      <div
        className={clsx("fc-unified-toolbar", {
          "fc-toolbar-collapsed": toolbarHidden,
          "fc-toolbar-reversed": appState.toolbarReversed,
        })}
        role="toolbar"
        aria-label="白板工具栏"
      >
        <div className="fc-toolbar-side fc-toolbar-leading">
          <div
            className="fc-toolbar-group"
            role="group"
            aria-label="文件与素材"
          >
            {renderTopLeftUI?.(
              editorInterface.formFactor === "phone",
              appState,
            )}
            <tunnels.MainMenuTunnel.Out />
            {UIOptions.library !== false && (
              <tunnels.DefaultSidebarTriggerTunnel.Out />
            )}
          </div>
          <tunnels.ToolbarNavigationTunnel.Out />
        </div>
        {!appState.viewModeEnabled ? (
          <div
            className="fc-toolbar-group fc-drawing-tools"
            role="group"
            aria-label="书写与绘图"
          >
            <WhiteboardTools
              setAppState={setAppState}
              activeTool={appState.activeTool}
              UIOptions={UIOptions}
              app={app}
              onProperties={openProperties}
            >
              <div className="fc-insert-options">
                <PenModeButton
                  checked={appState.penMode}
                  onChange={() => onPenModeToggle(null)}
                  title={t("toolBar.penMode")}
                  penDetected={appState.penDetected}
                />
                <LockButton
                  checked={appState.activeTool.locked}
                  onChange={onLockToggle}
                  title={t("toolBar.lock")}
                />
                <button
                  type="button"
                  onClick={(event) => openProperties(event.currentTarget)}
                >
                  画笔与对象属性
                </button>
                <ZoomActions
                  renderAction={actionManager.renderAction}
                  zoom={appState.zoom}
                />
              </div>
            </WhiteboardTools>
            <tunnels.ToolbarExtrasTunnel.Out />
            <UndoRedoActions renderAction={actionManager.renderAction} />
            <ToolButton
              type="button"
              className="fc-board-tool fc-board-mode"
              icon={handIcon}
              aria-label={
                appState.multiStroke !== false ? "多点书写" : "单点书写"
              }
              title="多点：多人同时书写；单点：仅接收一处笔迹。选择或移动工具可双指缩放"
              showAriaLabel
              selected={appState.multiStroke !== false}
              onClick={() =>
                setAppState({ multiStroke: appState.multiStroke === false })
              }
            />
          </div>
        ) : (
          <ExitViewModeButton actionManager={actionManager} />
        )}
        <div className="fc-toolbar-side fc-toolbar-trailing">
          <tunnels.FooterCenterTunnel.Out />
          {renderTopRightUI?.(editorInterface.formFactor === "phone", appState)}
          <ToolButton
            type="button"
            className="fc-board-tool"
            icon={RedoIcon}
            aria-label="切换"
            title="左右切换底栏"
            showAriaLabel
            onClick={() =>
              setAppState({ toolbarReversed: !appState.toolbarReversed })
            }
          />
          <ToolButton
            type="button"
            className="fc-board-tool fc-toolbar-visibility"
            icon={toolbarHidden ? chevronLeftIcon : chevronRight}
            aria-label={toolbarHidden ? "显示工具栏" : "隐藏工具栏"}
            showAriaLabel
            onClick={() => {
              setShowProperties(false);
              setAppState({ toolbarHidden: !toolbarHidden, openMenu: null });
            }}
          />
        </div>
      </div>
    </>
  );

  const layerUIJSX = (
    <>
      {/* ------------------------- tunneled UI ---------------------------- */}
      {/* make sure we render host app components first so that we can detect
          them first on initial render to optimize layout shift */}
      {children}
      {/* render component fallbacks. Can be rendered anywhere as they'll be
          tunneled away. We only render tunneled components that actually
        have defaults when host do not render anything. */}
      <DefaultMainMenu UIOptions={UIOptions} />
      {UIOptions.library !== false && (
        <DefaultSidebar.Trigger
          __fallback
          icon={sidebarRightIcon}
          title={capitalizeString(t("toolBar.library"))}
          onToggle={(open) => {
            if (open) {
              trackEvent(
                "sidebar",
                `${DEFAULT_SIDEBAR.name} (open)`,
                `button (${
                  editorInterface.formFactor === "phone" ? "mobile" : "desktop"
                })`,
              );
            }
          }}
          tab={DEFAULT_SIDEBAR.defaultTab}
        />
      )}
      <DefaultOverwriteConfirmDialog />
      {appState.openDialog?.name === "ttd" && <TTDDialog __fallback />}
      {/* ------------------------------------------------------------------ */}

      {appState.isLoading && <LoadingMessage delay={250} />}
      {appState.errorMessage && (
        <ErrorDialog onClose={() => setAppState({ errorMessage: null })}>
          {appState.errorMessage}
        </ErrorDialog>
      )}
      {eyeDropperState && editorInterface.formFactor !== "phone" && (
        <EyeDropper
          colorPickerType={eyeDropperState.colorPickerType}
          onCancel={() => {
            setEyeDropperState(null);
          }}
          onChange={(colorPickerType, color, selectedElements, { altKey }) => {
            if (
              colorPickerType !== "elementBackground" &&
              colorPickerType !== "elementStroke"
            ) {
              return;
            }

            if (selectedElements.length) {
              for (const element of selectedElements) {
                mutateElement(element, arrayToMap(elements), {
                  [altKey && eyeDropperState.swapPreviewOnAlt
                    ? colorPickerType === "elementBackground"
                      ? "strokeColor"
                      : "backgroundColor"
                    : colorPickerType === "elementBackground"
                    ? "backgroundColor"
                    : "strokeColor"]: color,
                });
                ShapeCache.delete(element);
              }
              app.scene.triggerUpdate();
            } else if (colorPickerType === "elementBackground") {
              setAppState({
                currentItemBackgroundColor: color,
              });
            } else {
              setAppState({ currentItemStrokeColor: color });
            }
          }}
          onSelect={(color, event) => {
            setEyeDropperState((state) => {
              return state?.keepOpenOnAlt && event.altKey ? state : null;
            });
            eyeDropperState?.onSelect?.(color, event);
          }}
        />
      )}
      {appState.openDialog?.name === "help" && (
        <HelpDialog
          onClose={() => {
            setAppState({ openDialog: null });
          }}
        />
      )}
      <ActiveConfirmDialog />
      {appState.openDialog?.name === "elementLinkSelector" && (
        <ElementLinkDialog
          sourceElementId={appState.openDialog.sourceElementId}
          onClose={() => {
            setAppState({
              openDialog: null,
            });
          }}
          scene={app.scene}
          appState={appState}
          generateLinkForSelection={generateLinkForSelection}
        />
      )}
      <tunnels.OverwriteConfirmDialogTunnel.Out />
      {renderImageExportDialog()}
      {renderJSONExportDialog()}
      {appState.openDialog?.name === "charts" && (
        <PasteChartDialog
          data={appState.openDialog.data}
          rawText={appState.openDialog.rawText}
          onClose={() =>
            setAppState({
              openDialog: null,
            })
          }
        />
      )}
      {unifiedToolbar && (
        <>
          {renderUnifiedToolbar()}
          {renderSidebars()}
          {appState.stats.open && !appState.viewModeEnabled && (
            <div className="fc-editor-stats">
              <Stats
                app={app}
                onClose={() => actionManager.executeAction(actionToggleStats)}
                renderCustomStats={renderCustomStats}
              />
            </div>
          )}
        </>
      )}
      {!unifiedToolbar && editorInterface.formFactor === "phone" && (
        <MobileMenu
          app={app}
          appState={appState}
          elements={elements}
          actionManager={actionManager}
          renderJSONExportDialog={renderJSONExportDialog}
          renderImageExportDialog={renderImageExportDialog}
          setAppState={setAppState}
          onHandToolToggle={onHandToolToggle}
          onPenModeToggle={onPenModeToggle}
          renderTopLeftUI={renderTopLeftUI}
          renderTopRightUI={renderTopRightUI}
          renderSidebars={renderSidebars}
          renderWelcomeScreen={renderWelcomeScreen}
          UIOptions={UIOptions}
        />
      )}
      {!unifiedToolbar && editorInterface.formFactor !== "phone" && (
        <>
          <div
            className="layer-ui__wrapper"
            style={
              appState.openSidebar &&
              isSidebarDocked &&
              editorInterface.canFitSidebar
                ? { width: `calc(100% - var(--right-sidebar-width))` }
                : {}
            }
          >
            {renderWelcomeScreen && <tunnels.WelcomeScreenCenterTunnel.Out />}
            {renderFixedSideContainer()}
            {renderSideContainer()}
            <Footer
              appState={appState}
              actionManager={actionManager}
              showExitZenModeBtn={showExitZenModeBtn}
              renderWelcomeScreen={renderWelcomeScreen}
            />
            {(appState.toast || appState.scrolledOutside) && (
              <div className="floating-status-stack">
                {appState.toast && (
                  <Toast
                    message={appState.toast.message}
                    onClose={() => setAppState({ toast: null })}
                    duration={appState.toast.duration}
                    closable={appState.toast.closable}
                  />
                )}
                {!appState.toast && appState.scrolledOutside && (
                  <button
                    type="button"
                    className="scroll-back-to-content"
                    onClick={() => {
                      setAppState((appState) => ({
                        ...calculateScrollCenter(elements, appState),
                      }));
                    }}
                  >
                    {t("buttons.scrollBackToContent")}
                  </button>
                )}
              </div>
            )}
          </div>
          {renderSidebars()}
        </>
      )}
    </>
  );

  return (
    <UIAppStateContext.Provider value={appState}>
      <TunnelsJotaiProvider>
        <TunnelsContext.Provider value={tunnels}>
          {layerUIJSX}
        </TunnelsContext.Provider>
      </TunnelsJotaiProvider>
    </UIAppStateContext.Provider>
  );
};

const stripIrrelevantAppStateProps = (appState: AppState): UIAppState => {
  const { startBoundElement, cursorButton, scrollX, scrollY, ...ret } =
    appState;
  return ret;
};

const areEqual = (prevProps: LayerUIProps, nextProps: LayerUIProps) => {
  // short-circuit early
  if (prevProps.children !== nextProps.children) {
    return false;
  }

  const { canvas: _pC, appState: prevAppState, ...prev } = prevProps;
  const { canvas: _nC, appState: nextAppState, ...next } = nextProps;

  return (
    isShallowEqual(
      // asserting AppState because we're being passed the whole AppState
      // but resolve to only the UI-relevant props
      stripIrrelevantAppStateProps(prevAppState as AppState),
      stripIrrelevantAppStateProps(nextAppState as AppState),
      {
        selectedElementIds: isShallowEqual,
        selectedGroupIds: isShallowEqual,
      },
    ) && isShallowEqual(prev, next)
  );
};

export default React.memo(LayerUI, areEqual);
