import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { useShelves } from "~/components/Form/Shelf";
import { useRouteData } from "~/hooks";
import { InventoryDetails } from "~/modules/inventory";
import type { ToolSummary, UnitOfMeasureListItem } from "~/modules/items";
import {
  getItemQuantities,
  getItemShelfLife,
  getItemShelfQuantities,
  getPickMethod,
  getShelfLifeLabelTypes,
  getStorageTypes,
  itemShelfLifeValidator,
  pickMethodValidator,
  upsertItemShelfLife,
  upsertPickMethod
} from "~/modules/items";
import { ItemShelfLifeForm, PickMethodForm } from "~/modules/items/ui/Item";
import { getLocationsList } from "~/modules/resources";
import { getUserDefaults } from "~/modules/users/users.server";
import { useItems } from "~/stores/items";
import type { ListItem } from "~/types";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "parts"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  let locationId = searchParams.get("location");

  if (!locationId) {
    const userDefaults = await getUserDefaults(client, userId, companyId);
    if (userDefaults.error) {
      throw redirect(
        path.to.tool(itemId),
        await flash(
          request,
          error(userDefaults.error, "Failed to load default location")
        )
      );
    }

    locationId = userDefaults.data?.locationId ?? null;
  }

  if (!locationId) {
    const locations = await getLocationsList(client, companyId);
    if (locations.error || !locations.data?.length) {
      throw redirect(
        path.to.tool(itemId),
        await flash(
          request,
          error(locations.error, "Failed to load any locations")
        )
      );
    }
    locationId = locations.data?.[0].id as string;
  }

  let [toolInventory, shelfLifeResult, storageTypesResult, labelTypesResult] =
    await Promise.all([
      getPickMethod(client, itemId, companyId, locationId),
      getItemShelfLife(client, itemId),
      getStorageTypes(client, companyId),
      getShelfLifeLabelTypes(client, companyId)
    ]);

  if (toolInventory.error || !toolInventory.data) {
    const insertPickMethod = await upsertPickMethod(client, {
      itemId,
      companyId,
      locationId,
      customFields: {},
      createdBy: userId
    });

    if (insertPickMethod.error) {
      throw redirect(
        path.to.tool(itemId),
        await flash(
          request,
          error(insertPickMethod.error, "Failed to insert tool inventory")
        )
      );
    }

    toolInventory = await getPickMethod(client, itemId, companyId, locationId);
    if (toolInventory.error || !toolInventory.data) {
      throw redirect(
        path.to.tool(itemId),
        await flash(
          request,
          error(toolInventory.error, "Failed to load tool inventory")
        )
      );
    }
  }

  const quantities = await getItemQuantities(
    client,
    itemId,
    companyId,
    locationId
  );
  if (quantities.error) {
    throw redirect(
      path.to.items,
      await flash(request, error(quantities, "Failed to load tool quantities"))
    );
  }

  const itemShelfQuantities = await getItemShelfQuantities(
    client,
    itemId,
    companyId,
    locationId
  );
  if (itemShelfQuantities.error || !itemShelfQuantities.data) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(itemShelfQuantities, "Failed to load tool quantities")
      )
    );
  }

  return {
    toolInventory: toolInventory.data,
    itemShelfQuantities: itemShelfQuantities.data,
    quantities: quantities.data,
    shelfLife: shelfLifeResult.data,
    storageTypes: storageTypesResult.data ?? [],
    shelfLifeLabelTypes: labelTypesResult.data ?? [],
    itemId,
    locationId
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "parts"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "shelfLife") {
    const validation = await validator(itemShelfLifeValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);

    const existing = await getItemShelfLife(client, itemId);
    const result = await upsertItemShelfLife(
      client,
      existing.data
        ? { ...validation.data, updatedBy: userId }
        : { ...validation.data, companyId, createdBy: userId }
    );

    if (result.error) {
      throw redirect(
        path.to.tool(itemId),
        await flash(request, error(result.error, "Failed to save shelf life"))
      );
    }

    throw redirect(
      path.to.toolInventory(itemId),
      await flash(request, success("Saved shelf life config"))
    );
  }

  const validation = await validator(pickMethodValidator).validate(formData);
  if (validation.error) return validationError(validation.error);

  const { ...update } = validation.data;

  const updatePickMethod = await upsertPickMethod(client, {
    ...update,
    itemId,
    customFields: setCustomFields(formData),
    updatedBy: userId
  });
  if (updatePickMethod.error) {
    throw redirect(
      path.to.tool(itemId),
      await flash(
        request,
        error(updatePickMethod.error, "Failed to update tool inventory")
      )
    );
  }

  throw redirect(
    path.to.toolInventoryLocation(itemId, update.locationId),
    await flash(request, success("Updated tool inventory"))
  );
}

export default function ToolInventoryRoute() {
  const sharedToolsData = useRouteData<{
    locations: ListItem[];
    unitOfMeasures: UnitOfMeasureListItem[];
  }>(path.to.toolRoot);

  const {
    toolInventory,
    itemShelfQuantities,
    quantities,
    shelfLife,
    storageTypes,
    shelfLifeLabelTypes,
    itemId
  } = useLoaderData<typeof loader>();

  const toolData = useRouteData<{
    toolSummary: ToolSummary;
  }>(path.to.tool(itemId));
  if (!toolData) throw new Error("Could not find tool data");
  const itemUnitOfMeasureCode = toolData?.toolSummary?.unitOfMeasureCode;

  const initialValues = {
    ...toolInventory,
    defaultShelfId: toolInventory.defaultShelfId ?? undefined,
    ...getCustomFields(toolInventory.customFields ?? {})
  };

  const [items] = useItems();
  const itemTrackingType = items.find((i) => i.id === itemId)?.itemTrackingType;

  const shelves = useShelves(toolInventory?.locationId);

  const shelfLifeInitialValues = {
    itemId,
    totalShelfLifeDays: shelfLife?.totalShelfLifeDays ?? undefined,
    commercialShelfLifeDays: shelfLife?.commercialShelfLifeDays ?? undefined,
    minRemainingShelfLifeDays:
      shelfLife?.minRemainingShelfLifeDays ?? undefined,
    storageTypeId: shelfLife?.storageTypeId ?? undefined,
    shelfLifeLabelTypeId: shelfLife?.shelfLifeLabelTypeId ?? undefined
  };

  return (
    <VStack spacing={2} className="p-2">
      <PickMethodForm
        key={initialValues.itemId}
        initialValues={initialValues}
        locations={sharedToolsData?.locations ?? []}
        shelves={shelves.options}
        type="Part"
      />
      <InventoryDetails
        itemShelfQuantities={itemShelfQuantities}
        itemUnitOfMeasureCode={itemUnitOfMeasureCode ?? "EA"}
        itemTrackingType={itemTrackingType ?? "Inventory"}
        pickMethod={initialValues}
        quantities={quantities}
        shelves={shelves.options}
        shelfLifeForm={
          <ItemShelfLifeForm
            key={`${itemId}-shelf-life`}
            initialValues={shelfLifeInitialValues}
            storageTypes={storageTypes}
            shelfLifeLabelTypes={shelfLifeLabelTypes}
          />
        }
      />
    </VStack>
  );
}
