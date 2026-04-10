import {
  Drawer,
  DrawerContent,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useIsMobile
} from "@carbon/react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { useLocation } from "react-router";

interface PanelContextType {
  isExplorerCollapsed: boolean;
  isPropertiesCollapsed: boolean;
  toggleExplorer: () => void;
  toggleProperties: () => void;
  setIsExplorerCollapsed: (collapsed: boolean) => void;
  setIsPropertiesCollapsed: (collapsed: boolean) => void;
}

const PanelContext = createContext<PanelContextType | null>(null);

export function usePanels() {
  const context = useContext(PanelContext);
  if (!context) {
    throw new Error("usePanels must be used within a PanelProvider");
  }
  return context;
}

interface PanelProviderProps {
  children: React.ReactNode;
}

export function PanelProvider({ children }: PanelProviderProps) {
  const isBrowser = typeof window !== "undefined";
  const isMobile = useIsMobile();

  const [isExplorerCollapsed, setIsExplorerCollapsed] = useState(
    isBrowser ? isMobile : false
  );
  const [isPropertiesCollapsed, setIsPropertiesCollapsed] = useState(
    isBrowser ? window.innerWidth < 1024 : false
  );

  const value = {
    isExplorerCollapsed,
    isPropertiesCollapsed,
    toggleExplorer: () => setIsExplorerCollapsed((prev) => !prev),
    toggleProperties: () => setIsPropertiesCollapsed((prev) => !prev),
    setIsExplorerCollapsed,
    setIsPropertiesCollapsed
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (isMobile) {
      setIsExplorerCollapsed(true);
      setIsPropertiesCollapsed(true);
    }
  }, [isBrowser, isMobile]);

  return (
    <PanelContext.Provider value={value}>{children}</PanelContext.Provider>
  );
}

interface ResizablePanelsProps {
  explorer?: React.ReactNode;
  content: React.ReactNode;
  properties?: React.ReactNode;
  defaultExplorerSize?: number;
}

export function ResizablePanels({
  explorer,
  content,
  properties,
  defaultExplorerSize = 20
}: ResizablePanelsProps) {
  const panels = useContext(PanelContext);
  const isBrowser = typeof window !== "undefined";
  const isMobile = useIsMobile();

  // Fallback local state when used outside a PanelProvider so that drawers
  // can still open and close (e.g. on item master routes).
  const [localExplorerCollapsed, setLocalExplorerCollapsed] = useState(
    isBrowser ? isMobile : false
  );
  const [localPropertiesCollapsed, setLocalPropertiesCollapsed] = useState(
    isBrowser ? window.innerWidth < 1024 : false
  );

  const isExplorerCollapsed =
    panels?.isExplorerCollapsed ?? localExplorerCollapsed;
  const isPropertiesCollapsed =
    panels?.isPropertiesCollapsed ?? localPropertiesCollapsed;
  const setIsExplorerCollapsed =
    panels?.setIsExplorerCollapsed ?? setLocalExplorerCollapsed;
  const setIsPropertiesCollapsed =
    panels?.setIsPropertiesCollapsed ?? setLocalPropertiesCollapsed;

  const panelRef = useRef<ImperativePanelHandle>(null);
  const location = useLocation();
  const prevPathnameRef = useRef(location.pathname);

  // When there is no provider, mirror the provider's mobile-close behavior.
  useEffect(() => {
    if (!panels && isMobile) {
      setLocalExplorerCollapsed(true);
      setLocalPropertiesCollapsed(true);
    }
  }, [panels, isMobile]);

  useEffect(() => {
    if (isMobile) return;
    if (isExplorerCollapsed) {
      panelRef.current?.collapse();
    } else {
      panelRef.current?.expand();
    }
  }, [isExplorerCollapsed, isMobile]);

  // On mobile, auto-close the explorer drawer after navigating to a new route
  // so tapping a line item dismisses the drawer and reveals the content.
  useEffect(() => {
    if (isMobile && prevPathnameRef.current !== location.pathname) {
      setIsExplorerCollapsed(true);
    }
    prevPathnameRef.current = location.pathname;
  }, [location.pathname, isMobile, setIsExplorerCollapsed]);

  if (isMobile) {
    return (
      <>
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          {content}
        </div>
        {explorer && (
          <Drawer
            open={!isExplorerCollapsed}
            onOpenChange={(open) => setIsExplorerCollapsed(!open)}
          >
            <DrawerContent
              position="left"
              size="md"
              className="p-0 overflow-hidden w-full max-w-sm"
              overlayClassName="bg-black/40"
            >
              <div className="flex flex-col h-full w-full overflow-hidden bg-card pt-10">
                {explorer}
              </div>
            </DrawerContent>
          </Drawer>
        )}
        {properties && (
          <Drawer
            open={!isPropertiesCollapsed}
            onOpenChange={(open) => setIsPropertiesCollapsed(!open)}
          >
            <DrawerContent
              position="right"
              size="md"
              className="p-0 overflow-hidden w-full max-w-sm"
              overlayClassName="bg-black/40"
            >
              <div className="flex flex-col h-full w-full bg-card pt-10 overflow-y-auto [&>*]:!w-full [&>*]:!h-auto [&>*]:!border-0 [&>*]:!overflow-visible">
                {properties}
              </div>
            </DrawerContent>
          </Drawer>
        )}
      </>
    );
  }

  return (
    <ResizablePanelGroup direction="horizontal">
      <ResizablePanel
        ref={panelRef}
        order={1}
        minSize={10}
        className="bg-card shadow-lg"
        collapsible
        defaultSize={isExplorerCollapsed ? 0 : defaultExplorerSize}
        collapsedSize={0}
        onCollapse={() => setIsExplorerCollapsed(true)}
        onExpand={() => setIsExplorerCollapsed(false)}
      >
        {!isExplorerCollapsed && explorer}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel order={2} className="z-1 relative">
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          {content}
          {!isPropertiesCollapsed && properties}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
