import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Payments" }];
};

export const handle: Handle = {
  breadcrumb: "Payments",
  to: path.to.payments,
  module: "invoicing"
};

export default function PaymentRoute() {
  return <Outlet />;
}
