import type { AvatarProps } from "@carbon/react";
import { cn, HStack } from "@carbon/react";
import { getFaviconUrl } from "@carbon/utils";
import { useSuppliers } from "~/stores";
import Avatar from "./Avatar";

type SupplierAvatarProps = AvatarProps & {
  supplierId: string | null;
  className?: string;
};

const SupplierAvatar = ({
  supplierId,
  size,
  className,
  ...props
}: SupplierAvatarProps) => {
  const [suppliers] = useSuppliers();

  if (!supplierId) return null;

  const supplier = suppliers.find((s) => s.id === supplierId) ?? {
    name: "",
    id: "",
    website: null,
    supplierStatus: null
  };

  const imageUrl = supplier.website
    ? getFaviconUrl(supplier.website)
    : undefined;
  const isInactive = supplier.supplierStatus === "Inactive";

  return (
    <HStack className="truncate ">
      <Avatar
        size={size ?? "xs"}
        {...props}
        name={supplier?.name ?? ""}
        imageUrl={imageUrl}
      />
      <span
        className={cn(
          className,
          isInactive && "text-red-600 dark:text-red-400"
        )}
      >
        {supplier.name}
      </span>
    </HStack>
  );
};

export default SupplierAvatar;
