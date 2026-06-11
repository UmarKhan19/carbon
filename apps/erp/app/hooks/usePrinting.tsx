import type { PrinterRoute, PrintingSettings } from "@carbon/printing";
import { useRouteData } from "@carbon/react";
import { useCallback, useMemo } from "react";
import { path } from "~/utils/path";

type PrintContext = "shipping" | "receiving" | "inventory" | "workCenter";

export function usePrinting() {
  const data = useRouteData<{
    companySettings?: { printing?: PrintingSettings } | null;
    printerRoutes?: PrinterRoute[];
  }>(path.to.authenticatedRoot);

  const printing =
    (data?.companySettings?.printing as PrintingSettings) ?? null;
  const printerRoutes = data?.printerRoutes ?? [];

  const routeMap = useMemo(
    () => new Map(printerRoutes.map((r) => [r.id, r])),
    [printerRoutes]
  );

  const resolvePrinterRoute = useCallback(
    (
      locationId: string | undefined,
      context: PrintContext,
      workCenterId?: string
    ): PrinterRoute | null => {
      if (!locationId || !printing) return null;

      const assignment = printing.assignments?.[locationId];
      if (!assignment) return null;

      let printerRouteId: string | null = null;

      switch (context) {
        case "shipping":
          printerRouteId = assignment.shipping?.printerRouteId ?? null;
          break;
        case "receiving":
          printerRouteId = assignment.receiving?.printerRouteId ?? null;
          break;
        case "inventory":
          printerRouteId = assignment.inventory?.printerRouteId ?? null;
          break;
        case "workCenter":
          printerRouteId = workCenterId
            ? (assignment.workCenters?.[workCenterId]?.printerRouteId ?? null)
            : null;
          break;
      }

      if (!printerRouteId) {
        printerRouteId = assignment.defaultPrinterRouteId;
      }

      if (!printerRouteId) return null;
      return routeMap.get(printerRouteId) ?? null;
    },
    [printing, routeMap]
  );

  const hasPrinter = useCallback(
    (
      locationId: string | undefined,
      context: PrintContext,
      workCenterId?: string
    ): boolean => {
      return resolvePrinterRoute(locationId, context, workCenterId) !== null;
    },
    [resolvePrinterRoute]
  );

  return { printing, printerRoutes, resolvePrinterRoute, hasPrinter };
}
