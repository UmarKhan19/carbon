import { LuShoppingCart } from "react-icons/lu";
import { z } from "zod";
import type { ToolConfig } from "../agents/shared/tools";

export const config: ToolConfig = {
  name: "createPurchaseOrder",
  icon: LuShoppingCart,
  displayText: "Creating a Purchase Order",
  message: "Creating a purchase order..."
};

export const createPurchaseOrderSchema = z.object({
  supplierId: z.string(),
  parts: z.array(
    z.object({
      partId: z.string(),
      quantity: z.number().positive().default(1)
    })
  )
});
