import { requirePermissions } from "@carbon/auth/auth.server";
import type { MiddlewareFunction } from "react-router";
import { redirect } from "react-router";
import { userContext } from "~/context";
import { getConsolePinIn } from "~/services/console.server";
import { getLocation, setLocation } from "~/services/location.server";
import { path } from "~/utils/path";

export const userMiddleware: MiddlewareFunction = async ({
  context,
  request
}) => {
  const { client, companyId, userId, consoleMode } = await requirePermissions(
    request,
    {}
  );
  const { location, updated } = await getLocation(request, client, {
    companyId,
    userId
  });

  // Read pin-in state from cookies (console mode comes from auth session)
  const pinIn = consoleMode ? getConsolePinIn(request, companyId) : null;

  context.set(userContext, {
    locationId: location,
    companyId,
    consoleMode,
    effectiveUserId: pinIn?.userId ?? userId,
    pinnedInUser: pinIn
      ? { userId: pinIn.userId, name: pinIn.name, avatarUrl: pinIn.avatarUrl }
      : null
  });

  if (updated) {
    return redirect(path.to.authenticatedRoot, {
      headers: {
        "Set-Cookie": setLocation(companyId, location)
      }
    });
  }
};
