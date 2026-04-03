import { CarbonEdition, DOMAIN } from "@carbon/auth";
import { Edition } from "@carbon/utils";
import * as cookie from "cookie";

const cookieName = "companyId";
const isTestEdition = CarbonEdition === Edition.Test;

export function setCompanyId(companyId: string | null) {
  if (!companyId) {
    return cookie.serialize(cookieName, "", {
      path: "/",
      expires: new Date(0),
      domain: isTestEdition ? undefined : DOMAIN
    });
  }

  return cookie.serialize(cookieName, companyId, {
    path: "/",
    maxAge: 31536000, // 1 year
    domain: isTestEdition ? undefined : DOMAIN
  });
}
