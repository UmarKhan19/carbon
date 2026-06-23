import type { Database } from "@carbon/database";
import { MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuCalendar,
  LuCircleDot,
  LuCoins,
  LuEye,
  LuHash,
  LuPencil,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { useNavigate } from "react-router";
import {
  CustomerAvatar,
  Hyperlink,
  New,
  SupplierAvatar,
  Table
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { ConfirmDelete } from "~/components/Modals";
import {
  useCurrencyFormatter,
  useDateFormatter,
  usePermissions
} from "~/hooks";
import { path } from "~/utils/path";
import PaymentStatus from "./PaymentStatus";

type PaymentRow = Database["public"]["Tables"]["payment"]["Row"];

type PaymentsTableProps = {
  data: PaymentRow[];
  count: number;
};

const PaymentsTable = memo(({ data, count }: PaymentsTableProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const currencyFormatter = useCurrencyFormatter();
  const { formatDate } = useDateFormatter();
  const deleteModal = useDisclosure();
  const [selectedPayment, setSelectedPayment] = useState<PaymentRow | null>(
    null
  );

  const renderContextMenu = useCallback(
    (row: PaymentRow) => (
      <>
        <MenuItem onClick={() => navigate(path.to.payment(row.id))}>
          <MenuIcon icon={row.status === "Draft" ? <LuPencil /> : <LuEye />} />
          {row.status === "Draft" ? (
            <Trans>Edit Payment</Trans>
          ) : (
            <Trans>View Payment</Trans>
          )}
        </MenuItem>
        <MenuItem
          destructive
          disabled={
            row.status !== "Draft" || !permissions.can("delete", "invoicing")
          }
          onClick={() => {
            setSelectedPayment(row);
            deleteModal.onOpen();
          }}
        >
          <MenuIcon icon={<LuTrash />} />
          <Trans>Delete Payment</Trans>
        </MenuItem>
      </>
    ),
    [navigate, permissions, deleteModal]
  );

  const columns = useMemo<ColumnDef<PaymentRow>[]>(
    () => [
      {
        accessorKey: "paymentId",
        header: t`Payment ID`,
        cell: ({ row }) => (
          <Hyperlink to={path.to.payment(row.original.id)}>
            {row.original.paymentId}
          </Hyperlink>
        ),
        meta: { icon: <LuHash /> }
      },
      {
        accessorKey: "paymentType",
        header: t`Type`,
        cell: ({ row }) => <Enumerable value={row.original.paymentType} />,
        meta: { icon: <LuCircleDot /> }
      },
      {
        id: "counterparty",
        header: t`Counterparty`,
        cell: ({ row }) =>
          row.original.customerId ? (
            <CustomerAvatar customerId={row.original.customerId} />
          ) : row.original.supplierId ? (
            <SupplierAvatar supplierId={row.original.supplierId} />
          ) : null,
        meta: { icon: <LuUser /> }
      },
      {
        accessorKey: "paymentDate",
        header: t`Payment Date`,
        cell: (item) => formatDate(item.getValue<string>()),
        meta: { icon: <LuCalendar /> }
      },
      {
        accessorKey: "totalAmount",
        header: t`Total`,
        cell: (item) => (
          <span className="tabular-nums">
            {currencyFormatter.format(item.getValue<number>())}
          </span>
        ),
        meta: {
          icon: <LuCoins />,
          renderTotal: true,
          formatter: currencyFormatter.format
        }
      },
      {
        accessorKey: "currencyCode",
        header: t`Currency`,
        cell: ({ row }) => <Enumerable value={row.original.currencyCode} />
      },
      {
        accessorKey: "status",
        header: t`Status`,
        cell: ({ row }) => <PaymentStatus status={row.original.status} />,
        meta: { icon: <LuCircleDot /> }
      },
      {
        accessorKey: "reference",
        header: t`Reference`,
        cell: ({ row }) => row.original.reference ?? null
      }
    ],
    [t, formatDate, currencyFormatter]
  );

  return (
    <>
      <Table<PaymentRow>
        count={count}
        columns={columns}
        data={data}
        defaultColumnPinning={{ left: ["paymentId"] }}
        defaultColumnVisibility={{
          reference: false
        }}
        primaryAction={
          permissions.can("create", "invoicing") && (
            <New label={t`Payment`} to={path.to.paymentNew} />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Payments`}
        table="payment"
        withSavedView
      />
      {selectedPayment && (
        <ConfirmDelete
          action={path.to.paymentDelete(selectedPayment.id)}
          isOpen={deleteModal.isOpen}
          name={selectedPayment.paymentId}
          text={t`Are you sure you want to delete ${selectedPayment.paymentId}? This cannot be undone.`}
          onCancel={() => {
            deleteModal.onClose();
            setSelectedPayment(null);
          }}
          onSubmit={() => {
            deleteModal.onClose();
            setSelectedPayment(null);
          }}
        />
      )}
    </>
  );
});

PaymentsTable.displayName = "PaymentsTable";

export default PaymentsTable;
