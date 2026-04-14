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
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { LuEllipsisVertical, LuPencil, LuTrash } from "react-icons/lu";
import { useNavigate } from "react-router";
import { New } from "~/components";
import Grid from "~/components/Grid";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";

type CustomerTypePriceBreakSummary = {
  customerTypeId: string;
  customerTypeName: string;
  breakCount: number;
};

type CustomerTypePriceBreaksProps = {
  data: CustomerTypePriceBreakSummary[];
  itemId: string;
};

const CustomerTypePriceBreaks = ({
  data,
  itemId
}: CustomerTypePriceBreaksProps) => {
  const navigate = useNavigate();
  const { t } = useLingui();
  const permissions = usePermissions();
  const canEdit = permissions.can("update", "parts");
  const canDelete = permissions.can("delete", "parts");

  const columns = useMemo<ColumnDef<CustomerTypePriceBreakSummary>[]>(
    () => [
      {
        accessorKey: "customerTypeName",
        header: t`Customer Type`,
        cell: ({ row }) => (
          <HStack className="justify-between min-w-[100px]">
            <span>{row.original.customerTypeName}</span>
            <div className="relative w-6 h-5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    aria-label={t`Price break actions`}
                    icon={<LuEllipsisVertical />}
                    size="md"
                    className="absolute right-[-1px] top-[-6px]"
                    variant="ghost"
                    onClick={(e) => e.stopPropagation()}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onClick={() =>
                      navigate(
                        path.to.partSalePriceBreaks(
                          itemId,
                          row.original.customerTypeId
                        )
                      )
                    }
                    disabled={!canEdit}
                  >
                    <DropdownMenuIcon icon={<LuPencil />} />
                    <Trans>Edit Price Breaks</Trans>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      navigate(
                        path.to.deleteCustomerTypePriceBreaks(
                          itemId,
                          row.original.customerTypeId
                        )
                      )
                    }
                    destructive
                    disabled={!canDelete}
                  >
                    <DropdownMenuIcon icon={<LuTrash />} />
                    <Trans>Delete Price Breaks</Trans>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </HStack>
        )
      },
      {
        accessorKey: "breakCount",
        header: t`Price Breaks`,
        cell: ({ row }) => row.original.breakCount
      }
    ],
    [canDelete, canEdit, itemId, navigate, t]
  );

  return (
    <Card className="w-full">
      <HStack className="justify-between items-start">
        <CardHeader>
          <CardTitle>
            <Trans>Customer Type Price Breaks</Trans>
          </CardTitle>
        </CardHeader>
        <CardAction>
          {canEdit && <New to={path.to.newCustomerTypePriceBreak(itemId)} />}
        </CardAction>
      </HStack>
      <CardContent>
        <Grid<CustomerTypePriceBreakSummary>
          data={data}
          columns={columns}
          canEdit={canEdit}
          onNewRow={
            canEdit
              ? () => navigate(path.to.newCustomerTypePriceBreak(itemId))
              : undefined
          }
        />
      </CardContent>
    </Card>
  );
};

export default CustomerTypePriceBreaks;
