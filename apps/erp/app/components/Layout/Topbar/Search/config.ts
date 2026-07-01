import type { IconType } from "react-icons";
import {
  LuFileCheck,
  LuGauge,
  LuHardHat,
  LuOctagonAlert,
  LuPackageSearch,
  LuShoppingCart,
  LuSquareUser,
  LuUser,
  LuWrench
} from "react-icons/lu";
import { PiShareNetworkFill } from "react-icons/pi";
import {
  RiProgress2Line,
  RiProgress4Line,
  RiProgress8Line
} from "react-icons/ri";

// Entity type styling configuration
export const entityTypeConfig: Record<
  string,
  { bgColor: string; textColor: string; icon: IconType }
> = {
  customer: {
    bgColor: "bg-status-blue/12",
    textColor: "text-status-blue-fg",
    icon: LuSquareUser
  },
  supplier: {
    bgColor: "bg-status-purple/12",
    textColor: "text-status-purple-fg",
    icon: PiShareNetworkFill
  },
  gauge: {
    bgColor: "",
    textColor: "",
    icon: LuGauge
  },
  issue: {
    bgColor: "",
    textColor: "",
    icon: LuOctagonAlert
  },
  item: {
    bgColor: "bg-status-green/12",
    textColor: "text-status-green-fg",
    icon: LuWrench
  },
  job: {
    bgColor: "bg-status-orange/12",
    textColor: "text-status-orange-fg",
    icon: LuHardHat
  },
  employee: {
    bgColor: "bg-status-blue/12",
    textColor: "text-status-blue-fg",
    icon: LuUser
  },
  purchaseOrder: {
    bgColor: "bg-status-yellow/12",
    textColor: "text-status-yellow-fg",
    icon: LuShoppingCart
  },
  salesInvoice: {
    bgColor: "bg-status-green/12",
    textColor: "text-status-green-fg",
    icon: RiProgress8Line
  },
  purchaseInvoice: {
    bgColor: "bg-status-red/12",
    textColor: "text-status-red-fg",
    icon: LuFileCheck
  },
  quote: {
    bgColor: "bg-status-purple/12",
    textColor: "text-status-purple-fg",
    icon: RiProgress4Line
  },
  salesRfq: {
    bgColor: "bg-status-red/12",
    textColor: "text-status-red-fg",
    icon: RiProgress2Line
  },
  salesOrder: {
    bgColor: "bg-status-green/12",
    textColor: "text-status-green-fg",
    icon: RiProgress8Line
  },
  supplierQuote: {
    bgColor: "bg-status-purple/12",
    textColor: "text-status-purple-fg",
    icon: LuPackageSearch
  }
};

export function getEntityTypeConfig(entityType: string) {
  return (
    entityTypeConfig[entityType] ?? {
      bgColor: "bg-muted",
      textColor: "text-muted-foreground",
      icon: null
    }
  );
}

export function getEntityTypeLabel(entityType: string): string {
  const labels: Record<string, string> = {
    customer: "Customer",
    supplier: "Supplier",
    gauge: "Gauge",
    issue: "Issue",
    item: "Item",
    job: "Job",
    employee: "Person",
    purchaseOrder: "Purchase Order",
    salesInvoice: "Sales Invoice",
    purchaseInvoice: "Purchase Invoice",
    quote: "Quote",
    salesRfq: "RFQ",
    salesOrder: "Sales Order",
    supplierQuote: "Supplier Quote"
  };
  return labels[entityType] ?? entityType;
}
