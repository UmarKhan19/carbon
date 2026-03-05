import type { Database } from "@carbon/database";
import { formatCityStatePostalCode } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";

type CounterParty = {
  name: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  stateProvince: string | null;
  postalCode: string | null;
  countryName: string | null;
  taxId?: string | null;
  vatNumber?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
};

type PartyDetailsProps = {
  company: Database["public"]["Views"]["companies"]["Row"];
  companyLabel: string;
  counterParty: CounterParty;
  counterPartyLabel: string;
  createdByFullName?: string | null;
  createdByEmail?: string | null;
  accountsPayableEmail?: string | null;
};

const tw = createTw({
  theme: {
    fontFamily: {
      sans: ["Inter", "Helvetica", "Arial", "sans-serif"]
    },
    extend: {
      colors: {
        gray: {
          50: "#f9fafb",
          200: "#e5e7eb",
          400: "#9ca3af",
          600: "#4b5563",
          800: "#1f2937"
        }
      }
    }
  }
});

const PartyDetails = ({
  company,
  companyLabel,
  counterParty,
  counterPartyLabel,
  createdByFullName,
  createdByEmail,
  accountsPayableEmail
}: PartyDetailsProps) => {
  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("flex flex-row")}>
        {/* Buyer / Company */}
        <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            {companyLabel}
          </Text>
          <View style={tw("text-[10px] text-gray-800")}>
            {company.name && (
              <Text style={tw("font-bold")}>{company.name}</Text>
            )}
            {company.addressLine1 && <Text>{company.addressLine1}</Text>}
            {company.addressLine2 && <Text>{company.addressLine2}</Text>}
            {(company.city || company.stateProvince || company.postalCode) && (
              <Text>
                {formatCityStatePostalCode(
                  company.city,
                  company.stateProvince,
                  company.postalCode
                )}
              </Text>
            )}
            {company.countryName && <Text>{company.countryName}</Text>}
            {company.taxId && <Text>Tax ID: {company.taxId}</Text>}
            {company.vatNumber && <Text>VAT Number: {company.vatNumber}</Text>}
            {(createdByFullName || createdByEmail) && (
              <Text>
                Contact: {createdByFullName}
                {createdByEmail ? ` (${createdByEmail})` : ""}
              </Text>
            )}
            {accountsPayableEmail && (
              <Text>Accounts Payable: {accountsPayableEmail}</Text>
            )}
          </View>
        </View>

        {/* Counter Party (Supplier) */}
        <View style={tw("w-1/2 p-3")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            {counterPartyLabel}
          </Text>
          <View style={tw("text-[10px] text-gray-800")}>
            {counterParty.name && (
              <Text style={tw("font-bold")}>{counterParty.name}</Text>
            )}
            {counterParty.addressLine1 && (
              <Text>{counterParty.addressLine1}</Text>
            )}
            {counterParty.addressLine2 && (
              <Text>{counterParty.addressLine2}</Text>
            )}
            {(counterParty.city ||
              counterParty.stateProvince ||
              counterParty.postalCode) && (
              <Text>
                {formatCityStatePostalCode(
                  counterParty.city,
                  counterParty.stateProvince,
                  counterParty.postalCode
                )}
              </Text>
            )}
            {counterParty.countryName && (
              <Text>{counterParty.countryName}</Text>
            )}
            {counterParty.taxId && (
              <Text>Company No: {counterParty.taxId}</Text>
            )}
            {counterParty.vatNumber && (
              <Text>VAT No: {counterParty.vatNumber}</Text>
            )}
            {(counterParty.contactName || counterParty.contactEmail) && (
              <Text>
                Contact: {counterParty.contactName}
                {counterParty.contactEmail
                  ? ` (${counterParty.contactEmail})`
                  : ""}
              </Text>
            )}
          </View>
        </View>
      </View>
    </View>
  );
};

export { PartyDetails };
