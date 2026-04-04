import type { Namespace } from "@carbon/locale";

const sharedNamespace: readonly Namespace[] = ["shared"];
const sharedAndSalesNamespaces: readonly Namespace[] = ["shared", "sales"];

const salesNamespaceRoutes = [
  /^\/x\/sales(?:\/|$)/,
  /^\/x\/sales-rfq(?:\/|$)/,
  /^\/x\/quote(?:\/|$)/,
  /^\/x\/sales-order(?:\/|$)/,
  /^\/x\/sales-invoice(?:\/|$)/,
  /^\/x\/customer(?:\/|$)/,
  /^\/x\/settings\/sales(?:\/|$)/
];

export const getRouteNamespaces = (pathname: string): readonly Namespace[] => {
  return salesNamespaceRoutes.some((routeMatcher) =>
    routeMatcher.test(pathname)
  )
    ? sharedAndSalesNamespaces
    : sharedNamespace;
};
