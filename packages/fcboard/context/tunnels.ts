import { createIsolation } from "jotai-scope";
import React from "react";
import tunnel from "tunnel-rat";

import { stableToolbarTunnel } from "../components/stableToolbarTunnel";

export type Tunnel = ReturnType<typeof tunnel>;

type TunnelsContextValue = {
  MainMenuTunnel: Tunnel;
  WelcomeScreenMenuHintTunnel: Tunnel;
  WelcomeScreenToolbarHintTunnel: Tunnel;
  WelcomeScreenHelpHintTunnel: Tunnel;
  WelcomeScreenCenterTunnel: Tunnel;
  FooterCenterTunnel: Tunnel;
  ToolbarExtrasTunnel: Tunnel;
  ToolbarNavigationTunnel: Tunnel;
  ToolbarInsertTunnel: Tunnel;
  ToolbarShapesTunnel: ReturnType<typeof stableToolbarTunnel>;
  DefaultSidebarTriggerTunnel: Tunnel;
  DefaultSidebarTabTriggersTunnel: Tunnel;
  OverwriteConfirmDialogTunnel: Tunnel;
  TTDDialogTriggerTunnel: Tunnel;
  // this can be removed once we create jotai stores per each editor
  // instance
  tunnelsJotai: ReturnType<typeof createIsolation>;
};

export const TunnelsContext = React.createContext<TunnelsContextValue>(null!);

export const useTunnels = () => React.useContext(TunnelsContext);

const tunnelsJotai = createIsolation();

export const useInitializeTunnels = () => {
  return React.useMemo((): TunnelsContextValue => {
    return {
      MainMenuTunnel: tunnel(),
      WelcomeScreenMenuHintTunnel: tunnel(),
      WelcomeScreenToolbarHintTunnel: tunnel(),
      WelcomeScreenHelpHintTunnel: tunnel(),
      WelcomeScreenCenterTunnel: tunnel(),
      FooterCenterTunnel: tunnel(),
      ToolbarExtrasTunnel: stableToolbarTunnel(),
      ToolbarNavigationTunnel: stableToolbarTunnel(),
      ToolbarInsertTunnel: stableToolbarTunnel(),
      ToolbarShapesTunnel: stableToolbarTunnel(),
      DefaultSidebarTriggerTunnel: tunnel(),
      DefaultSidebarTabTriggersTunnel: tunnel(),
      OverwriteConfirmDialogTunnel: tunnel(),
      TTDDialogTriggerTunnel: tunnel(),
      tunnelsJotai,
    };
  }, []);
};
