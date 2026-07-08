import type { Database } from "@carbon/database";
import { Status } from "@carbon/react";

type ChangeOrderStatusProps = {
  status?: Database["public"]["Enums"]["changeOrderStatus"] | null;
};

const ChangeOrderStatus = ({ status }: ChangeOrderStatusProps) => {
  switch (status) {
    case "Draft":
      return <Status color="gray">{status}</Status>;
    case "In Review":
      return <Status color="blue">{status}</Status>;
    case "Approved":
      return <Status color="yellow">{status}</Status>;
    case "Released":
      return <Status color="green">{status}</Status>;
    case "Cancelled":
      return <Status color="red">{status}</Status>;
    default:
      return null;
  }
};

export default ChangeOrderStatus;
