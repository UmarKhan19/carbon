import { Status } from "@carbon/react";
import type { PriceListStatusType } from "../types";

type PriceListStatusProps = {
  status?: PriceListStatusType | null;
};

/**
 * Maps a price list lifecycle status to a semantic Status badge color.
 *
 * - Draft    → gray   (work in progress, not yet effective)
 * - Active   → green  (currently in use by the resolver)
 * - Expired  → orange (date range elapsed but history preserved)
 * - Archived → red    (manually retired, history preserved)
 *
 * Replaces ad-hoc Enumerable / Badge variant usage so the same status
 * always renders with the same color across the app.
 */
const PriceListStatus = ({ status }: PriceListStatusProps) => {
  switch (status) {
    case "Draft":
      return <Status color="gray">Draft</Status>;
    case "Active":
      return <Status color="green">Active</Status>;
    case "Expired":
      return <Status color="orange">Expired</Status>;
    case "Archived":
      return <Status color="red">Archived</Status>;
    default:
      return null;
  }
};

export default PriceListStatus;
