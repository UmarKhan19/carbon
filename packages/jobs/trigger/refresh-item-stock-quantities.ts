import { getCarbonServiceRole } from "@carbon/auth";
import { schedules } from "@trigger.dev/sdk";

const serviceRole = getCarbonServiceRole();

export const refreshItemStockQuantities = schedules.task({
  id: "refresh-item-stock-quantities",
  cron: "*/30 * * * *",
  run: async () => {
    console.log(
      `📦 Refreshing item stock quantities: ${new Date().toISOString()}`
    );

    const { error } = await serviceRole.rpc(
      "refresh_item_stock_quantities"
    );

    if (error) {
      console.error(
        `❌ Failed to refresh item stock quantities: ${JSON.stringify(error)}`
      );
      return;
    }

    console.log(`✅ Item stock quantities refreshed successfully`);
  },
});
