import { useTunnels } from "../context/tunnels";
import { useToolbarItems } from "../toolbarPreferences";

import type { ToolbarItem } from "../toolbarPreferences";

/** Host controls rendered alongside the editor's own drawing tools. */
export const ToolbarExtras = ({
  children,
  placement = "tools",
  toolId,
}: {
  children: React.ReactNode;
  placement?:
    | "navigation"
    | "actions"
    | "tools"
    | "insert"
    | "shapes"
    | "toolbox";
  toolId?: ToolbarItem;
}) => {
  const tunnels = useTunnels();
  const items = useToolbarItems();
  const index = toolId ? items.indexOf(toolId) : -1;
  const Tunnel =
    placement === "navigation"
      ? tunnels.ToolbarNavigationTunnel
      : placement === "actions"
      ? tunnels.ToolbarActionsTunnel
      : placement === "insert"
      ? tunnels.ToolbarInsertTunnel
      : placement === "shapes"
      ? tunnels.ToolbarShapesTunnel
      : placement === "toolbox"
      ? tunnels.ToolbarToolboxTunnel
      : tunnels.ToolbarExtrasTunnel;
  if (toolId && index < 0) {
    return null;
  }
  return (
    <Tunnel.In>
      {toolId ? (
        <span
          className="fc-toolbar-shortcut"
          data-toolbar-item={toolId}
          style={{ order: 10 + index }}
        >
          {children}
        </span>
      ) : (
        children
      )}
    </Tunnel.In>
  );
};
