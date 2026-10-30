import React, { useLayoutEffect, useRef, useState } from "react";
import Popper from "@mui/material/Popper";
import Paper from "@mui/material/Paper";
import MenuList from "@mui/material/MenuList";
import MenuItem from "@mui/material/MenuItem";
import ClickAwayListener from "@mui/material/ClickAwayListener";

import { t } from "../../i18n";
import { useFcboardContainer } from "../App";
import { FactoryIcon } from "../FactoryIcon";
import { chevronLeftIcon, chevronRight } from "../icons";
import { DropdownMenuContentPropsContext } from "../dropdownMenu/common";
import MenuItemContent from "../dropdownMenu/DropdownMenuItemContent";
import DropdownMenuSub from "../dropdownMenu/DropdownMenuSub";
import {
  getSubMenuTriggerComponent,
  getSubMenuContentComponent,
} from "../dropdownMenu/dropdownMenuUtils";

type Page = { title: React.ReactNode; children: React.ReactNode };

/** Factory menu levels share one anchored surface, with a back path at every depth. */
export const FactoryMenu = ({
  children,
  open,
  toggle,
  close,
  onSelect,
}: {
  children?: React.ReactNode;
  open: boolean;
  toggle: () => void;
  close: () => void;
  onSelect?: (event: Event) => void;
}) => {
  const { container } = useFcboardContainer();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [placement, setPlacement] = useState<{
    gap: number;
    maxHeight?: number;
  }>({ gap: 16 });
  useLayoutEffect(() => {
    const button = anchor || trigger.current;
    if (!open || !button) {
      return;
    }
    const toolbar = button.closest(".fc-unified-toolbar");
    const update = () => {
      const rect = button.getBoundingClientRect();
      if (!rect.height) {
        return;
      }
      const top = Math.min(
        rect.top,
        toolbar?.getBoundingClientRect().top ?? rect.top,
      );
      const gap = 16 * Math.min(1, rect.height / 48);
      setPlacement({
        gap: rect.top - top + gap,
        maxHeight: Math.max(0, top - gap - 12),
      });
    };
    update();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(update);
    observer?.observe(button);
    if (toolbar) {
      observer?.observe(toolbar);
    }
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [anchor, open]);
  const page = pages.at(-1);
  const finish = () => {
    close();
    anchor?.focus();
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        data-testid="main-menu-trigger"
        className="dropdown-menu-button main-menu-trigger"
        aria-label={t("buttons.menu")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          setAnchor(event.currentTarget);
          setPages([]);
          toggle();
        }}
      >
        <FactoryIcon name="menu" />
      </button>
      {open && (
        <ClickAwayListener onClickAway={finish}>
          <Popper
            open
            anchorEl={anchor || trigger.current}
            container={container}
            placement="top-start"
            sx={{ zIndex: 1300 }}
            modifiers={[
              {
                name: "offset",
                options: {
                  offset: [0, placement.gap],
                },
              },
              { name: "preventOverflow", options: { padding: 12 } },
            ]}
          >
            <Paper
              className={`main-menu fc-factory-menu fc-material-menu${
                page ? " fc-material-submenu" : ""
              }`}
              elevation={8}
              style={{ maxHeight: placement.maxHeight }}
            >
              <DropdownMenuContentPropsContext.Provider
                value={{
                  material: true,
                  onSelect: (event) => {
                    onSelect?.(event);
                    if (!event.defaultPrevented) {
                      finish();
                    }
                  },
                }}
              >
                <MenuList
                  key={pages.length}
                  data-testid="dropdown-menu"
                  autoFocusItem
                  aria-label={page ? String(page.title) : t("buttons.menu")}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Escape" || event.key === "Tab") {
                      event.preventDefault();
                      finish();
                    } else if (event.key === "ArrowLeft" && pages.length) {
                      event.preventDefault();
                      setPages(pages.slice(0, -1));
                    }
                  }}
                >
                  {page && (
                    <MenuItem
                      onClick={() => setPages(pages.slice(0, -1))}
                      aria-label={t("fcboard.back_to_settings")}
                    >
                      <MenuItemContent icon={chevronLeftIcon}>
                        {page.title}
                      </MenuItemContent>
                    </MenuItem>
                  )}
                  {React.Children.map(page?.children ?? children, (child) => {
                    if (
                      !React.isValidElement<{ children?: React.ReactNode }>(
                        child,
                      ) ||
                      child.type !== DropdownMenuSub
                    ) {
                      return child;
                    }
                    const trigger = getSubMenuTriggerComponent(
                      child.props.children,
                    ) as React.ReactElement<{
                      icon?: React.JSX.Element;
                      children: React.ReactNode;
                    }> | null;
                    const content = getSubMenuContentComponent(
                      child.props.children,
                    ) as React.ReactElement<{
                      children: React.ReactNode;
                    }> | null;
                    if (!trigger || !content) {
                      return null;
                    }
                    const enter = () =>
                      setPages([
                        ...pages,
                        {
                          title: trigger.props.children,
                          children: content.props.children,
                        },
                      ]);
                    return (
                      <MenuItem
                        aria-haspopup="menu"
                        onClick={enter}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowRight") {
                            event.preventDefault();
                            enter();
                          }
                        }}
                      >
                        <MenuItemContent icon={trigger.props.icon}>
                          {trigger.props.children}
                        </MenuItemContent>
                        {chevronRight}
                      </MenuItem>
                    );
                  })}
                </MenuList>
              </DropdownMenuContentPropsContext.Provider>
            </Paper>
          </Popper>
        </ClickAwayListener>
      )}
    </>
  );
};
