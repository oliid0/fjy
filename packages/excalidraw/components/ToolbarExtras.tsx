import { useTunnels } from "../context/tunnels";

/** Host controls rendered alongside the editor's own drawing tools. */
export const ToolbarExtras = ({
  children,
  placement = "tools",
}: {
  children: React.ReactNode;
  placement?: "navigation" | "tools";
}) => {
  const tunnels = useTunnels();
  const Tunnel =
    placement === "navigation"
      ? tunnels.ToolbarNavigationTunnel
      : tunnels.ToolbarExtrasTunnel;
  return <Tunnel.In>{children}</Tunnel.In>;
};
