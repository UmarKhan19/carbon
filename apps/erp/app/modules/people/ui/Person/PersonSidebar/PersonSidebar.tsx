import { DetailSidebar } from "~/components/Layout";
import type { PublicAttributes } from "~/modules/account";
import { usePersonSidebar } from "./usePersonSidebar";

type PersonSidebarProps = {
  attributeCategories: PublicAttributes[];
  timeCardEnabled?: boolean;
};

const PersonSidebar = ({
  attributeCategories,
  timeCardEnabled
}: PersonSidebarProps) => {
  const links = usePersonSidebar(attributeCategories, timeCardEnabled);

  return <DetailSidebar links={links} />;
};

export default PersonSidebar;
