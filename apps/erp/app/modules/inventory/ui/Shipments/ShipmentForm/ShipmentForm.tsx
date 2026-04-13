import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuEllipsisVertical, LuTrash } from "react-icons/lu";
import type { z } from "zod";
import {
  Combobox,
  CustomFormFields,
  DefaultDisabledSubmit,
  Hidden,
  Input,
  Location,
  Select,
  ShippingMethod
} from "~/components/Form";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import type {
  ShipmentSourceDocument,
  shipmentStatusType
} from "~/modules/inventory";
import {
  shipmentSourceDocumentType,
  shipmentValidator
} from "~/modules/inventory";
import { path } from "~/utils/path";
import useShipmentForm from "./useShipmentForm";

type ShipmentFormProps = {
  initialValues: z.infer<typeof shipmentValidator>;
  status: (typeof shipmentStatusType)[number];
};

const formId = "shipment-form";

const ShipmentForm = ({ initialValues, status }: ShipmentFormProps) => {
  const permissions = usePermissions();
  const { t } = useLingui();
  const {
    locationId,
    sourceDocuments,
    customerId,
    setLocationId,
    setSourceDocument
  } = useShipmentForm({ status, initialValues });

  const isPosted = status === "Posted";
  const isEditing = initialValues.id !== undefined;

  const deleteDisclosure = useDisclosure();

  return (
    <>
      <Card>
        <ValidatedForm
          id={formId}
          validator={shipmentValidator}
          method="post"
          action={path.to.shipmentDetails(initialValues.id)}
          defaultValues={initialValues}
          style={{ width: "100%" }}
        >
          <HStack className="justify-between w-full">
            <CardHeader>
              <CardTitle>{isEditing ? t`Shipment` : t`New Shipment`}</CardTitle>
              {!isEditing && (
                <CardDescription>
                  {t`A shipment is a record of a part shipped to a customer or transferred to another location.`}
                </CardDescription>
              )}
            </CardHeader>
            <CardAction>
              {isEditing &&
                permissions.can("delete", "inventory") &&
                !isPosted && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton
                        aria-label={t`Open menu`}
                        variant="secondary"
                        icon={<LuEllipsisVertical />}
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={deleteDisclosure.onOpen}
                        className="text-destructive hover:text-destructive"
                      >
                        <DropdownMenuIcon icon={<LuTrash />} />
                        <Trans>Delete Shipment</Trans>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
            </CardAction>
          </HStack>
          <CardContent>
            <Hidden name="id" />
            <Hidden name="customerId" value={customerId ?? ""} />
            <VStack spacing={4} className="min-h-full">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 w-full">
                <Input name="shipmentId" label={t`Shipment ID`} isReadOnly />
                <Location
                  name="locationId"
                  label={t`Location`}
                  value={locationId ?? undefined}
                  onChange={(newValue) => {
                    if (newValue) setLocationId(newValue.value as string);
                  }}
                  isReadOnly={isPosted}
                />
                <Select
                  name="sourceDocument"
                  label={t`Source Document`}
                  options={shipmentSourceDocumentType.map((v) => ({
                    label: v,
                    value: v
                  }))}
                  onChange={(newValue) => {
                    if (newValue) {
                      setSourceDocument(
                        newValue.value as ShipmentSourceDocument
                      );
                    }
                  }}
                  isReadOnly={isPosted}
                />
                <Combobox
                  name="sourceDocumentId"
                  label={t`Source Document ID`}
                  options={sourceDocuments.map((d) => ({
                    label: d.name,
                    value: d.id
                  }))}
                  isReadOnly={isPosted}
                />
                <Input name="trackingNumber" label={t`Tracking Number`} />
                <ShippingMethod
                  name="shippingMethodId"
                  label={t`Shipping Method`}
                />
                <CustomFormFields table="shipment" />
              </div>
            </VStack>
          </CardContent>
          <CardFooter>
            <DefaultDisabledSubmit
              formId={formId}
              isDisabled={
                isEditing
                  ? !permissions.can("update", "inventory")
                  : !permissions.can("create", "inventory")
              }
            >
              Save
            </DefaultDisabledSubmit>
          </CardFooter>
        </ValidatedForm>
      </Card>
      {deleteDisclosure.isOpen && (
        <ConfirmDelete
          action={path.to.deleteShipment(initialValues.id)}
          isOpen={deleteDisclosure.isOpen}
          name={initialValues.shipmentId!}
          text={`Are you sure you want to delete ${initialValues.shipmentId!}? This cannot be undone.`}
          onCancel={() => {
            deleteDisclosure.onClose();
          }}
          onSubmit={() => {
            deleteDisclosure.onClose();
          }}
        />
      )}
    </>
  );
};

export default ShipmentForm;
