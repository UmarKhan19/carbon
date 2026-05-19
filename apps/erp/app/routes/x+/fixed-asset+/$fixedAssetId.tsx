import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { JSONContent } from "@carbon/react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  useDisclosure
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import {
  LuChevronDown,
  LuCircleX,
  LuClipboardCheck,
  LuPencil,
  LuShoppingCart,
  LuStore,
  LuTrash
} from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import {
  Link,
  Outlet,
  redirect,
  useLoaderData,
  useNavigate,
  useParams
} from "react-router";
import { DocumentHeader } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import {
  getAssetDepreciationHistory,
  getFixedAsset,
  getFixedAssetDisposal
} from "~/modules/accounting";
import {
  FixedAssetNotes,
  FixedAssetStatus
} from "~/modules/accounting/ui/FixedAssets";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Fixed Assets",
  to: path.to.fixedAssets
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting"
  });

  const { fixedAssetId } = params;
  if (!fixedAssetId) throw new Error("Could not find fixedAssetId");

  const [asset, depreciationHistory, disposal] = await Promise.all([
    getFixedAsset(client, fixedAssetId),
    getAssetDepreciationHistory(client, fixedAssetId),
    getFixedAssetDisposal(client, fixedAssetId)
  ]);

  if (asset.error) {
    throw redirect(
      path.to.fixedAssets,
      await flash(request, error(asset.error, "Failed to load fixed asset"))
    );
  }

  return {
    asset: asset.data,
    depreciationHistory: depreciationHistory.data ?? [],
    disposal: disposal.data
  };
}

export default function FixedAssetDetailRoute() {
  const { fixedAssetId } = useParams();
  const { asset, depreciationHistory, disposal } =
    useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const { company } = useUser();
  const currencyFormatter = useCurrencyFormatter({
    currency: company.baseCurrencyCode
  });
  const deleteModal = useDisclosure();

  if (!fixedAssetId) throw new Error("Could not find fixedAssetId");

  const acquisitionCost = Number(asset.acquisitionCost);
  const accumulatedDepreciation = Number(asset.accumulatedDepreciation);
  const nbv = acquisitionCost - accumulatedDepreciation;
  const depreciationPercent =
    acquisitionCost > 0
      ? Math.min(100, (accumulatedDepreciation / acquisitionCost) * 100)
      : 0;

  const isDraft = asset.status === "Draft";
  const isActive =
    asset.status === "Active" || asset.status === "Fully Depreciated";
  const isDisposed = asset.status === "Disposed";
  const canUpdate = permissions.can("update", "accounting");

  return (
    <div className="flex h-[calc(100dvh-49px)] overflow-y-auto scrollbar-hide w-full">
      <div className="h-full p-4 w-full max-w-5xl mx-auto space-y-4">
        {/* Main Details */}
        <Card>
          <DocumentHeader
            title={asset.fixedAssetId ?? ""}
            status={<FixedAssetStatus status={asset.status as any} />}
            menuItems={
              <DropdownMenuItem
                disabled={!permissions.can("delete", "accounting")}
                destructive
                onClick={deleteModal.onOpen}
              >
                <DropdownMenuIcon icon={<LuTrash />} />
                Delete
              </DropdownMenuItem>
            }
            actions={
              <>
                <Button
                  variant="secondary"
                  size="md"
                  leftIcon={<LuPencil />}
                  asChild
                >
                  <Link to={path.to.fixedAssetDetails(fixedAssetId)}>Edit</Link>
                </Button>
                {!isDisposed && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="primary"
                        size="md"
                        rightIcon={<LuChevronDown />}
                      >
                        Actions
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {isDraft && (
                        <>
                          <DropdownMenuItem disabled={!canUpdate} asChild>
                            <Link to={path.to.fixedAssetRegister(fixedAssetId)}>
                              <DropdownMenuIcon icon={<LuClipboardCheck />} />
                              Register
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link to={path.to.fixedAssetPurchase(fixedAssetId)}>
                              <DropdownMenuIcon icon={<LuShoppingCart />} />
                              Purchase
                            </Link>
                          </DropdownMenuItem>
                        </>
                      )}
                      {isActive && (
                        <>
                          <DropdownMenuItem asChild>
                            <Link to={path.to.fixedAssetSell(fixedAssetId)}>
                              <DropdownMenuIcon icon={<LuStore />} />
                              Sell
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem disabled={!canUpdate} asChild>
                            <Link to={path.to.fixedAssetDispose(fixedAssetId)}>
                              <DropdownMenuIcon icon={<LuCircleX />} />
                              Dispose
                            </Link>
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </>
            }
          />
          <CardContent>
            <div className="divide-y divide-border">
              <DetailRow label="Name">{asset.name}</DetailRow>
              <DetailRow label="Asset Class">
                <Enumerable
                  value={(asset.fixedAssetClass as any)?.name ?? null}
                />
              </DetailRow>
              <DetailRow label="Serial Number">
                {asset.serialNumber || "—"}
              </DetailRow>
              <DetailRow label="Location">
                <Enumerable value={(asset as any).location?.name ?? null} />
              </DetailRow>
              <DetailRow label="Depreciation Method">
                {asset.depreciationMethod}
              </DetailRow>
              <DetailRow label="Useful Life">
                {asset.usefulLifeMonths} months
              </DetailRow>
              <DetailRow label="Residual Value">
                {Number(asset.residualValuePercent)}%
              </DetailRow>
              <DetailRow label="Acquisition Date">
                {asset.acquisitionDate
                  ? formatDate(asset.acquisitionDate)
                  : "—"}
              </DetailRow>
              <DetailRow label="Depreciation Start">
                {asset.depreciationStartDate
                  ? formatDate(asset.depreciationStartDate)
                  : "—"}
              </DetailRow>
            </div>
          </CardContent>
        </Card>

        {/* Financial Summary */}
        <div className="grid grid-cols-3 gap-px rounded-lg border border-border bg-border overflow-hidden">
          <div className="bg-card p-4 space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Acquisition Cost
            </p>
            <p className="text-2xl font-semibold tabular-nums tracking-tight">
              {currencyFormatter.format(acquisitionCost)}
            </p>
          </div>
          <div className="bg-card p-4 space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Accumulated Depreciation
            </p>
            <p className="text-2xl font-semibold tabular-nums tracking-tight">
              {currencyFormatter.format(accumulatedDepreciation)}
            </p>
          </div>
          <div className="bg-card p-4 space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Net Book Value
            </p>
            <p className="text-2xl font-semibold tabular-nums tracking-tight">
              {currencyFormatter.format(nbv)}
            </p>
          </div>
        </div>

        {/* Depreciation Progress */}
        {acquisitionCost > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Depreciation Progress</span>
              <span className="tabular-nums">
                {depreciationPercent.toFixed(1)}%
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-foreground transition-all duration-500"
                style={{ width: `${depreciationPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Notes */}
        <FixedAssetNotes
          key={`notes-${fixedAssetId}`}
          id={fixedAssetId}
          notes={asset.notes as JSONContent}
        />

        {/* Disposal */}
        {disposal && (
          <Card>
            <CardContent className="pt-6">
              <div className="divide-y divide-border">
                <DetailRow label="Disposal Method">
                  {disposal.disposalMethod}
                </DetailRow>
                <DetailRow label="Disposal Date">
                  {formatDate(disposal.disposalDate)}
                </DetailRow>
                <DetailRow label="NBV at Disposal">
                  <span className="tabular-nums">
                    {currencyFormatter.format(
                      Number(disposal.netBookValueAtDisposal)
                    )}
                  </span>
                </DetailRow>
                <DetailRow label="Sale Proceeds">
                  <span className="tabular-nums">
                    {currencyFormatter.format(Number(disposal.saleProceeds))}
                  </span>
                </DetailRow>
                <DetailRow label="Gain/Loss">
                  <Badge
                    variant={Number(disposal.gainLoss) >= 0 ? "green" : "red"}
                  >
                    {currencyFormatter.format(Number(disposal.gainLoss))}
                  </Badge>
                </DetailRow>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Depreciation History */}
        {depreciationHistory.length > 0 && (
          <Card>
            <CardContent className="pt-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 font-medium text-muted-foreground">
                      Run
                    </th>
                    <th className="text-left py-2 font-medium text-muted-foreground">
                      Period End
                    </th>
                    <th className="text-left py-2 font-medium text-muted-foreground">
                      Status
                    </th>
                    <th className="text-right py-2 font-medium text-muted-foreground">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {depreciationHistory.map((item) => {
                    const run = item.depreciationRun as any;
                    return (
                      <tr
                        key={item.id}
                        className="border-b border-border last:border-0"
                      >
                        <td className="py-2.5 tabular-nums">
                          {run?.depreciationRunId ?? "—"}
                        </td>
                        <td className="py-2.5">
                          {run?.periodEnd ? formatDate(run.periodEnd) : "—"}
                        </td>
                        <td className="py-2.5">{run?.status ?? "—"}</td>
                        <td className="py-2.5 text-right tabular-nums">
                          {currencyFormatter.format(Number(item.amount))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        <Outlet />

        <ConfirmDelete
          action={path.to.deleteFixedAsset(fixedAssetId)}
          isOpen={deleteModal.isOpen}
          name={asset.fixedAssetId}
          text={`Are you sure you want to delete ${asset.fixedAssetId}? This cannot be undone.`}
          onCancel={deleteModal.onClose}
          onSubmit={() => {
            deleteModal.onClose();
            navigate(path.to.fixedAssets);
          }}
        />
      </div>
    </div>
  );
}

function DetailRow({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{children}</span>
    </div>
  );
}
