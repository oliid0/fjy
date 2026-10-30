import React, { useCallback, useContext, useEffect, useState } from "react";

import { DEFAULT_UI_OPTIONS, isShallowEqual } from "@fcboard/common";

import App, { FcboardAPIContext, FcboardAPISetContext } from "./components/App";
import { InitializeApp } from "./components/InitializeApp";
import Footer from "./components/footer/FooterCenter";
import LiveCollaborationTrigger from "./components/live-collaboration/LiveCollaborationTrigger";
import MainMenu from "./components/main-menu/MainMenu";
import WelcomeScreen from "./components/welcome-screen/WelcomeScreen";
import { defaultLang } from "./i18n";
import { useAppStateValue as _useAppStateValue } from "./hooks/useAppStateValue";
import { EditorJotaiProvider, editorJotaiStore } from "./editor-jotai";
import polyfill from "./polyfill";

import "./css/app.scss";
import "./css/styles.scss";
import "./fonts/fonts.css";

import type {
  AppProps,
  AppState,
  FcboardImperativeAPI,
  FcboardProps,
} from "./types";

polyfill();

/**
 * Stateless provider that allows `useFcboardAPI()` (and hooks built
 * on it, such as `useAppStateValue()`) to work outside the <Fcboard>
 * component tree.
 */
export const FcboardAPIProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [api, setApi] = useState<FcboardImperativeAPI | null>(null);
  return (
    <FcboardAPIContext.Provider value={api}>
      <FcboardAPISetContext.Provider value={setApi}>
        {children}
      </FcboardAPISetContext.Provider>
    </FcboardAPIContext.Provider>
  );
};

const FcboardBase = (props: FcboardProps) => {
  const {
    onExport,
    onChange,
    onIncrement,
    initialData,
    onFcboardAPI,
    onMount,
    onInitialize,
    isCollaborating = false,
    onPointerUpdate,
    renderTopLeftUI,
    renderTopRightUI,
    langCode = defaultLang.code,
    viewModeEnabled,
    zenModeEnabled,
    gridModeEnabled,
    libraryReturnUrl,
    theme,
    name,
    renderCustomStats,
    onPaste,
    onImagePick,
    detectScroll = true,
    handleKeyboardGlobally = false,
    onLibraryChange,
    autoFocus = false,
    generateIdForFile,
    onLinkOpen,
    generateLinkForSelection,
    onPointerDown,
    onPointerUp,
    onObjectDoubleClick,
    onScrollChange,
    onDuplicate,
    children,
    validateEmbeddable,
    renderEmbeddable,
    aiEnabled,
    showDeprecatedFonts,
    renderScrollbars,
  } = props;

  const canvasActions = props.UIOptions?.canvasActions;

  // FIXME normalize/set defaults in parent component so that the memo resolver
  // compares the same values
  const UIOptions: AppProps["UIOptions"] = {
    ...props.UIOptions,
    canvasActions: {
      ...DEFAULT_UI_OPTIONS.canvasActions,
      ...canvasActions,
    },
    tools: {
      image: props.UIOptions?.tools?.image ?? true,
    },
  };

  if (canvasActions?.export) {
    UIOptions.canvasActions.export.saveFileToDisk =
      canvasActions.export?.saveFileToDisk ??
      DEFAULT_UI_OPTIONS.canvasActions.export.saveFileToDisk;
  }

  if (
    UIOptions.canvasActions.toggleTheme === null &&
    typeof theme === "undefined"
  ) {
    UIOptions.canvasActions.toggleTheme = true;
  }

  const setFcboardAPI = useContext(FcboardAPISetContext);
  const handleFcboardAPI = useCallback(
    (api: FcboardImperativeAPI) => {
      setFcboardAPI?.(api);
      onFcboardAPI?.(api);
    },
    [onFcboardAPI, setFcboardAPI],
  );

  useEffect(() => {
    const importPolyfill = async () => {
      //@ts-ignore
      await import("canvas-roundrect-polyfill");
    };

    importPolyfill();

    // Block pinch-zooming on iOS outside of the content area
    const handleTouchMove = (event: TouchEvent) => {
      // @ts-ignore
      if (typeof event.scale === "number" && event.scale !== 1) {
        event.preventDefault();
      }
    };

    document.addEventListener("touchmove", handleTouchMove, {
      passive: false,
    });

    return () => {
      document.removeEventListener("touchmove", handleTouchMove);
    };
  }, []);

  return (
    <EditorJotaiProvider store={editorJotaiStore}>
      <InitializeApp langCode={langCode} theme={theme}>
        <App
          onExport={onExport}
          onChange={onChange}
          onIncrement={onIncrement}
          initialData={initialData}
          onFcboardAPI={handleFcboardAPI}
          onMount={onMount}
          onInitialize={onInitialize}
          isCollaborating={isCollaborating}
          onPointerUpdate={onPointerUpdate}
          renderTopLeftUI={renderTopLeftUI}
          renderTopRightUI={renderTopRightUI}
          langCode={langCode}
          viewModeEnabled={viewModeEnabled}
          zenModeEnabled={zenModeEnabled}
          gridModeEnabled={gridModeEnabled}
          libraryReturnUrl={libraryReturnUrl}
          theme={theme}
          name={name}
          renderCustomStats={renderCustomStats}
          UIOptions={UIOptions}
          onPaste={onPaste}
          onImagePick={onImagePick}
          detectScroll={detectScroll}
          handleKeyboardGlobally={handleKeyboardGlobally}
          onLibraryChange={onLibraryChange}
          autoFocus={autoFocus}
          generateIdForFile={generateIdForFile}
          onLinkOpen={onLinkOpen}
          generateLinkForSelection={generateLinkForSelection}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onObjectDoubleClick={onObjectDoubleClick}
          onScrollChange={onScrollChange}
          onDuplicate={onDuplicate}
          validateEmbeddable={validateEmbeddable}
          renderEmbeddable={renderEmbeddable}
          aiEnabled={aiEnabled !== false}
          showDeprecatedFonts={showDeprecatedFonts}
          renderScrollbars={renderScrollbars}
        >
          {children}
        </App>
      </InitializeApp>
    </EditorJotaiProvider>
  );
};

const areEqual = (prevProps: FcboardProps, nextProps: FcboardProps) => {
  // short-circuit early
  if (prevProps.children !== nextProps.children) {
    return false;
  }

  const {
    initialData: prevInitialData,
    UIOptions: prevUIOptions = {},
    ...prev
  } = prevProps;
  const {
    initialData: nextInitialData,
    UIOptions: nextUIOptions = {},
    ...next
  } = nextProps;

  // comparing UIOptions
  const prevUIOptionsKeys = Object.keys(prevUIOptions) as (keyof Partial<
    typeof DEFAULT_UI_OPTIONS
  >)[];
  const nextUIOptionsKeys = Object.keys(nextUIOptions) as (keyof Partial<
    typeof DEFAULT_UI_OPTIONS
  >)[];

  if (prevUIOptionsKeys.length !== nextUIOptionsKeys.length) {
    return false;
  }

  const isUIOptionsSame = prevUIOptionsKeys.every((key) => {
    if (key === "getFormFactor") {
      return true;
    }
    if (key === "canvasActions") {
      const canvasOptionKeys = Object.keys(
        prevUIOptions.canvasActions!,
      ) as (keyof Partial<typeof DEFAULT_UI_OPTIONS.canvasActions>)[];
      return canvasOptionKeys.every((key) => {
        if (
          key === "export" &&
          prevUIOptions?.canvasActions?.export &&
          nextUIOptions?.canvasActions?.export
        ) {
          return (
            prevUIOptions.canvasActions.export.saveFileToDisk ===
            nextUIOptions.canvasActions.export.saveFileToDisk
          );
        }
        return (
          prevUIOptions?.canvasActions?.[key] ===
          nextUIOptions?.canvasActions?.[key]
        );
      });
    }
    return prevUIOptions[key] === nextUIOptions[key];
  });

  return isUIOptionsSame && isShallowEqual(prev, next);
};

export const Fcboard = React.memo(FcboardBase, areEqual);
Fcboard.displayName = "Fcboard";
export type {
  FcboardProps,
  FcboardImperativeAPI,
  BinaryFiles,
  BinaryFileData,
  AppState,
} from "./types";

export {
  getSceneVersion,
  hashElementsVersion,
  hashString,
  getNonDeletedElements,
} from "@fcboard/element";

export { getTextFromElements } from "@fcboard/element";
export { isInvisiblySmallElement } from "@fcboard/element";

export { defaultLang, useI18n, languages } from "./i18n";
export {
  restoreAppState,
  restoreElement,
  restoreElements,
  restoreLibraryItems,
} from "./data/restore";

export { reconcileElements } from "./data/reconcile";

export {
  exportToCanvas,
  exportToBlob,
  exportToSvg,
  exportToClipboard,
} from "@fcboard/utils/export";

export { serializeAsJSON, serializeLibraryAsJSON } from "./data/json";
export {
  loadFromBlob,
  loadSceneOrLibraryFromBlob,
  loadLibraryFromBlob,
} from "./data/blob";
export { mergeLibraryItems, getLibraryItemsHash } from "./data/library";
export { isLinearElement } from "@fcboard/element";

export {
  FONT_FAMILY,
  THEME,
  MIME_TYPES,
  ROUNDNESS,
  DEFAULT_LASER_COLOR,
  UserIdleState,
  normalizeLink,
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords,
  getFormFactor,
  throttleRAF,
} from "@fcboard/common";

export { mutateElement, newElementWith, bumpVersion } from "@fcboard/element";

export { CaptureUpdateAction } from "@fcboard/element";

export { parseLibraryTokensFromUrl, useHandleLibrary } from "./data/library";

export { Sidebar } from "./components/Sidebar/Sidebar";
export { Button } from "./components/Button";
export { Footer };
export { ToolbarExtras } from "./components/ToolbarExtras";
export { MainMenu };
export { Ellipsify } from "./components/Ellipsify";
export {
  useEditorInterface,
  useStylesPanelMode,
  useFcboardAPI,
  FcboardAPIContext,
} from "./components/App";

export { WelcomeScreen };
export { LiveCollaborationTrigger };
export { Stats } from "./components/Stats";

export { DefaultSidebar } from "./components/DefaultSidebar";
export { TTDDialog } from "./components/TTDDialog/TTDDialog";
export { TTDDialogTrigger } from "./components/TTDDialog/TTDDialogTrigger";
export { TTDStreamFetch } from "./components/TTDDialog/utils/TTDStreamFetch";
export type {
  TTDPersistenceAdapter,
  SavedChat,
  SavedChats,
} from "./components/TTDDialog/types";

export { zoomToFitBounds } from "./actions/actionCanvas";
export {
  getCommonBounds,
  getVisibleSceneBounds,
  convertToFcboardElements,
} from "@fcboard/element";

export {
  elementsOverlappingBBox,
  isElementInsideBBox,
  elementPartiallyOverlapsWithOrContainsBBox,
} from "@fcboard/utils/withinBounds";

export { DiagramToCodePlugin } from "./components/DiagramToCodePlugin/DiagramToCodePlugin";
export { getDataURL } from "./data/blob";
export { isElementLink } from "@fcboard/element";

export { setCustomTextMetricsProvider } from "@fcboard/element";

export { CommandPalette } from "./components/CommandPalette/CommandPalette";

export {
  renderSpreadsheet,
  tryParseSpreadsheet,
  isSpreadsheetValidForChartType,
} from "./charts";

// -----------------------------------------------------------------------------
// useAppStateValue() wrapper for host apps for the return type to reflect the
// the potentially `undefined` value for initial render before the excalidrawAPI
// is ready.
//
/**
 * hook that subscribes to specific appState prop(s)
 *
 * @param prop - appState prop(s) to subscribe to, or a selector function.
 * NOTE `prop/selector` is memoized and will not change after initial render
 */
export function useAppStateValue<K extends keyof AppState>(
  prop: K,
  callback?: (value: AppState[K], appState: AppState) => void,
): AppState[K] | undefined;
export function useAppStateValue<T extends keyof AppState>(
  props: T[],
  callback?: (values: AppState, appState: AppState) => void,
): AppState | undefined;
export function useAppStateValue<T>(
  selector: (appState: AppState) => T,
  callback?: (value: T, appState: AppState) => void,
): T | undefined;
export function useAppStateValue(
  selector:
    | keyof AppState
    | (keyof AppState)[]
    | ((appState: AppState) => unknown),
  callback?: (value: any, appState: AppState) => void,
) {
  return _useAppStateValue(selector as any, callback, false);
}
// -----------------------------------------------------------------------------
