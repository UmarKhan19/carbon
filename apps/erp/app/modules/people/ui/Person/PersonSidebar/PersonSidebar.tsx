import { DetailSidebar } from "~/components/Layout";
import type { PublicAttributes } from "~/modules/account";
import { usePersonSidebar } from "./usePersonSidebar";

type PersonSidebarProps = {
  attributeCategories: PublicAttributes[];
  timeClockEnabled?: boolean;
};

const PersonSidebar = ({
  attributeCategories,
  timeClockEnabled
}: PersonSidebarProps) => {
  const links = usePersonSidebar(attributeCategories, timeClockEnabled);

  return <DetailSidebar links={links} />;
};

export default PersonSidebar;
