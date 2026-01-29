import { CarbonProvider, getCarbon } from "@carbon/auth";
import { setCompanyId } from "@carbon/auth/company.server";
import {
  destroyAuthSession,
  requireAuthSession,
  updateCompanySession
} from "@carbon/auth/session.server";
import { TooltipProvider, useMount } from "@carbon/react";
import { useNProgress } from "@carbon/remix";
import posthog from "posthog-js";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { Outlet, redirect, useLoaderData, useNavigate } from "react-router";
import { Sidebar } from "~/components/Layout/Sidebar";
import { Topbar } from "~/components/Layout/Topbar";
import { getCompanies } from "~/modules/settings";
import {
  getUser,
  getUserClaims,
  getUserGroups
} from "~/modules/users/users.server";
import { path } from "~/utils/path";

export const shouldRevalidate: ShouldRevalidateFunction = ({
  currentUrl,
  defaultShouldRevalidate
}) => {
  if (currentUrl.pathname.startsWith("/x/settings")) {
    return true;
  }

  return defaultShouldRevalidate;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { accessToken, companyId, expiresAt, expiresIn, userId } =
    await requireAuthSession(request, { verify: true });

  const client = getCarbon(accessToken);

  const [companies, user, claims, groups] = await Promise.all([
    getCompanies(client, userId),
    getUser(client, userId),
    getUserClaims(userId, companyId),
    getUserGroups(client, userId)
  ]);

  if (!claims || user.error || !user.data || !groups.data) {
    await destroyAuthSession(request);
  }

  let company = companies.data?.find((c) => c.companyId === companyId);

  if (!company && companies.data?.length) {
    company = companies.data[0];
    const sessionCookie = await updateCompanySession(request, company.id!);
    const companyIdCookie = setCompanyId(company.id!);
    throw redirect(path.to.authenticatedRoot, {
      headers: [
        ["Set-Cookie", sessionCookie],
        ["Set-Cookie", companyIdCookie]
      ]
    });
  }

  return {
    session: {
      accessToken,
      expiresIn,
      expiresAt
    },
    company,
    companies: companies.data ?? [],
    groups: groups.data,
    permissions: claims?.permissions,
    role: claims?.role,
    user: user.data
  };
}

export default function AuthenticatedRoute() {
  const { session, user } = useLoaderData<typeof loader>();
  const _navigate = useNavigate();

  useNProgress();

  useMount(() => {
    if (!user) return;

    posthog.identify(user.id, {
      email: user.email,
      name: `${user.firstName} ${user.lastName}`
    });
  });

  return (
    <CarbonProvider session={session}>
      <TooltipProvider>
        <div className="flex flex-col h-screen">
          <Topbar />
          <div className="flex flex-1 h-[calc(100vh-49px)] relative">
            <Sidebar />
            <main className="flex-1 overflow-y-auto scrollbar-hide border-l border-t bg-muted sm:rounded-tl-2xl relative z-10">
              <Outlet />
            </main>
          </div>
        </div>
      </TooltipProvider>
    </CarbonProvider>
  );
}
