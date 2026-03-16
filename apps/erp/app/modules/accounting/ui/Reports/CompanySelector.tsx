import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@carbon/react";
import { useUrlParams } from "~/hooks";

type Company = {
  id: string;
  name: string;
};

type CompanySelectorProps = {
  companies: Company[];
  selectedCompanyId: string | null;
};

const CompanySelector = ({
  companies,
  selectedCompanyId
}: CompanySelectorProps) => {
  const [, setParams] = useUrlParams();

  if (companies.length <= 1) return null;

  return (
    <Select
      value={selectedCompanyId ?? "all"}
      onValueChange={(value) =>
        setParams({ companyId: value === "all" ? undefined : value })
      }
    >
      <SelectTrigger className="w-[200px]" size="sm">
        <SelectValue placeholder="All Companies" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Companies</SelectItem>
        {companies.map((company) => (
          <SelectItem key={company.id} value={company.id}>
            {company.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export default CompanySelector;
