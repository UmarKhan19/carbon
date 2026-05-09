import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useIsMobile
} from "@carbon/react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";

interface PanelContextType {
  isExplorerCollapsed: boolean;
  isPropertiesCollapsed: boolean;
  toggleExplorer: () => void;
  toggleProperties: () => void;
  setIsExplorerCollapsed: (collapsed: boolean) => void;
  setIsPropertiesCollapsed: (collapsed: boolean) => void;
}

const PanelContext = createContext<PanelContextType>({
  isExplorerCollapsed: false,
  isPropertiesCollapsed: false,
  // biome-ignore lint/suspicious/noEmptyBlockStatements: suppressed due to migration
  toggleExplorer: () => {},
  // biome-ignore lint/suspicious/noEmptyBlockStatements: suppressed due to migration
  toggleProperties: () => {},
  // biome-ignore lint/suspicious/noEmptyBlockStatements: suppressed due to migration
  setIsExplorerCollapsed: () => {},
  // biome-ignore lint/suspicious/noEmptyBlockStatements: suppressed due to migration
  setIsPropertiesCollapsed: () => {}
});

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
}

export function ResizablePanels({
  explorer,
  content,
  properties
}: ResizablePanelsProps) {
  const {
    isExplorerCollapsed,
    isPropertiesCollapsed,
    setIsExplorerCollapsed,
    setIsPropertiesCollapsed
  } = usePanels();
  const explorerRef = useRef<ImperativePanelHandle>(null);
  const propertiesRef = useRef<ImperativePanelHandle>(null);

  useEffect(() => {
    if (isExplorerCollapsed) {
      explorerRef.current?.collapse();
    } else {
      explorerRef.current?.expand();
    }
  }, [isExplorerCollapsed]);

  useEffect(() => {
    if (!properties) return;
    if (isPropertiesCollapsed) {
      propertiesRef.current?.collapse();
    } else {
      propertiesRef.current?.expand();
    }
  }, [isPropertiesCollapsed, properties]);

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full w-full">
      <ResizablePanel
        ref={explorerRef}
        order={1}
        minSize={10}
        maxSize={30}
        className="bg-card shadow-lg"
        collapsible
        defaultSize={isExplorerCollapsed ? 0 : 20}
        collapsedSize={0}
        onCollapse={() => setIsExplorerCollapsed(true)}
        onExpand={() => setIsExplorerCollapsed(false)}
      >
        {!isExplorerCollapsed && explorer}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel order={2} minSize={30} className="z-1 relative">
        {content}
      </ResizablePanel>
      {properties && (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel
            ref={propertiesRef}
            id="properties-panel"
            order={3}
            minSize={15}
            maxSize={35}
            defaultSize={isPropertiesCollapsed ? 0 : 22}
            collapsedSize={0}
            collapsible
            onCollapse={() => setIsPropertiesCollapsed(true)}
            onExpand={() => setIsPropertiesCollapsed(false)}
          >
            {!isPropertiesCollapsed && properties}
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );
}
