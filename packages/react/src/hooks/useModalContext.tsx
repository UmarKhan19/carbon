import { createContext, type ReactNode, useContext, useMemo } from "react";

/**
 * Context to track if a component is inside a modal, drawer, or popover.
 * Used to prevent default right-click behavior inside modals while allowing
 * native right-click context menu in the rest of the application.
 */
const ModalContextProvider = createContext<boolean>(false);

/**
 * Hook to check if a component is inside a modal, drawer, or popover
 * @returns boolean indicating if component is inside a modal
 */
export function useIsInModal(): boolean {
  return useContext(ModalContextProvider);
}

/**
 * Provider component to mark that children are inside a modal/drawer/popover
 */
export function ModalContextWrapper({ children }: { children: ReactNode }) {
  const value = useMemo(() => true, []);
  return (
    <ModalContextProvider.Provider value={value}>
      {children}
    </ModalContextProvider.Provider>
  );
}

export { ModalContextProvider };
