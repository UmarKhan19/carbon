import { CONTROLLED_ENVIRONMENT } from "@carbon/auth";
import { useEdition } from "@carbon/remix";
import { Edition } from "@carbon/utils";
import { useUser } from "./useUser";

export function useFlags() {
  const user = useUser();
  const edition = useEdition();
<<<<<<< naveen/email-tier-updates
  const isInternal = ["@carbon.us.org", "@carbon.ms"].some((domain) =>
    user.email.toLowerCase().trim().endsWith(domain)
=======
  const isInternal = ["@carbon.us.org", "@carbon.ms"].some(
    (domain) => user.email.toLowerCase().trim().endsWith(domain)
>>>>>>> main
  );

  return {
    isInternal,
    isCloud: edition === Edition.Cloud,
    isCommunity: edition === Edition.Community,
    isEnterprise: edition === Edition.Enterprise,
    isControlledEnvironment: CONTROLLED_ENVIRONMENT
  };
}
