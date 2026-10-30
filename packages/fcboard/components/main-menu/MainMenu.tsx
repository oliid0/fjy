import React from "react";

import { composeEventHandlers } from "@fcboard/common";

import { useTunnels } from "../../context/tunnels";
import { useUIAppState } from "../../context/ui-appState";
import { t } from "../../i18n";
import { useAppProps, useEditorInterface, useFcboardSetAppState } from "../App";
import { FactoryIcon } from "../FactoryIcon";
import { UserList } from "../UserList";
import DropdownMenu from "../dropdownMenu/DropdownMenu";
import DropdownMenuSub from "../dropdownMenu/DropdownMenuSub";
import { withInternalFallback } from "../hoc/withInternalFallback";
import { HamburgerMenuIcon } from "../icons";

import * as DefaultItems from "./DefaultItems";
import { FactoryMenu } from "./FactoryMenu";

const MainMenu = Object.assign(
  withInternalFallback(
    "MainMenu",
    ({
      children,
      onSelect,
    }: {
      children?: React.ReactNode;
      /**
       * Called when any menu item is selected (clicked on).
       */
      onSelect?: (event: Event) => void;
    }) => {
      const { MainMenuTunnel } = useTunnels();
      const editorInterface = useEditorInterface();
      const appState = useUIAppState();
      const { UIOptions } = useAppProps();
      const [gap, setGap] = React.useState(16);
      const setAppState = useFcboardSetAppState();

      if (UIOptions.unifiedToolbar) {
        return (
          <MainMenuTunnel.In>
            <FactoryMenu
              open={appState.openMenu === "canvas"}
              toggle={() =>
                setAppState({
                  openMenu: appState.openMenu === "canvas" ? null : "canvas",
                  openPopup: null,
                  openDialog: null,
                })
              }
              close={() => setAppState({ openMenu: null })}
              onSelect={onSelect}
            >
              {children}
            </FactoryMenu>
          </MainMenuTunnel.In>
        );
      }

      return (
        <MainMenuTunnel.In>
          <DropdownMenu open={appState.openMenu === "canvas"}>
            <DropdownMenu.Trigger
              onToggle={() => {
                setAppState({
                  openMenu: appState.openMenu === "canvas" ? null : "canvas",
                  openPopup: null,
                  openDialog: null,
                });
              }}
              data-testid="main-menu-trigger"
              className="main-menu-trigger"
              onFocus={(event) =>
                setGap(
                  (16 * event.currentTarget.getBoundingClientRect().height) /
                    48,
                )
              }
              onPointerDown={(event) =>
                setGap(
                  (16 * event.currentTarget.getBoundingClientRect().height) /
                    48,
                )
              }
            >
              {UIOptions.unifiedToolbar ? (
                <FactoryIcon name="menu" />
              ) : (
                HamburgerMenuIcon
              )}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content
              onClickOutside={() => setAppState({ openMenu: null })}
              onSelect={composeEventHandlers(onSelect, () => {
                setAppState({ openMenu: null });
              })}
              className={
                UIOptions.unifiedToolbar
                  ? "main-menu fc-factory-menu"
                  : "main-menu"
              }
              align="start"
              sideOffset={UIOptions.unifiedToolbar ? gap : 8}
            >
              {children}
              {editorInterface.formFactor === "phone" &&
                appState.collaborators.size > 0 && (
                  <fieldset className="UserList-Wrapper">
                    <legend>{t("labels.collaborators")}</legend>
                    <UserList
                      mobile={true}
                      collaborators={appState.collaborators}
                      userToFollow={appState.userToFollow?.socketId || null}
                    />
                  </fieldset>
                )}
            </DropdownMenu.Content>
          </DropdownMenu>
        </MainMenuTunnel.In>
      );
    },
  ),
  {
    Trigger: DropdownMenu.Trigger,
    Item: DropdownMenu.Item,
    ItemLink: DropdownMenu.ItemLink,
    ItemCustom: DropdownMenu.ItemCustom,
    Group: DropdownMenu.Group,
    Separator: DropdownMenu.Separator,
    Sub: DropdownMenuSub,
    DefaultItems,
  },
);

export default MainMenu;
