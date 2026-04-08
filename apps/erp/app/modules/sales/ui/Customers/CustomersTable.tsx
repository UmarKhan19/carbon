import {
  Badge,
  Button,
  HStack,
  MenuIcon,
  MenuItem,
  useDisclosure
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuEuro,
  LuGlobe,
  LuPencil,
  LuPhone,
  LuPrinter,
  LuShapes,
  LuStar,
  LuTag,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { Link, useNavigate } from "react-router";
import {
  CustomerAvatar,
  EmployeeAvatar,
  Hyperlink,
  New,
  Table
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useCustomerTypes } from "~/components/Form/CustomerType";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import type { Customer, CustomerStatus } from "../../types";

type CustomersTableProps = {
  data: Customer[];
  count: number;
  customerStatuses: CustomerStatus[];
  tags: { name: string }[];
};

const CustomersTable = memo(
  ({ data, count, customerStatuses, tags }: CustomersTableProps) => {
    const { t, i18n } = useLingui();
    const navigate = useNavigate();
    const permissions = usePermissions();
    const [people] = usePeople();
    const deleteModal = useDisclosure();
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(
      null
    );

    const translateStatus = useCallback(
      (value: string) => i18n._(value),
      [i18n]
    );

    const customerTypes = useCustomerTypes();

    const customColumns = useCustomColumns<Customer>("customer");
    const columns = useMemo<ColumnDef<Customer>[]>(() => {
      const defaultColumns: ColumnDef<Customer>[] = [
        {
          accessorKey: "name",
          header: t({ id: "Name", message: "Name" }),
          cell: ({ row }) => (
            <div className="max-w-[320px] truncate">
              <Hyperlink to={path.to.customerDetails(row.original.id!)}>
                <CustomerAvatar customerId={row.original.id!} />
              </Hyperlink>
            </div>
          ),
          meta: {
            icon: <LuBookMarked />
          }
        },
        {
          accessorKey: "status",
          header: t({ id: "Status", message: "Status" }),
          cell: (item) => (
            <Enumerable value={translateStatus(item.getValue<string>())} />
          ),
          meta: {
            filter: {
              type: "static",
              options: customerStatuses?.map((status) => ({
                value: status.name,
                label: <Enumerable value={translateStatus(status.name ?? "")} />
              }))
            },
            pluralHeader: t({ id: "Statuses", message: "Statuses" }),
            icon: <LuStar />
          }
        },
        {
          accessorKey: "customerTypeId",
          header: t({ id: "Type", message: "Type" }),
          cell: (item) => {
            if (!item.getValue<string>()) return null;
            const customerType = customerTypes?.find(
              (type) => type.value === item.getValue<string>()
            )?.label;
            return <Enumerable value={customerType ?? ""} />;
          },
          meta: {
            icon: <LuShapes />,
            filter: {
              type: "static",
              options: customerTypes?.map((type) => ({
                value: type.value,
                label: <Enumerable value={type.label} />
              }))
            }
          }
        },
        {
          id: "accountManagerId",
          header: t({ id: "Account Manager", message: "Account Manager" }),
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.accountManagerId} />
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
          accessorKey: "tags",
          header: t({ id: "Tags", message: "Tags" }),
          cell: ({ row }) => (
            <HStack spacing={0} className="gap-1">
              {row.original.tags?.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </HStack>
          ),
          meta: {
            filter: {
              type: "static",
              options: tags?.map((tag) => ({
                value: tag.name,
                label: <Badge variant="secondary">{tag.name}</Badge>
              })),
              isArray: true
            },
            icon: <LuTag />
          }
        },
        {
          accessorKey: "currencyCode",
          header: t({ id: "Currency", message: "Currency" }),
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuEuro />
          }
        },
        {
          accessorKey: "phone",
          header: t({ id: "Phone", message: "Phone" }),
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuPhone />
          }
        },
        {
          accessorKey: "fax",
          header: t({ id: "Fax", message: "Fax" }),
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuPrinter />
          }
        },
        {
          accessorKey: "website",
          header: t({ id: "Website", message: "Website" }),
          cell: (item) => item.getValue(),
          meta: {
            icon: <LuGlobe />
          }
        },
        {
          id: "createdBy",
          header: t({ id: "Created By", message: "Created By" }),
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
          accessorKey: "createdAt",
          header: t({ id: "Created At", message: "Created At" }),
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          id: "updatedBy",
          header: t({ id: "Updated By", message: "Updated By" }),
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
          header: t({ id: "Updated At", message: "Updated At" }),
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuCalendar />
          }
        }
      ];

      return [...defaultColumns, ...customColumns];
    }, [
      customerStatuses,
      customerTypes,
      people,
      customColumns,
      tags,
      t,
      translateStatus
    ]);

    const renderContextMenu = useMemo(
      () => (row: Customer) => (
        <>
          <MenuItem onClick={() => navigate(path.to.customer(row.id!))}>
            <MenuIcon icon={<LuPencil />} />
            {t({ id: "Edit", message: "Edit" })}
          </MenuItem>
          <MenuItem
            destructive
            disabled={!permissions.can("delete", "sales")}
            onClick={() => {
              setSelectedCustomer(row);
              deleteModal.onOpen();
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            {t({ id: "Delete Customer", message: "Delete Customer" })}
          </MenuItem>
        </>
      ),
      [navigate, deleteModal, permissions, t]
    );

    return (
      <>
        <Table<Customer>
          count={count}
          columns={columns}
          data={data}
          defaultColumnPinning={{
            left: ["name"]
          }}
          defaultColumnVisibility={{
            currencyCode: false,
            phone: false,
            fax: false,
            website: false,
            createdBy: false,
            createdAt: false,
            updatedBy: false,
            updatedAt: false
          }}
          importCSV={[
            {
              table: "customer",
              label: t({ id: "Customers", message: "Customers" })
            },
            {
              table: "customerContact",
              label: t({ id: "Contacts", message: "Contacts" })
            }
          ]}
          primaryAction={
            permissions.can("create", "sales") && (
              <div className="flex items-center gap-2">
                <Button
                  className="hidden md:inline-flex"
                  variant="secondary"
                  leftIcon={<LuShapes />}
                  asChild
                >
                  <Link to={path.to.customerTypes}>
                    {t({ id: "Customer Types", message: "Customer Types" })}
                  </Link>
                </Button>
                <New
                  label={t({ id: "Customer", message: "Customer" })}
                  to={path.to.newCustomer}
                />
              </div>
            )
          }
          renderContextMenu={renderContextMenu}
          table="customer"
          title={t({ id: "Customers", message: "Customers" })}
          withSavedView
        />
        {selectedCustomer && selectedCustomer.id && (
          <ConfirmDelete
            action={path.to.deleteCustomer(selectedCustomer.id)}
            isOpen={deleteModal.isOpen}
            name={selectedCustomer.name!}
            text={t({
              id: "Are you sure you want to delete {{name}}? This cannot be undone.",
              message: `Are you sure you want to delete ${selectedCustomer.name!}? This cannot be undone.`
            })}
            onCancel={() => {
              deleteModal.onClose();
              setSelectedCustomer(null);
            }}
            onSubmit={() => {
              deleteModal.onClose();
              setSelectedCustomer(null);
            }}
          />
        )}
      </>
    );
  }
);

CustomersTable.displayName = "CustomerTable";

export default CustomersTable;
