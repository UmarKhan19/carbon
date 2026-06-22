import { useMemo } from "react";
import { useUser } from "~/hooks";
import type { UnmatchedEntity } from "~/modules/documents/autofill";
import {
  SupplierContactForm,
  SupplierForm,
  SupplierLocationForm
} from "~/modules/purchasing/ui/Supplier";
import CustomerContactForm from "~/modules/sales/ui/Customer/CustomerContactForm";
import CustomerForm from "~/modules/sales/ui/Customer/CustomerForm";
import CustomerLocationForm from "~/modules/sales/ui/Customer/CustomerLocationForm";
import { useCountries } from "./Country";

/**
 * Renders the right "create" form for an unmatched autofill entity, prefilled
 * from the extracted values, as a modal. `onClose` fires when the form closes
 * (save or cancel); the caller then refreshes options and re-matches.
 *
 * This is the single home for the extracted-country-name → ISO-code mapping that
 * previously lived (duplicated) in SupplierLocation and CustomerLocation.
 */
export function CreateEntityForm({
  entity,
  onClose
}: {
  entity: UnmatchedEntity;
  onClose: () => void;
}) {
  const { company } = useUser();
  const countries = useCountries();
  const p = entity.prefill;
  const s = (k: string): string =>
    typeof p[k] === "string" ? (p[k] as string) : "";

  const countryCode = useMemo(() => {
    const raw = s("countryCode");
    if (!raw) return "";
    if (raw.length === 2) return raw.toUpperCase();
    const match = countries.find(
      (c) =>
        c.label.toLowerCase().includes(raw.toLowerCase()) ||
        raw.toLowerCase().includes(c.label.toLowerCase())
    );
    return match ? match.value : raw;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.countryCode, countries]);

  const locationValues = {
    name: s("addressLine1") || s("city") || "Location",
    addressLine1: s("addressLine1"),
    addressLine2: s("addressLine2"),
    city: s("city"),
    stateProvince: s("stateProvince"),
    postalCode: s("postalCode"),
    countryCode
  };

  switch (entity.kind) {
    case "supplier":
      return (
        <SupplierForm
          type="modal"
          onClose={onClose}
          initialValues={{
            name: s("name"),
            currencyCode: s("currencyCode") || company.baseCurrencyCode
          }}
        />
      );
    case "customer":
      return (
        <CustomerForm
          type="modal"
          onClose={onClose}
          initialValues={{
            name: s("name"),
            currencyCode: company.baseCurrencyCode,
            taxPercent: 0
          }}
        />
      );
    case "supplierContact":
      return (
        <SupplierContactForm
          type="modal"
          supplierId={entity.parentId!}
          onClose={onClose}
          initialValues={{
            firstName: s("firstName"),
            lastName: s("lastName"),
            title: s("title"),
            email: s("email"),
            mobilePhone: s("mobilePhone")
          }}
        />
      );
    case "customerContact":
      return (
        <CustomerContactForm
          type="modal"
          customerId={entity.parentId!}
          onClose={onClose}
          initialValues={{
            firstName: s("firstName"),
            lastName: s("lastName"),
            email: s("email"),
            mobilePhone: s("mobilePhone")
          }}
        />
      );
    case "supplierLocation":
      return (
        <SupplierLocationForm
          type="modal"
          supplierId={entity.parentId!}
          onClose={onClose}
          initialValues={locationValues}
        />
      );
    case "customerLocation":
      return (
        <CustomerLocationForm
          type="modal"
          customerId={entity.parentId!}
          onClose={onClose}
          initialValues={locationValues}
        />
      );
  }
}
