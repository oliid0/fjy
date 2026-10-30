import clsx from "clsx";
import React, { useEffect, useRef, useState } from "react";

import { isPromiseLike } from "@fcboard/common";

import type { PointerType } from "@fcboard/element/types";

import { AbortError } from "../errors";

import "./ToolIcon.scss";

import Spinner from "./Spinner";
import { useFcboardContainer } from "./App";

import type { CSSProperties } from "react";

export type ToolButtonSize = "small" | "medium";

type ToolButtonBaseProps = {
  [attribute: `data-${string}`]: string | number | boolean | undefined;
  icon?: React.ReactNode;
  "aria-label": string;
  "aria-keyshortcuts"?: string;
  "data-testid"?: string;
  label?: string;
  title?: string;
  name?: string;
  id?: string;
  size?: ToolButtonSize;
  keyBindingLabel?: string | null;
  showAriaLabel?: boolean;
  hidden?: boolean;
  visible?: boolean;
  selected?: boolean;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  isLoading?: boolean;
  onLongPress?: (anchor: HTMLElement) => void;
};

type ToolButtonProps =
  | (ToolButtonBaseProps & {
      type: "button";
      children?: React.ReactNode;
      onClick?(event: React.MouseEvent): void;
    })
  | (ToolButtonBaseProps & {
      type: "submit";
      children?: React.ReactNode;
      onClick?(event: React.MouseEvent): void;
    })
  | (ToolButtonBaseProps & {
      type: "icon";
      children?: React.ReactNode;
      onClick?(): void;
    })
  | (ToolButtonBaseProps & {
      type: "radio";
      checked: boolean;
      onChange?(data: { pointerType: PointerType | null }): void;
      onPointerDown?(data: { pointerType: PointerType }): void;
    });

export const ToolButton = React.forwardRef(
  (
    {
      size = "medium",
      visible = true,
      className = "",
      ...props
    }: ToolButtonProps,
    ref,
  ) => {
    const { id: excalId } = useFcboardContainer();
    const innerRef = React.useRef(null);
    React.useImperativeHandle(ref, () => innerRef.current);
    const sizeCn = `ToolIcon_size_${size}`;
    const dataAttributes = Object.fromEntries(
      Object.entries(props).filter(([name]) => name.startsWith("data-")),
    );

    const [isLoading, setIsLoading] = useState(false);

    const isMountedRef = useRef(true);

    const onClick = async (event: React.MouseEvent) => {
      const ret = "onClick" in props && props.onClick?.(event);

      if (isPromiseLike(ret)) {
        try {
          setIsLoading(true);
          await ret;
        } catch (error: any) {
          if (!(error instanceof AbortError)) {
            throw error;
          } else {
            console.warn(error);
          }
        } finally {
          if (isMountedRef.current) {
            setIsLoading(false);
          }
        }
      }
    };

    useEffect(() => {
      isMountedRef.current = true;
      return () => {
        isMountedRef.current = false;
      };
    }, []);

    const lastPointerTypeRef = useRef<PointerType | null>(null);
    const press = useRef<{
      timer?: ReturnType<typeof setTimeout>;
      x: number;
      y: number;
      handled: boolean;
    }>({ x: 0, y: 0, handled: false });
    const cancelPress = () => clearTimeout(press.current.timer);
    useEffect(() => cancelPress, []);

    if (
      props.type === "button" ||
      props.type === "icon" ||
      props.type === "submit"
    ) {
      const type = (props.type === "icon" ? "button" : props.type) as
        | "button"
        | "submit";
      return (
        <button
          {...dataAttributes}
          className={clsx(
            "ToolIcon_type_button",
            sizeCn,
            className,
            visible && !props.hidden
              ? "ToolIcon_type_button--show"
              : "ToolIcon_type_button--hide",
            {
              ToolIcon: !props.hidden,
              "ToolIcon--selected": props.selected,
              "ToolIcon--plain": props.type === "icon",
            },
          )}
          style={props.style}
          data-testid={props["data-testid"]}
          hidden={props.hidden}
          title={props.title}
          aria-label={props["aria-label"]}
          type={type}
          onPointerDown={(event) => {
            cancelPress();
            press.current = {
              x: event.clientX,
              y: event.clientY,
              handled: false,
            };
            if (props.onLongPress && event.button === 0) {
              const anchor = event.currentTarget;
              press.current.timer = setTimeout(() => {
                press.current.handled = true;
                props.onLongPress?.(anchor);
              }, 450);
            }
          }}
          onPointerMove={(event) => {
            if (
              Math.hypot(
                event.clientX - press.current.x,
                event.clientY - press.current.y,
              ) > 8
            ) {
              cancelPress();
            }
          }}
          onPointerUp={cancelPress}
          onPointerCancel={cancelPress}
          onPointerLeave={cancelPress}
          onLostPointerCapture={cancelPress}
          onContextMenu={(event) => {
            if (props.onLongPress) {
              event.preventDefault();
              cancelPress();
              if (!press.current.handled) {
                press.current.handled = true;
                props.onLongPress(event.currentTarget);
              }
            }
          }}
          onKeyDown={(event) => {
            if (
              props.onLongPress &&
              (event.key === "ContextMenu" ||
                (event.shiftKey && event.key === "F10"))
            ) {
              event.preventDefault();
              props.onLongPress(event.currentTarget);
            }
          }}
          onClick={(event) => {
            if (press.current.handled && event.detail !== 0) {
              event.preventDefault();
              press.current.handled = false;
              return;
            }
            void onClick(event);
          }}
          ref={innerRef}
          disabled={isLoading || props.isLoading || !!props.disabled}
        >
          {(props.icon || props.label) && (
            <div
              className="ToolIcon__icon"
              aria-hidden="true"
              aria-disabled={!!props.disabled}
            >
              {props.icon || props.label}
              {props.keyBindingLabel && (
                <span className="ToolIcon__keybinding">
                  {props.keyBindingLabel}
                </span>
              )}
              {props.isLoading && <Spinner />}
            </div>
          )}
          {props.showAriaLabel && (
            <div className="ToolIcon__label">
              {props["aria-label"]} {isLoading && <Spinner />}
            </div>
          )}
          {props.children}
        </button>
      );
    }

    return (
      <label
        className={clsx("ToolIcon", className)}
        title={props.title}
        onPointerDown={(event) => {
          cancelPress();
          press.current = {
            x: event.clientX,
            y: event.clientY,
            handled: false,
          };
          lastPointerTypeRef.current = event.pointerType || null;
          props.onPointerDown?.({ pointerType: event.pointerType || null });
          if (props.onLongPress && event.button === 0) {
            const anchor = event.currentTarget;
            press.current.timer = setTimeout(() => {
              press.current.handled = true;
              props.onLongPress?.(anchor);
            }, 450);
          }
        }}
        onPointerMove={(event) => {
          if (
            Math.hypot(
              event.clientX - press.current.x,
              event.clientY - press.current.y,
            ) > 8
          ) {
            cancelPress();
          }
        }}
        onPointerCancel={cancelPress}
        onPointerLeave={cancelPress}
        onContextMenu={(event) => {
          if (props.onLongPress) {
            event.preventDefault();
            cancelPress();
            press.current.handled = true;
            props.onLongPress(event.currentTarget);
          }
        }}
        onClick={(event) => {
          if (press.current.handled) {
            event.preventDefault();
          }
        }}
        onPointerUp={() => {
          cancelPress();
          requestAnimationFrame(() => {
            lastPointerTypeRef.current = null;
          });
        }}
      >
        <input
          {...dataAttributes}
          className={`ToolIcon_type_radio ${sizeCn}`}
          type="radio"
          name={props.name}
          aria-label={props["aria-label"]}
          aria-keyshortcuts={
            [props["aria-keyshortcuts"], props.onLongPress && "Shift+F10"]
              .filter(Boolean)
              .join(" ") || undefined
          }
          data-testid={props["data-testid"]}
          id={`${excalId}-${props.id}`}
          onChange={() => {
            if (!press.current.handled) {
              props.onChange?.({ pointerType: lastPointerTypeRef.current });
            }
          }}
          onKeyDown={(event) => {
            if (
              props.onLongPress &&
              (event.key === "ContextMenu" ||
                (event.shiftKey && event.key === "F10"))
            ) {
              event.preventDefault();
              props.onLongPress(event.currentTarget.parentElement!);
            }
          }}
          checked={props.checked}
          ref={innerRef}
        />
        <div className="ToolIcon__icon">
          {props.icon}
          {props.keyBindingLabel && (
            <span className="ToolIcon__keybinding">
              {props.keyBindingLabel}
            </span>
          )}
        </div>
        {props.label && (
          <span className="fc-tool-label" aria-hidden="true">
            {props.label}
          </span>
        )}
      </label>
    );
  },
);

ToolButton.displayName = "ToolButton";
