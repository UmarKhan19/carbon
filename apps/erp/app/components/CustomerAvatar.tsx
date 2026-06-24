import type { AvatarProps } from "@carbon/react";
import { cn, HStack } from "@carbon/react";
import { getFaviconUrl, isUrl } from "@carbon/utils";
import { useCustomers, useInactiveCustomerStatusId } from "~/stores";
import Avatar from "./Avatar";

type CustomerAvatarProps = AvatarProps & {
  customerId: string | null;
  className?: string;
};

const CustomerAvatar = ({
  customerId,
  size,
  className,
  ...props
}: CustomerAvatarProps) => {
  const [customers] = useCustomers();
  const [inactiveStatusId] = useInactiveCustomerStatusId();

  if (!customerId) return null;

  const customer = customers.find((s) => s.id === customerId) ?? {
    name: "",
    id: "",
    website: null,
    customerStatusId: null
  };

  const imageUrl =
    customer.website && isUrl(customer.website)
      ? getFaviconUrl(customer.website)
      : undefined;
  const isInactive =
    !!inactiveStatusId && customer.customerStatusId === inactiveStatusId;

  return (
    <HStack className="truncate no-underline hover:no-underline">
      <Avatar
        size={size ?? "xs"}
        {...props}
        name={customer?.name ?? ""}
        imageUrl={imageUrl}
      />
      <span
        className={cn(
          className,
          isInactive && "text-red-600 dark:text-red-400"
        )}
      >
        {customer.name}
      </span>
    </HStack>
  );
};

export default CustomerAvatar;
