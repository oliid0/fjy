import React, {
  useId,
  useLayoutEffect,
  useEffect,
  useSyncExternalStore,
} from "react";

const useClientLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;
const empty: React.ReactNode[] = [];

/** Unlike append-on-update tunnels, toolbar controls keep both their order and DOM identity. */
export const stableToolbarTunnel = () => {
  const entries = new Map<string, React.ReactNode>();
  const listeners = new Set<() => void>();
  let snapshot: React.ReactNode[] = empty;
  const publish = () => {
    snapshot = Array.from(entries, ([id, children]) => (
      <React.Fragment key={id}>{children}</React.Fragment>
    ));
    listeners.forEach((listener) => listener());
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  return {
    useHasEntries: () =>
      useSyncExternalStore(
        subscribe,
        () => snapshot,
        () => empty,
      ).length > 0,
    In: ({ children }: { children: React.ReactNode }) => {
      const id = useId();
      useClientLayoutEffect(() => {
        entries.set(id, children);
        publish();
      }, [id, children]);
      useClientLayoutEffect(
        () => () => {
          entries.delete(id);
          publish();
        },
        [id],
      );
      return null;
    },
    Out: () => (
      <>
        {useSyncExternalStore(
          subscribe,
          () => snapshot,
          () => empty,
        )}
      </>
    ),
  };
};
