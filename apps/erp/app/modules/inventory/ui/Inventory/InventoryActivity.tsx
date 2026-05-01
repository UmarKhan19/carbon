import { LuArrowRightLeft, LuCircleMinus, LuCirclePlus } from "react-icons/lu";
import { Hyperlink } from "~/components";
import Activity from "~/components/Activity";
import { path } from "~/utils/path";
import type { ItemLedger } from "../../types";

const getActivityText = (ledgerRecord: ItemLedger) => {
  switch (ledgerRecord.documentType) {
    case "Purchase Receipt":
      return `received ${ledgerRecord.quantity} units${
        ledgerRecord.storageUnit?.name
          ? ` to ${ledgerRecord.storageUnit.name}`
          : ""
      }${
        ledgerRecord.trackedEntityId
          ? ` from ${
              Math.abs(ledgerRecord.quantity) > 1 ? "batch" : "serial"
            } ${ledgerRecord.trackedEntityId}`
          : ""
      }`;
    case "Purchase Invoice":
      return `invoiced ${ledgerRecord.quantity} units${
        ledgerRecord.storageUnit?.name
          ? ` on ${ledgerRecord.storageUnit.name}`
          : ""
      }`;
    case "Sales Shipment":
      return `shipped ${-1 * ledgerRecord.quantity} units${
        ledgerRecord.storageUnit?.name
          ? ` from ${ledgerRecord.storageUnit.name}`
          : ""
      }${
        ledgerRecord.trackedEntityId
          ? ` of ${Math.abs(ledgerRecord.quantity) > 1 ? "batch" : "serial"} ${
              ledgerRecord.trackedEntityId
            }`
          : ""
      }`;
    case "Sales Invoice":
      return `invoiced ${ledgerRecord.quantity} units for sale${
        ledgerRecord.storageUnit?.name
          ? ` from ${ledgerRecord.storageUnit.name}`
          : ""
      }`;
    case "Transfer Shipment":
      return `shipped ${-1 * ledgerRecord.quantity} units${
        ledgerRecord.storageUnit?.name
          ? ` from ${ledgerRecord.storageUnit.name}`
          : ""
      } for transfer`;
    case "Transfer Receipt":
      return `received ${ledgerRecord.quantity} units${
        ledgerRecord.storageUnit?.name
          ? ` to ${ledgerRecord.storageUnit.name}`
          : ""
      } from transfer`;
    case "Direct Transfer":
      return `transferred ${Math.abs(ledgerRecord.quantity)} units${
        ledgerRecord.storageUnit?.name
          ? ` ${ledgerRecord.quantity > 0 ? "to" : "from"} ${
              ledgerRecord.storageUnit.name
            }`
          : ""
      }`;
    case "Inventory Receipt":
      return `received ${ledgerRecord.quantity} units into inventory${
        ledgerRecord.storageUnit?.name
          ? ` on ${ledgerRecord.storageUnit.name}`
          : ""
      }`;
    case "Inventory Shipment":
      return `shipped ${-1 * ledgerRecord.quantity} units from inventory${
        ledgerRecord.storageUnit?.name
          ? ` from ${ledgerRecord.storageUnit.name}`
          : ""
      }`;
    case "Posted Assembly":
      return `assembled ${ledgerRecord.quantity} units${
        ledgerRecord.storageUnit?.name
          ? ` on ${ledgerRecord.storageUnit.name}`
          : ""
      }`;
    case "Purchase Credit Memo":
      return `credited ${ledgerRecord.quantity} units for purchase${
        ledgerRecord.storageUnit?.name
          ? ` on ${ledgerRecord.storageUnit.name}`
          : ""
      }`;
    case "Purchase Return Shipment":
      return `returned ${ledgerRecord.quantity} units to supplier${
        ledgerRecord.storageUnit?.name
          ? ` from ${ledgerRecord.storageUnit.name}`
          : ""
      }`;
    case "Sales Credit Memo":
      return `credited ${ledgerRecord.quantity} units for sale${
        ledgerRecord.storageUnit?.name
          ? ` on ${ledgerRecord.storageUnit.name}`
          : ""
      }`;
    case "Sales Return Receipt":
      return `received ${ledgerRecord.quantity} units as sales return${
        ledgerRecord.storageUnit?.name
          ? ` to ${ledgerRecord.storageUnit.name}`
          : ""
      }`;
    case "Service Credit Memo":
      return `credited ${ledgerRecord.quantity} units for service${
        ledgerRecord.storageUnit?.name
          ? ` on ${ledgerRecord.storageUnit.name}`
          : ""
      }`;
    case "Service Invoice":
      return `invoiced ${ledgerRecord.quantity} units for service${
        ledgerRecord.storageUnit?.name
          ? ` from ${ledgerRecord.storageUnit.name}`
          : ""
      }`;
    case "Service Shipment":
      return `shipped ${-1 * ledgerRecord.quantity} units for service${
        ledgerRecord.storageUnit?.name
          ? ` from ${ledgerRecord.storageUnit.name}`
          : ""
      }`;
    case "Job Consumption":
      return (
        <span>
          issued {-1 * ledgerRecord.quantity} units{" "}
          {ledgerRecord.storageUnit?.name
            ? `from ${ledgerRecord.storageUnit.name} `
            : ""}
          {ledgerRecord.trackedEntityId ? (
            <>
              from {Math.abs(ledgerRecord.quantity) > 1 ? "batch" : "serial"}{" "}
              {ledgerRecord.trackedEntityId}{" "}
            </>
          ) : null}
          {ledgerRecord.documentLineId && ledgerRecord.documentId ? (
            <>
              to a{" "}
              <Hyperlink
                className="inline-flex"
                to={`${path.to.jobProductionEvents(
                  ledgerRecord.documentId!
                )}?filter=jobOperationId:eq:${ledgerRecord.documentLineId}`}
              >
                job operation
              </Hyperlink>
            </>
          ) : ledgerRecord.documentId ? (
            <>
              to a{" "}
              <Hyperlink
                className="inline-flex"
                to={path.to.jobDetails(ledgerRecord.documentId!)}
              >
                job
              </Hyperlink>
            </>
          ) : null}
        </span>
      );
    case "Maintenance Consumption":
      return (
        <span>
          issued {-1 * ledgerRecord.quantity} units{" "}
          {ledgerRecord.storageUnit?.name
            ? `from ${ledgerRecord.storageUnit.name} `
            : ""}
          {ledgerRecord.trackedEntityId ? (
            <>
              from {Math.abs(ledgerRecord.quantity) > 1 ? "batch" : "serial"}{" "}
              {ledgerRecord.trackedEntityId}{" "}
            </>
          ) : null}
          {ledgerRecord.documentId ? (
            <>
              to a{" "}
              <Hyperlink
                className="inline-flex"
                to={path.to.maintenanceDispatch(ledgerRecord.documentId!)}
              >
                maintenance dispatch
              </Hyperlink>
            </>
          ) : null}
        </span>
      );
    case "Job Receipt":
      return (
        <>
          <span>
            received {ledgerRecord.quantity} units
            {ledgerRecord.storageUnit?.name
              ? ` to ${ledgerRecord.storageUnit.name}`
              : ""}{" "}
            from a
          </span>{" "}
          <Hyperlink
            className="inline-flex"
            to={path.to.jobDetails(ledgerRecord.documentId!)}
          >
            job
          </Hyperlink>
        </>
      );
    default:
      break;
  }

  switch (ledgerRecord.entryType) {
    case "Positive Adjmt.":
      return `made a positive adjustment of ${ledgerRecord.quantity}${
        ledgerRecord.storageUnit?.name
          ? ` to ${ledgerRecord.storageUnit?.name}`
          : ""
      }${
        ledgerRecord.trackedEntityId
          ? ` for ${Math.abs(ledgerRecord.quantity) > 1 ? "batch" : "serial"} ${
              ledgerRecord.trackedEntityId
            }`
          : ""
      }`;
    case "Negative Adjmt.":
      return `made a negative adjustment of ${-1 * ledgerRecord.quantity}${
        ledgerRecord.storageUnit?.name
          ? ` to ${ledgerRecord.storageUnit.name}`
          : ""
      }${
        ledgerRecord.trackedEntityId
          ? ` for ${Math.abs(ledgerRecord.quantity) > 1 ? "batch" : "serial"} ${
              ledgerRecord.trackedEntityId
            }`
          : ""
      }`;
    default:
      return "";
  }
};

const getActivityIcon = (ledgerRecord: ItemLedger) => {
  switch (ledgerRecord.entryType) {
    case "Transfer":
      return <LuArrowRightLeft className="text-blue-500 w-5 h-5" />;
    case "Positive Adjmt.":
      return <LuCirclePlus className="text-emerald-500 w-5 h-5" />;
    case "Negative Adjmt.":
    case "Consumption":
      return <LuCircleMinus className="text-red-500 w-5 h-5" />;
    default:
      return "";
  }
};

type InventoryActivityProps = {
  item: ItemLedger;
};

const InventoryActivity = ({ item }: InventoryActivityProps) => {
  return (
    <Activity
      employeeId={item.createdBy}
      activityMessage={getActivityText(item)}
      activityTime={item.createdAt}
      activityIcon={getActivityIcon(item)}
      comment={item.comment}
    />
  );
};

export default InventoryActivity;
