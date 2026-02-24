import { SelectControlled, ValidatedForm } from "@carbon/form";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  VStack
} from "@carbon/react";
import { useState } from "react";
import {
  LuBoxes,
  LuBuilding,
  LuContainer,
  LuMapPin,
  LuTags,
  LuUser,
  LuUsers
} from "react-icons/lu";
import type { z } from "zod";
// biome-ignore lint/suspicious/noShadowRestrictedNames: suppressed due to migration
import { Array, Hidden, Input, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  dimensionEntityTypes,
  dimensionValidator
} from "../../accounting.models";

type DimensionFormProps = {
  initialValues: z.infer<typeof dimensionValidator>;
  onClose: () => void;
};

const entityTypeIcons: Record<string, React.ReactNode> = {
  Custom: <LuTags className="w-4 h-4 text-purple-600 mr-2" />,
  Location: <LuMapPin className="w-4 h-4 text-blue-600 mr-2" />,
  ItemPostingGroup: <LuBoxes className="w-4 h-4 text-orange-600 mr-2" />,
  SupplierType: <LuContainer className="w-4 h-4 text-emerald-600 mr-2" />,
  CustomerType: <LuUsers className="w-4 h-4 text-yellow-600 mr-2" />,
  Department: <LuBuilding className="w-4 h-4 text-red-600 mr-2" />,
  Employee: <LuUser className="w-4 h-4 text-indigo-600 mr-2" />
};

const entityTypeLabels: Record<string, string> = {
  Custom: "Custom",
  Location: "Location",
  ItemPostingGroup: "Item Posting Group",
  SupplierType: "Supplier Type",
  CustomerType: "Customer Type",
  Department: "Department",
  Employee: "Employee"
};

const DimensionForm = ({ initialValues, onClose }: DimensionFormProps) => {
  const permissions = usePermissions();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "accounting")
    : !permissions.can("create", "accounting");

  const [entityType, setEntityType] = useState<string>(
    initialValues.entityType
  );
  const isCustom = entityType === "Custom";

  const entityTypeOptions = dimensionEntityTypes.map((et) => ({
    value: et,
    label: (
      <HStack className="w-full">
        {entityTypeIcons[et]}
        {entityTypeLabels[et]}
      </HStack>
    )
  }));

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={dimensionValidator}
          method="post"
          action={
            isEditing
              ? path.to.dimension(initialValues.id!)
              : path.to.newDimension
          }
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>{isEditing ? "Edit" : "New"} Dimension</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <VStack spacing={4}>
              <Input name="name" label="Name" />
              <SelectControlled
                name="entityType"
                label="Entity Type"
                isReadOnly={isEditing}
                helperText={
                  isEditing ? "Entity type cannot be changed" : undefined
                }
                options={entityTypeOptions}
                value={entityType}
                onChange={(option) => {
                  if (option) {
                    setEntityType(option.value);
                  }
                }}
              />
              {isCustom && <Array name="dimensionValues" label="Values" />}
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>Save</Submit>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default DimensionForm;
