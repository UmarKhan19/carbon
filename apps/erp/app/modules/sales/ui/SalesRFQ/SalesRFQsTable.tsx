import { HStack, MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuMap,
  LuPencil,
  LuQrCode,
  LuSquareUser,
  LuStar,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { useNavigate } from "react-router";
import {
  CustomerAvatar,
  EmployeeAvatar,
  Hyperlink,
  New,
  Table
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { useCustomers, usePeople } from "~/stores";
import { path } from "~/utils/path";
import { salesRFQStatusType } from "../../sales.models";
import type { SalesRFQ } from "../../types";
import { SalesRFQStatus } from ".";

type SalesRFQsTableProps = {
  data: SalesRFQ[];
  count: number;
};

const SalesRFQsTable = memo(({ data, count }: SalesRFQsTableProps) => {
  const { _: t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();

  const [selectedSalesRFQ, setSelectedSalesRFQ] = useState<SalesRFQ | null>(
    null
  );
  const deleteSalesRFQModal = useDisclosure();

  const [customers] = useCustomers();
  const [people] = usePeople();

  const customColumns = useCustomColumns<SalesRFQ>("salesRFQ");
  const columns = useMemo<ColumnDef<SalesRFQ>[]>(() => {
    const defaultColumns: ColumnDef<SalesRFQ>[] = [
      {
        accessorKey: "rfqId",
        header: "RFQ Number",
        cell: ({ row }) => (
          <HStack>
            <Hyperlink to={path.to.salesRfqDetails(row.original.id!)}>
              {row.original.rfqId}
            </Hyperlink>
          </HStack>
        ),
        meta: {
          icon: <LuBookMarked />
        }
      },

      {
        id: "customerId",
        header: t(msg({ id: "Customer", message: "Customer" })),
        cell: ({ row }) => (
          <CustomerAvatar customerId={row.original.customerId} />
        ),
        meta: {
          filter: {
            type: "static",
            options: customers?.map((customer) => ({
              value: customer.id,
              label: customer.name
            }))
          },
          icon: <LuSquareUser />
        }
      },
      {
        accessorKey: "status",
        header: t(msg({ id: "Status", message: "Status" })),
        cell: (item) => {
          const status = item.getValue<(typeof salesRFQStatusType)[number]>();
          return <SalesRFQStatus status={status} />;
        },
        meta: {
          filter: {
            type: "static",
            options: salesRFQStatusType.map((status) => ({
              value: status,
              label: <SalesRFQStatus status={status} />
            }))
          },
          pluralHeader: t(msg({ id: "Statuses", message: "Statuses" })),
          icon: <LuStar />
        }
      },
      {
        accessorKey: "customerReference",
        header: "Customer RFQ",
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuQrCode />
        }
      },
      {
        accessorKey: "rfqDate",
        header: "RFQ Date",
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        accessorKey: "expirationDate",
        header: "Due Date",
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      },

      {
        id: "assignee",
        header: t(msg({ id: "Assignee", message: "Assignee" })),
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.assignee} />
        ),
        meta: {
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name
            }))
          },
          icon: <LuUser />
        }
      },
      {
        id: "createdBy",
        header: t(msg({ id: "Created By", message: "Created By" })),
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.createdBy} />
        ),
        meta: {
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name
            }))
          },
          icon: <LuUser />
        }
      },
      {
        accessorKey: "locationName",
        header: t(msg({ id: "Location", message: "Location" })),
        cell: (item) => <Enumerable value={item.getValue<string>()} />,
        meta: {
          filter: {
            type: "fetcher",
            endpoint: path.to.api.locations,
            transform: (data: { id: string; name: string }[] | null) =>
              data?.map(({ name }) => ({
                value: name,
                label: <Enumerable value={name} />
              })) ?? []
          },
          icon: <LuMap />
        }
      },
      {
        accessorKey: "createdAt",
        header: "Created At",
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        id: "updatedBy",
        header: t(msg({ id: "Updated By", message: "Updated By" })),
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.updatedBy} />
        ),
        meta: {
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name
            }))
          },
          icon: <LuUser />
        }
      },
      {
        accessorKey: "updatedAt",
        header: "Updated At",
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      }
    ];

    return [...defaultColumns, ...customColumns];
  }, [customers, people, customColumns, t]);

  const renderContextMenu = useMemo(() => {
    return (row: SalesRFQ) => (
      <>
        <MenuItem onClick={() => navigate(path.to.salesRfqDetails(row.id!))}>
          <MenuIcon icon={<LuPencil />} />
          Edit
        </MenuItem>
        <MenuItem
          destructive
          disabled={!permissions.can("delete", "sales")}
          onClick={() => {
            setSelectedSalesRFQ(row);
            deleteSalesRFQModal.onOpen();
          }}
        >
          <MenuIcon icon={<LuTrash />} />
          Delete
        </MenuItem>
      </>
    );
  }, [deleteSalesRFQModal, navigate, permissions]);

  return (
    <>
      <Table<SalesRFQ>
        count={count}
        columns={columns}
        data={data}
        defaultColumnPinning={{
          left: ["rfqId"]
        }}
        defaultColumnVisibility={{
          createdAt: false,
          updatedAt: false,
          updatedBy: false
        }}
        primaryAction={
          permissions.can("create", "sales") && (
            <New label="RFQ" to={path.to.newSalesRFQ} />
          )
        }
        renderContextMenu={renderContextMenu}
        title="RFQs"
        table="salesRfq"
        withSavedView
      />
      {selectedSalesRFQ && selectedSalesRFQ.id && (
        <ConfirmDelete
          action={path.to.deleteSalesRfq(selectedSalesRFQ.id)}
          isOpen={deleteSalesRFQModal.isOpen}
          name={selectedSalesRFQ.rfqId!}
          text={`Are you sure you want to delete ${selectedSalesRFQ.rfqId!}? This cannot be undone.`}
          onCancel={() => {
            deleteSalesRFQModal.onClose();
            setSelectedSalesRFQ(null);
          }}
          onSubmit={() => {
            deleteSalesRFQModal.onClose();
            setSelectedSalesRFQ(null);
          }}
        />
      )}
    </>
  );
});

SalesRFQsTable.displayName = "SalesRFQsTable";

export default SalesRFQsTable;
