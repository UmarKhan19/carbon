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
import { LuCirclePlus } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, redirect, useLoaderData, useNavigate } from "react-router";
import { Empty } from "~/components";
import { useDateFormatter, usePermissions } from "~/hooks";
import { getPickingLists } from "~/modules/inventory";
import { PickingListStatus } from "~/modules/inventory/ui/PickingLists";
import { getJob } from "~/modules/production";
import { path, requestReferrer } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production"
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const [pickingLists, job, settings] = await Promise.all([
    getPickingLists(client, companyId, { jobId }),
    getJob(client, jobId),
    client.from("companySettings").select("*").eq("id", companyId).single()
  ]);

  if (pickingLists.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.job(jobId),
      await flash(
        request,
        error(pickingLists.error, "Failed to fetch picking lists for job")
      )
    );
  }

  if (job.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.job(jobId),
      await flash(request, error(job.error, "Failed to fetch job"))
    );
  }

  return {
    pickingLists: pickingLists.data ?? [],
    job: job.data,
    usePickingLists: settings.data?.usePickingLists ?? true
  };
}

export default function JobPickingListsRoute() {
  const { pickingLists, job, usePickingLists } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const jobMeta = job as {
    id?: string | null;
    locationId?: string | null;
    autoGeneratePickingList?: boolean | null;
    pickingStatus?: string | null;
  };

  const canManuallyCreate =
    usePickingLists &&
    permissions.can("create", "inventory") &&
    pickingLists.length === 0;

  const openCreatePickingList = () => {
    if (!jobMeta.id || !jobMeta.locationId) return;
    const params = new URLSearchParams({
      jobId: jobMeta.id,
      locationId: jobMeta.locationId,
      returnTo: path.to.jobPickingLists(jobMeta.id)
    });
    navigate(`${path.to.newPickingList}?${params.toString()}`);
  };

  return (
    <VStack spacing={4} className="p-4">
      <Card>
        <CardHeader>
          <HStack className="justify-between">
            <CardTitle>
              <Trans>Picking Lists</Trans>
              {pickingLists.length > 0 && (
                <span className="ml-2 text-muted-foreground font-normal text-sm">
                  {pickingLists.length}
                </span>
              )}
            </CardTitle>
            {canManuallyCreate && (
              <Button
                leftIcon={<LuCirclePlus />}
                onClick={openCreatePickingList}
              >
                <Trans>Create Picking List</Trans>
              </Button>
            )}
          </HStack>
        </CardHeader>
        <CardContent className="p-0">
          {pickingLists.length === 0 ? (
            <Empty className="py-6">
              <span className="text-xs text-muted-foreground">
                {t`No picking lists exist for this job yet.`}
              </span>
              {usePickingLists && canManuallyCreate && (
                <span className="mt-2 block text-xs text-muted-foreground">
                  {t`Use Create Picking List to open the drawer and generate one for this job.`}
                </span>
              )}
            </Empty>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">
                    <Trans>Picking List</Trans>
                  </th>
                  <th className="px-4 py-2 text-left">
                    <Trans>Status</Trans>
                  </th>
                  <th className="px-4 py-2 text-left">
                    <Trans>Location</Trans>
                  </th>
                  <th className="px-4 py-2 text-left">
                    <Trans>Assignee</Trans>
                  </th>
                  <th className="px-4 py-2 text-left">
                    <Trans>Due</Trans>
                  </th>
                  <th className="px-4 py-2 text-left">
                    <Trans>Confirmed</Trans>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pickingLists.map((pl: any) => (
                  <tr key={pl.id} className="border-t hover:bg-muted/20">
                    <td className="px-4 py-2">
                      <Link
                        to={path.to.pickingList(pl.id)}
                        className="text-primary hover:underline"
                      >
                        {pl.pickingListId}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <PickingListStatus status={pl.status} />
                    </td>
                    <td className="px-4 py-2">
                      {pl.location?.name ?? <Badge variant="outline">—</Badge>}
                    </td>
                    <td className="px-4 py-2">
                      {pl.assigneeUser?.fullName ?? (
                        <span className="text-muted-foreground">
                          <Trans>Unassigned</Trans>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {pl.dueDate ? formatDate(pl.dueDate) : "—"}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {pl.confirmedAt ? formatDate(pl.confirmedAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </VStack>
  );
}
