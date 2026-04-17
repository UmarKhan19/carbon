import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { PrintingSettings } from "@carbon/printing";
import { deletePrinterRoute } from "@carbon/printing";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const { id } = params;
  if (!id) throw new Error("Printer route ID is required");

  const result = await deletePrinterRoute(client, id, companyId);
  if (result.error) {
    throw redirect(
      path.to.printingSettings,
      await flash(
        request,
        error(result.error, "Failed to delete printer route")
      )
    );
  }

  // Clean up dangling references in printing settings
  const { data: existing } = await client
    .from("companySettings")
    .select("printing")
    .eq("id", companyId)
    .single();

  const current = existing?.printing as PrintingSettings | null;
  if (current) {
    let dirty = false;
    const settings = { ...current };

    if (settings.assignments) {
      const assignments = { ...settings.assignments };
      for (const [dtId, assignment] of Object.entries(assignments)) {
        if (assignment?.printerRouteId === id) {
          assignments[dtId] = { ...assignment, printerRouteId: null };
          dirty = true;
        }
      }
      settings.assignments = assignments;
    }

    if (settings.locationOverrides) {
      const overrides = { ...settings.locationOverrides };
      for (const [locId, locOverride] of Object.entries(overrides)) {
        const cleaned = { ...locOverride };
        for (const [lt, prId] of Object.entries(cleaned)) {
          if (prId === id) {
            delete cleaned[lt as keyof typeof cleaned];
            dirty = true;
          }
        }
        if (Object.keys(cleaned).length === 0) {
          delete overrides[locId];
        } else {
          overrides[locId] = cleaned;
        }
      }
      settings.locationOverrides = overrides;
    }

    if (settings.workCenterOverrides) {
      const overrides = { ...settings.workCenterOverrides };
      for (const [wcId, wcOverride] of Object.entries(overrides)) {
        const cleaned = { ...wcOverride };
        for (const [lt, prId] of Object.entries(cleaned)) {
          if (prId === id) {
            delete cleaned[lt as keyof typeof cleaned];
            dirty = true;
          }
        }
        if (Object.keys(cleaned).length === 0) {
          delete overrides[wcId];
        } else {
          overrides[wcId] = cleaned;
        }
      }
      settings.workCenterOverrides = overrides;
    }

    if (dirty) {
      await client
        .from("companySettings")
        .update({ printing: JSON.parse(JSON.stringify(settings)) })
        .eq("id", companyId);
    }
  }

  throw redirect(
    path.to.printingSettings,
    await flash(request, success("Printer route deleted"))
  );
}
