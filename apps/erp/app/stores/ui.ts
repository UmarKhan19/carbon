import { create } from "zustand";
import type { Route, RouteGroup } from "~/types";

interface UIStore {
  isSearchModalOpen: boolean;
  openSearchModal: () => void;
  closeSearchModal: () => void;
  toggleSearchModal: () => void;
  isSidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  // Mobile sub-nav: populated by the active module's sidebar component so the
  // mobile primary navigation drawer can render the current module's routes
  // alongside the module switcher.
  mobileSubNavGroups: RouteGroup[] | null;
  mobileSubNavLinks: Route[] | null;
  setMobileSubNavGroups: (groups: RouteGroup[] | null) => void;
  setMobileSubNavLinks: (links: Route[] | null) => void;
}

export const useUIStore = create<UIStore>()((set) => ({
  isSearchModalOpen: false,
  openSearchModal: () => set({ isSearchModalOpen: true }),
  closeSearchModal: () => set({ isSearchModalOpen: false }),
  toggleSearchModal: () =>
    set((state) => ({ isSearchModalOpen: !state.isSearchModalOpen })),
  isSidebarOpen: true,
  setSidebarOpen: (open) => set({ isSidebarOpen: open }),
  toggleSidebar: () =>
    set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  mobileSubNavGroups: null,
  mobileSubNavLinks: null,
  setMobileSubNavGroups: (groups) => set({ mobileSubNavGroups: groups }),
  setMobileSubNavLinks: (links) => set({ mobileSubNavLinks: links })
}));
