import type { CreatableComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { Avatar, HStack, useDisclosure } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type {
  getSupplierContacts,
  SupplierContact as SupplierContactType
} from "~/modules/purchasing";
import { SupplierContactForm } from "~/modules/purchasing/ui/Supplier";
import { path } from "~/utils/path";

type SupplierContactSelectProps = Omit<
  CreatableComboboxProps,
  "options" | "onChange" | "inline"
> & {
  supplier?: string;
  onChange?: (
    supplier: { id: string; contact: SupplierContactType["contact"] } | null
  ) => void;
  inline?: boolean;
  extractedValue?: string;
  extractedEmail?: string;
  extractedPhone?: string;
};

const SupplierContactPreview = (
  value: string,
  options: { value: string; label: string | JSX.Element }[]
) => {
  const contact = options.find((o) => o.value === value);
  if (!contact) return null;
  return (
    <HStack>
      <Avatar
        size="xs"
        name={typeof contact.label === "string" ? contact.label : undefined}
      />
      <span>{contact.label}</span>
    </HStack>
  );
};

const SupplierContact = ({
  extractedValue,
  extractedEmail,
  extractedPhone,
  onChange: propsOnChange,
  inline,
  supplier,
  ...props
}: SupplierContactSelectProps) => {
  const { t } = useLingui();
  const supplierContactsFetcher =
    useFetcher<Awaited<ReturnType<typeof getSupplierContacts>>>();

  const newContactModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const [firstName, ...lastName] = created ? created.split(" ") : [];
  const initialFirstName =
    firstName || (extractedValue ? extractedValue.split(" ")[0] : "");
  const initialLastName =
    lastName && lastName.length > 0
      ? lastName.join(" ")
      : extractedValue
        ? extractedValue.split(" ").slice(1).join(" ")
        : "";

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (supplier) {
      supplierContactsFetcher.load(path.to.api.supplierContacts(supplier));
    }
  }, [supplier]);

  const options = useMemo(
    () =>
      supplierContactsFetcher.data?.data?.map((c) => ({
        value: c.id,
        label: c.contact?.fullName ?? c.contact?.email ?? "Unknown"
      })) ?? [],

    [supplierContactsFetcher.data]
  );

  const onChange = (
    newValue: { label: string | JSX.Element; value: string } | null
  ) => {
    const contact =
      supplierContactsFetcher.data?.data?.find(
        (contact) => contact.id === newValue?.value
      ) ?? null;

    propsOnChange?.(contact ?? null);
  };

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        extractedValue={extractedValue}
        placeholder={t`Select Contact`}
        inline={inline ? SupplierContactPreview : undefined}
        label={props?.label ?? t`Supplier Contact`}
        onChange={onChange}
        onCreateOption={(option) => {
          newContactModal.onOpen();
          setCreated(option);
        }}
      />
      {newContactModal.isOpen && (
        <SupplierContactForm
          supplierId={supplier!}
          type="modal"
          onClose={() => {
            setCreated("");
            newContactModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            email: extractedEmail ?? "",
            firstName: initialFirstName,
            lastName: initialLastName,
            mobilePhone: extractedPhone ?? ""
          }}
        />
      )}
    </>
  );
};

export default SupplierContact;
