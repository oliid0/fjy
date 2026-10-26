import { useContext } from "react";

import { useEditorInterface } from "../App";

import { Ellipsify } from "../Ellipsify";

import { DropdownMenuContentPropsContext } from "./common";

import type { JSX } from "react";

const MenuItemContent = ({
  textStyle,
  icon,
  shortcut,
  children,
  badge,
}: {
  icon?: JSX.Element;
  shortcut?: string;
  textStyle?: React.CSSProperties;
  children: React.ReactNode;
  badge?: React.ReactNode;
}) => {
  const editorInterface = useEditorInterface();
  const { material } = useContext(DropdownMenuContentPropsContext);
  return (
    <>
      {icon && <div className="dropdown-menu-item__icon">{icon}</div>}
      <div style={textStyle} className="dropdown-menu-item__text">
        {material ? <span>{children}</span> : <Ellipsify>{children}</Ellipsify>}
      </div>
      {badge && <div className="dropdown-menu-item__badge">{badge}</div>}
      {shortcut && editorInterface.formFactor !== "phone" && (
        <div className="dropdown-menu-item__shortcut">{shortcut}</div>
      )}
    </>
  );
};
export default MenuItemContent;
