import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton
} from "@carbon/react";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { LuEllipsisVertical, LuTrash } from "react-icons/lu";
import { Link, useNavigate } from "react-router";
import { New } from "~/components";
import Grid from "~/components/Grid";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import type { PriceListAssignment } from "../../types";

type PriceListAssignmentsTableProps = {
  data: PriceListAssignment[];
  priceListId: string;
  priceListType: string;
};

const PriceListAssignmentsTable = ({
  data,
  priceListId,
  priceListType
}: PriceListAssignmentsTableProps) => {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const [params] = useUrlParams();

  const permissionModule =
    priceListType === "Purchase" ? "purchasing" : "sales";
  const canCreate = permissions.can("create", permissionModule);
  const canDelete = permissions.can("delete", permissionModule);

  const columns = useMemo<ColumnDef<PriceListAssignment>[]>(
    () => [
      {
        id: "assignee",
        header: "Assigned To",
        cell: ({ row }) => {
          const r = row.original as any;
          let label: string;
          let link: string | null = null;
          if (r.customer) {
            label = `Customer: ${r.customer.name}`;
            link = path.to.customer(r.customerId);
          } else if (r.customerType) {
            label = `Customer Type: ${r.customerType.name}`;
          } else if (r.supplier) {
            label = `Supplier: ${r.supplier.name}`;
            link = path.to.supplier(r.supplierId);
          } else if (r.supplierType) {
            label = `Supplier Type: ${r.supplierType.name}`;
          } else {
            label = "—";
          }

          return (
            <HStack className="justify-between min-w-[100px]">
              {link ? (
                <Link
                  to={link}
                  className="text-primary hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {label}
                </Link>
              ) : (
                <span>{label}</span>
              )}
              <div className="relative w-6 h-5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      aria-label="Assignment actions"
                      icon={<LuEllipsisVertical />}
                      size="md"
                      className="absolute right-[-1px] top-[-6px]"
                      variant="ghost"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem
                      destructive
                      disabled={!canDelete}
                      onClick={() =>
                        navigate(
                          `${path.to.priceListAssignments(priceListId)}/delete/${row.original.id}?${params.toString()}`
                        )
                      }
                    >
                      <DropdownMenuIcon icon={<LuTrash />} />
                      Remove Assignment
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </HStack>
          );
        }
      },
      {
        id: "type",
        header: "Assignment Type",
        cell: ({ row }) => {
          if (row.original.customerId) return "Customer";
          if (row.original.customerTypeId) return "Customer Type";
          if (row.original.supplierId) return "Supplier";
          if (row.original.supplierTypeId) return "Supplier Type";
          return "—";
        }
      }
    ],
    [canDelete, navigate, priceListId, params]
  );

  return (
    <>
      <Card className="w-full">
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>Assignments</CardTitle>
          </CardHeader>
          <CardAction>
            {canCreate && (
              <New
                label="Assignment"
                to={`${path.to.priceListAssignments(priceListId)}/new?${params.toString()}`}
              />
            )}
          </CardAction>
        </HStack>
        <CardContent>
          <Grid<PriceListAssignment>
            data={data}
            columns={columns}
            canEdit={false}
            onNewRow={
              canCreate
                ? () =>
                    navigate(
                      `${path.to.priceListAssignments(priceListId)}/new?${params.toString()}`
                    )
                : undefined
            }
          />
        </CardContent>
      </Card>
    </>
  );
};

export default PriceListAssignmentsTable;
