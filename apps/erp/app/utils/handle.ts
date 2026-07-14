export type Handle = {
  breadcrumb?: any;
  to?: string;
  module?: string;
  // When true, a module _layout hides its GroupedContentSidebar for this route —
  // used by full-screen detail views that provide their own left panel (e.g. the
  // change-order workspace) so the app doesn't stack two left sidebars.
  hideModuleSidebar?: boolean;
};
