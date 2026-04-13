import { CarbonEdition, DOMAIN } from "@carbon/auth";
import { Edition } from "@carbon/utils";
import * as cookie from "cookie";
import { getCookieDomain } from "../utils/cookie";

const cookieName = "companyId";
const isTestEdition = CarbonEdition === Edition.Test;
const cookieDomain = isTestEdition ? undefined : getCookieDomain(DOMAIN);

export function setCompanyId(companyId: string | null) {
  if (!companyId) {
    return cookie.serialize(cookieName, "", {
      path: "/",
      expires: new Date(0),
      domain: cookieDomain
    });
  }

  return cookie.serialize(cookieName, companyId, {
    path: "/",
    maxAge: 31536000, // 1 year
    domain: cookieDomain
  });
}
