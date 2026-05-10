import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import type { PrintingSettings } from "@carbon/printing";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { nonScrapQuantityValidator } from "~/services/models";
import {
  finishJobOperation,
  insertProductionQuantity
} from "~/services/operations.service";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const validation = await validator(nonScrapQuantityValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const serviceRole = await getCarbonServiceRole();

  // Get current job operation and production quantities to check if operation will be finished
  const [jobOperation, productionQuantities] = await Promise.all([
    serviceRole
      .from("jobOperation")
      .select("*")
      .eq("id", validation.data.jobOperationId)
      .maybeSingle(),
    serviceRole
      .from("productionQuantity")
      .select("*")
      .eq("type", "Production")
      .eq("jobOperationId", validation.data.jobOperationId)
  ]);

  if (jobOperation.error || !jobOperation.data) {
    return data(
      {},
      await flash(request, {
        ...error(jobOperation.error, "Failed to fetch job operation"),
        flash: "error"
      })
    );
  }

  const currentQuantity =
    productionQuantities.data?.reduce((acc, curr) => acc + curr.quantity, 0) ??
    0;

  const willBeFinished =
    validation.data.quantity + currentQuantity >=
    (jobOperation.data.targetQuantity ??
      jobOperation.data.operationQuantity ??
      0);

  if (validation.data.trackingType === "Serial") {
    const response = await serviceRole.functions.invoke("issue", {
      body: {
        type: "jobOperationSerialComplete",
        ...validation.data,
        companyId,
        userId
      }
    });

    const newTrackedEntityId = response.data?.newTrackedEntityId;
    // Print the entity that was just completed (from form), not the new reserved one
    const completedEntityId = validation.data.trackedEntityId;

    // Auto-print label if enabled
    if (completedEntityId) {
      try {
        let locationId: string | undefined;
        const workCenterId = jobOperation.data.workCenterId ?? undefined;
        if (workCenterId) {
          const { data: wc } = await serviceRole
            .from("workCenter")
            .select("locationId")
            .eq("id", workCenterId)
            .single();
          locationId = wc?.locationId ?? undefined;
        }
        if (locationId) {
          const { data: cs } = await serviceRole
            .from("companySettings")
            .select("printing")
            .eq("id", companyId)
            .single();
          const printing = cs?.printing as PrintingSettings | null;
          const assignment = printing?.assignments?.[locationId];
          const shouldAutoPrint = workCenterId
            ? assignment?.workCenters?.[workCenterId]?.autoPrint
            : assignment?.defaultAutoPrint;
          if (shouldAutoPrint) {
            await trigger("print-job", {
              sourceDocument: "Entity",
              sourceDocumentId: completedEntityId,
              companyId,
              userId,
              locationId,
              workCenterId
            });
          }
        }
      } catch (e) {
        console.error("Auto-print failed:", e);
      }
    }

    const trackedEntityId = newTrackedEntityId;

    if (willBeFinished) {
      const finishOperation = await finishJobOperation(serviceRole, {
        jobOperationId: jobOperation.data.id,
        userId,
        companyId
      });

      if (finishOperation.error) {
        return data(
          {},
          await flash(request, {
            ...error(finishOperation.error, "Failed to finish operation"),
            flash: "error"
          })
        );
      }

      return redirect(
        path.to.operations,
        await flash(request, {
          ...success("Operation finished successfully"),
          flash: "success"
        })
      );
    }

    if (trackedEntityId) {
      return redirect(
        `${path.to.operation(
          validation.data.jobOperationId
        )}?trackedEntityId=${trackedEntityId}`
      );
    }

    return redirect(`${path.to.operation(validation.data.jobOperationId)}`);
  } else if (validation.data.trackingType === "Batch") {
    const serviceRole = await getCarbonServiceRole();
    const response = await serviceRole.functions.invoke("issue", {
      body: {
        type: "jobOperationBatchComplete",
        ...validation.data,
        companyId,
        userId
      }
    });

    if (response.error) {
      return data(
        {},
        await flash(request, {
          ...error(response.error, "Failed to complete job operation"),
          flash: "error"
        })
      );
    }

    // Auto-print label if enabled (Batch)
    try {
      let batchLocationId: string | undefined;
      const workCenterId = jobOperation.data.workCenterId ?? undefined;
      if (workCenterId) {
        const { data: wc } = await serviceRole
          .from("workCenter")
          .select("locationId")
          .eq("id", workCenterId)
          .single();
        batchLocationId = wc?.locationId ?? undefined;
      }
      if (batchLocationId) {
        const { data: cs } = await serviceRole
          .from("companySettings")
          .select("printing")
          .eq("id", companyId)
          .single();
        const printing = cs?.printing as PrintingSettings | null;
        const assignment = printing?.assignments?.[batchLocationId];
        const shouldAutoPrint = workCenterId
          ? assignment?.workCenters?.[workCenterId]?.autoPrint
          : assignment?.defaultAutoPrint;
        if (shouldAutoPrint) {
          await trigger("print-job", {
            sourceDocument: "Operation",
            sourceDocumentId: validation.data.jobOperationId,
            companyId,
            userId,
            locationId: batchLocationId,
            workCenterId
          });
        }
      }
    } catch (e) {
      console.error("Auto-print failed:", e);
    }

    if (willBeFinished) {
      const finishOperation = await finishJobOperation(serviceRole, {
        jobOperationId: jobOperation.data.id,
        userId,
        companyId
      });

      if (finishOperation.error) {
        return data(
          {},
          await flash(request, {
            ...error(finishOperation.error, "Failed to finish operation"),
            flash: "error"
          })
        );
      }

      return redirect(
        path.to.operations,
        await flash(request, {
          ...success("Operation finished successfully"),
          flash: "success"
        })
      );
    }

    return redirect(`${path.to.operation(validation.data.jobOperationId)}`);
  } else {
    // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
    const { trackedEntityId, trackingType, ...d } = validation.data;
    const insertProduction = await insertProductionQuantity(client, {
      ...d,
      companyId,
      createdBy: userId
    });

    if (insertProduction.error) {
      return data(
        {},
        await flash(request, {
          ...error(
            insertProduction.error,
            "Failed to record production quantity"
          ),
          flash: "error"
        })
      );
    }

    const issue = await serviceRole.functions.invoke("issue", {
      body: {
        id: validation.data.jobOperationId,
        type: "jobOperation",
        quantity: validation.data.quantity,
        companyId,
        userId
      }
    });

    if (issue.error) {
      return data(
        {},
        await flash(request, {
          ...error(issue.error, "Failed to issue materials"),
          flash: "error"
        })
      );
    }

    if (willBeFinished) {
      const finishOperation = await finishJobOperation(serviceRole, {
        jobOperationId: jobOperation.data.id,
        userId,
        companyId
      });

      if (finishOperation.error) {
        return data(
          {},
          await flash(request, {
            ...error(finishOperation.error, "Failed to finish operation"),
            flash: "error"
          })
        );
      }

      return redirect(
        path.to.operations,
        await flash(request, {
          ...success("Operation finished successfully"),
          flash: "success"
        })
      );
    }

    return data(
      insertProduction.data,
      await flash(request, {
        ...success("Successfully completed part"),
        flash: "success"
      })
    );
  }
}
