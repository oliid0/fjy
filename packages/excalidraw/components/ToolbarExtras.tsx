import { useTunnels } from "../context/tunnels";

/** Host controls rendered alongside the editor's own drawing tools. */
export const ToolbarExtras = ({ children }: { children: React.ReactNode }) => {
  const { ToolbarExtrasTunnel } = useTunnels();
  return <ToolbarExtrasTunnel.In>{children}</ToolbarExtrasTunnel.In>;
};
