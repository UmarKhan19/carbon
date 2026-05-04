import { Badge, Button, Heading, IconButton, Status } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { LuPlus, LuShieldCheck, LuTrash } from "react-icons/lu";
import { Form, Link, useFetcher } from "react-router";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";

type AssignedRule = {
  ruleId: string;
  rule: {
    id: string;
    name: string;
    severity: "error" | "warn";
    message: string;
    active: boolean;
  };
};

type LibraryRule = {
  id: string;
  name: string;
  severity: "error" | "warn";
  active: boolean;
};

type ItemRuleAssignmentsProps = {
  itemId: string;
  assignments: AssignedRule[];
  library: LibraryRule[];
};

export default function ItemRuleAssignments({
  itemId,
  assignments,
  library
}: ItemRuleAssignmentsProps) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher();

  const assignedSet = useMemo(
    () => new Set(assignments.map((a) => a.ruleId)),
    [assignments]
  );

  const available = useMemo(
    () => library.filter((r) => r.active && !assignedSet.has(r.id)),
    [library, assignedSet]
  );

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Heading size="h4">
          <Trans>Rules</Trans>
        </Heading>
        <div className="flex items-center gap-2">
          {available.length > 0 && permissions.can("create", "parts") && (
            <fetcher.Form method="post" action={path.to.itemRuleAssign(itemId)}>
              <select
                name="ruleId"
                className="text-sm border border-border rounded-md px-2 py-1.5 bg-background"
                onChange={(e) => {
                  if (e.target.value) {
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                defaultValue=""
              >
                <option value="" disabled>
                  {t`Add rule…`}
                </option>
                {available.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </fetcher.Form>
          )}
          <Button
            as={Link}
            to={path.to.newItemRule}
            variant="secondary"
            size="sm"
            leftIcon={<LuPlus />}
          >
            <Trans>Create new rule</Trans>
          </Button>
        </div>
      </div>

      {assignments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
          <LuShieldCheck className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            <Trans>No rules assigned to this item</Trans>
          </p>
          <p className="text-xs text-muted-foreground max-w-sm">
            <Trans>
              Add a rule from the library or create a new one to enforce
              constraints on receipts, shipments, transfers, and jobs.
            </Trans>
          </p>
        </div>
      ) : (
        <div className="border border-border rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-3 py-2 font-medium">
                  <Trans>Name</Trans>
                </th>
                <th className="text-left px-3 py-2 font-medium">
                  <Trans>Severity</Trans>
                </th>
                <th className="text-left px-3 py-2 font-medium">
                  <Trans>Message</Trans>
                </th>
                <th className="text-left px-3 py-2 font-medium">
                  <Trans>Status</Trans>
                </th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={a.ruleId} className="border-t border-border">
                  <td className="px-3 py-2">
                    <Link
                      to={path.to.itemRule(a.ruleId)}
                      className="hover:underline"
                    >
                      {a.rule.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {a.rule.severity === "error" ? (
                      <Badge variant="destructive">
                        <Trans>Error</Trans>
                      </Badge>
                    ) : (
                      <Badge variant="outline">
                        <Trans>Warn</Trans>
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground truncate max-w-[400px]">
                    {a.rule.message}
                  </td>
                  <td className="px-3 py-2">
                    {a.rule.active ? (
                      <Status color="green">
                        <Trans>Active</Trans>
                      </Status>
                    ) : (
                      <Status color="gray">
                        <Trans>Inactive</Trans>
                      </Status>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Form
                      method="post"
                      action={path.to.itemRuleUnassign(itemId, a.ruleId)}
                    >
                      <IconButton
                        type="submit"
                        icon={<LuTrash />}
                        aria-label={t`Unassign rule`}
                        variant="ghost"
                        size="sm"
                        isDisabled={!permissions.can("delete", "parts")}
                      />
                    </Form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
