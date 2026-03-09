import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardAttribute,
  CardAttributeLabel,
  CardAttributes,
  CardAttributeValue,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  useDisclosure,
  VStack
} from "@carbon/react";
import { useCallback } from "react";
import { LuEllipsisVertical, LuTrash } from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { z } from "zod";
import { EmployeeAvatar } from "~/components";
import { useAuditLog } from "~/components/AuditLog";
import { Enumerable } from "~/components/Enumerable";
import { Tags } from "~/components/Form";
import { useSupplierTypes } from "~/components/Form/SupplierType";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import type { SupplierDetail } from "~/modules/purchasing";
import { SupplierStatusIndicator } from "~/modules/purchasing/ui/Supplier/SupplierStatusIndicator";
import type { action } from "~/routes/x+/settings+/tags";
import { path } from "~/utils/path";

const SupplierHeader = () => {
  const { supplierId } = useParams();

  if (!supplierId) throw new Error("Could not find supplierId");
  const fetcher = useFetcher<typeof action>();
  const permissions = usePermissions();
  const { company } = useUser();
  const deleteModal = useDisclosure();
  const routeData = useRouteData<{
    supplier: SupplierDetail;
    tags: { name: string }[];
  }>(path.to.supplier(supplierId));

  const { trigger: auditLogTrigger, drawer: auditLogDrawer } = useAuditLog({
    entityType: "supplier",
    entityId: supplierId,
    companyId: company.id,
    variant: "dropdown"
  });

  const supplierTypes = useSupplierTypes();
  const supplierType = supplierTypes?.find(
    (type) => type.value === routeData?.supplier?.supplierTypeId
  )?.label;

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdateTags = useCallback(
    (value: string[]) => {
      const formData = new FormData();

      formData.append("ids", supplierId);
      formData.append("table", "supplier");

      value.forEach((v) => {
        formData.append("value", v);
      });

      fetcher.submit(formData, {
        method: "post",
        action: path.to.tags
      });
    },

    [supplierId]
  );

  return (
    <>
      <VStack>
        <Card>
          <HStack className="justify-between items-start">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span>{routeData?.supplier?.name}</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      aria-label="More options"
                      icon={<LuEllipsisVertical />}
                      variant="secondary"
                      size="sm"
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {auditLogTrigger}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={!permissions.can("delete", "purchasing")}
                      destructive
                      onClick={deleteModal.onOpen}
                    >
                      <DropdownMenuIcon icon={<LuTrash />} />
                      Delete Supplier
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardTitle>
            </CardHeader>
          </HStack>
          <CardContent>
            <CardAttributes>
              <CardAttribute>
                <CardAttributeLabel>Status</CardAttributeLabel>
                <CardAttributeValue>
                  {routeData?.supplier?.status ? (
                    <SupplierStatusIndicator
                      status={routeData.supplier.status as "Active"}
                    />
                  ) : (
                    "-"
                  )}
                </CardAttributeValue>
              </CardAttribute>
              <CardAttribute>
                <CardAttributeLabel>Type</CardAttributeLabel>
                <CardAttributeValue>
                  {supplierType ? <Enumerable value={supplierType!} /> : "-"}
                </CardAttributeValue>
              </CardAttribute>
              <CardAttribute>
                <CardAttributeLabel>Account Manager</CardAttributeLabel>
                <CardAttributeValue>
                  {routeData?.supplier?.accountManagerId ? (
                    <EmployeeAvatar
                      employeeId={routeData?.supplier?.accountManagerId ?? null}
                    />
                  ) : (
                    "-"
                  )}
                </CardAttributeValue>
              </CardAttribute>
              <CardAttribute>
                <CardAttributeValue>
                  <ValidatedForm
                    defaultValues={{
                      tags: routeData?.supplier?.tags ?? []
                    }}
                    validator={z.object({
                      tags: z.array(z.string()).optional()
                    })}
                    className="w-full"
                  >
                    <Tags
                      label="Tags"
                      name="tags"
                      availableTags={routeData?.tags ?? []}
                      table="supplier"
                      inline
                      onChange={onUpdateTags}
                    />
                  </ValidatedForm>
                </CardAttributeValue>
              </CardAttribute>
            </CardAttributes>
          </CardContent>
        </Card>
      </VStack>
      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.deleteSupplier(supplierId)}
          isOpen={deleteModal.isOpen}
          name={routeData?.supplier?.name!}
          text={`Are you sure you want to delete ${routeData?.supplier?.name!}? This cannot be undone.`}
          onCancel={deleteModal.onClose}
          onSubmit={deleteModal.onClose}
        />
      )}
      {auditLogDrawer}
    </>
  );
};

export default SupplierHeader;
