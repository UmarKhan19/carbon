import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCirclePlus, LuTriangleAlert } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import {
  Link,
  Outlet,
  redirect,
  useLoaderData,
  useNavigate,
  useParams
} from "react-router";
import { Empty } from "~/components";
import { useDateFormatter, usePermissions } from "~/hooks";
import { getProductionIncidents } from "~/modules/production";
import { path, requestReferrer } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "production"
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const incidents = await getProductionIncidents(client, jobId);
  if (incidents.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.job(jobId),
      await flash(request, error(incidents.error, "Failed to fetch incidents"))
    );
  }

  return { incidents: incidents.data ?? [] };
}

export default function JobIncidentsRoute() {
  const { incidents } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const { jobId } = useParams();
  if (!jobId) throw new Error("jobId required");

  const canCreate = permissions.can("create", "production");

  return (
    <>
      <VStack spacing={4} className="p-4">
        <Card>
          <CardHeader>
            <HStack className="justify-between">
              <CardTitle>
                <Trans>Production Incidents</Trans>
                {incidents.length > 0 && (
                  <span className="ml-2 text-muted-foreground font-normal text-sm">
                    {incidents.length}
                  </span>
                )}
              </CardTitle>
              {canCreate && (
                <Button
                  leftIcon={<LuCirclePlus />}
                  onClick={() => navigate(path.to.newJobIncident(jobId))}
                >
                  <Trans>Report Incident</Trans>
                </Button>
              )}
            </HStack>
          </CardHeader>
          <CardContent className="p-0">
            {incidents.length === 0 ? (
              <Empty className="py-6">
                <span className="text-xs text-muted-foreground">
                  {t`No incidents reported on this job yet.`}
                </span>
              </Empty>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left">
                      <Trans>Incident</Trans>
                    </th>
                    <th className="px-4 py-2 text-left">
                      <Trans>Date</Trans>
                    </th>
                    <th className="px-4 py-2 text-left">
                      <Trans>Type</Trans>
                    </th>
                    <th className="px-4 py-2 text-left">
                      <Trans>Item</Trans>
                    </th>
                    <th className="px-4 py-2 text-right">
                      <Trans>Qty Lost</Trans>
                    </th>
                    <th className="px-4 py-2 text-left">
                      <Trans>Status</Trans>
                    </th>
                    <th className="px-4 py-2 text-left">
                      <Trans>Affects PL</Trans>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map((inc: any) => (
                    <tr key={inc.id} className="border-t hover:bg-muted/20">
                      <td className="px-4 py-2">
                        <Link
                          to={path.to.jobIncident(jobId, inc.id)}
                          className="text-primary hover:underline"
                        >
                          {inc.incidentId ?? inc.id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {inc.incidentDate ? formatDate(inc.incidentDate) : "—"}
                      </td>
                      <td className="px-4 py-2">
                        {inc.incidentType?.name ?? "—"}
                      </td>
                      <td className="px-4 py-2">
                        {inc.item?.readableId ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {inc.quantityLost > 0 ? (
                          <Badge
                            variant="outline"
                            className="text-orange-600 border-orange-300"
                          >
                            <LuTriangleAlert className="h-3 w-3 mr-1" />
                            {inc.quantityLost}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant="outline">{inc.status}</Badge>
                      </td>
                      <td className="px-4 py-2">
                        {inc.impactsPickingList ? (
                          <Badge
                            variant="outline"
                            className="text-amber-600 border-amber-300"
                          >
                            <Trans>Yes</Trans>
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </VStack>
      <Outlet />
    </>
  );
}
