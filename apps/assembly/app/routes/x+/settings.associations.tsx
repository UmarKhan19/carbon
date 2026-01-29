import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Button,
  Card,
  Heading,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  Tbody,
  Td,
  Thead,
  Th,
  Tr,
  Text,
  Textarea
} from "@carbon/react";
import { useState } from "react";
import { BsArrowLeft, BsPencil, BsPlus, BsTrash } from "react-icons/bs";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData, useNavigation } from "react-router";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "assembly"
  });

  const { data: associations } = await client
    .from("assemblyPartAssociation")
    .select("*")
    .eq("companyId", companyId)
    .order("name", { ascending: true });

  return {
    associations: associations ?? []
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "assembly"
  });

  const formData = await request.formData();
  const action = formData.get("_action");

  if (action === "create") {
    const name = formData.get("name") as string;
    const matchPattern = formData.get("matchPattern") as string;
    const matchType = formData.get("matchType") as string;
    const defaultInstruction = formData.get("defaultInstruction") as string;
    const adhesive = formData.get("adhesive") as string;
    const lubricant = formData.get("lubricant") as string;

    if (!name || !matchPattern) {
      return redirect(
        path.to.settingsAssociations,
        await flash(request, error(null, "Name and match pattern are required"))
      );
    }

    const { error: createError } = await client
      .from("assemblyPartAssociation")
      .insert({
        companyId,
        name,
        matchPattern,
        matchType: matchType || "contains",
        defaultInstruction: defaultInstruction || null,
        adhesive: adhesive || null,
        lubricant: lubricant || null,
        source: "manual"
      });

    if (createError) {
      return redirect(
        path.to.settingsAssociations,
        await flash(request, error(createError, "Failed to create association"))
      );
    }

    return redirect(
      path.to.settingsAssociations,
      await flash(request, success("Association created"))
    );
  }

  if (action === "delete") {
    const id = formData.get("id") as string;

    const { error: deleteError } = await client
      .from("assemblyPartAssociation")
      .delete()
      .eq("id", id)
      .eq("companyId", companyId);

    if (deleteError) {
      return redirect(
        path.to.settingsAssociations,
        await flash(request, error(deleteError, "Failed to delete association"))
      );
    }

    return redirect(
      path.to.settingsAssociations,
      await flash(request, success("Association deleted"))
    );
  }

  return null;
}

export default function SettingsAssociationsRoute() {
  const { associations } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <a href={path.to.settings}>
                <BsArrowLeft className="w-4 h-4" />
              </a>
            </Button>
            <Heading size="h2">Part Associations</Heading>
          </div>
          <p className="text-muted-foreground mt-1 ml-10">
            Auto-apply tools and instructions based on part names (tribal
            knowledge capture)
          </p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <BsPlus className="w-4 h-4 mr-2" />
          Add Association
        </Button>
      </div>

      {/* Info Card */}
      <Card className="p-4 bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
        <p className="text-sm text-blue-700 dark:text-blue-300">
          <strong>How it works:</strong> When a part name matches the pattern,
          the associated instructions, tools, and specifications will be
          automatically suggested. This helps capture tribal knowledge and
          speeds up instruction creation.
        </p>
      </Card>

      {/* Add Form */}
      {showForm && (
        <Card className="p-6">
          <Heading size="h4" className="mb-4">
            Add New Association
          </Heading>
          <Form method="post" className="space-y-4">
            <input type="hidden" name="_action" value="create" />

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">Rule Name *</Label>
                <Input
                  id="name"
                  name="name"
                  placeholder="e.g., M8 Bolts"
                  required
                />
              </div>
              <div>
                <Label htmlFor="matchType">Match Type</Label>
                <Select name="matchType" defaultValue="contains">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contains">Contains</SelectItem>
                    <SelectItem value="exact">Exact Match</SelectItem>
                    <SelectItem value="startsWith">Starts With</SelectItem>
                    <SelectItem value="regex">Regex</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="matchPattern">Match Pattern *</Label>
              <Input
                id="matchPattern"
                name="matchPattern"
                placeholder="e.g., M8 or BOLT_M8"
                required
              />
              <p className="text-xs text-muted-foreground mt-1">
                Parts with names matching this pattern will receive the
                auto-suggestions
              </p>
            </div>

            <div>
              <Label htmlFor="defaultInstruction">Default Instruction</Label>
              <Textarea
                id="defaultInstruction"
                name="defaultInstruction"
                placeholder="e.g., Apply Loctite 242 to threads before installation"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="adhesive">Adhesive</Label>
                <Input
                  id="adhesive"
                  name="adhesive"
                  placeholder="e.g., Loctite 242"
                />
              </div>
              <div>
                <Label htmlFor="lubricant">Lubricant</Label>
                <Input
                  id="lubricant"
                  name="lubricant"
                  placeholder="e.g., Anti-seize compound"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={isSubmitting}>
                Add Association
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </Button>
            </div>
          </Form>
        </Card>
      )}

      {/* Table */}
      {associations.length === 0 ? (
        <Card className="p-12 text-center">
          <Heading size="h4">No associations yet</Heading>
          <p className="text-muted-foreground mt-2">
            Create rules to automatically apply instructions to matching parts.
          </p>
          <Button className="mt-4" onClick={() => setShowForm(true)}>
            <BsPlus className="w-4 h-4 mr-2" />
            Add First Association
          </Button>
        </Card>
      ) : (
        <Card>
          <Table>
            <Th>
              <Tr>
                <TableHead>Name</TableHead>
                <TableHead>Pattern</TableHead>
                <TableHead>Match Type</TableHead>
                <TableHead>Default Instruction</TableHead>
                <TableHead>Usage</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </Tr>
            </Th>
            <Tbody>
              {associations.map((assoc) => (
                <Tr key={assoc.id}>
                  <Td className="font-medium">{assoc.name}</Td>
                  <Td>
                    <code className="text-xs bg-muted px-1 py-0.5 rounded">
                      {assoc.matchPattern}
                    </code>
                  </Td>
                  <Td>{assoc.matchType}</Td>
                  <Td className="text-muted-foreground max-w-xs truncate">
                    {assoc.defaultInstruction || "-"}
                  </Td>
                  <Td>
                    <span className="text-xs">
                      {assoc.usageCount ?? 0} uses /{" "}
                      {assoc.confirmationCount ?? 0} confirmed
                    </span>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm">
                        <BsPencil className="w-4 h-4" />
                      </Button>
                      <Form method="post">
                        <input type="hidden" name="_action" value="delete" />
                        <input type="hidden" name="id" value={assoc.id} />
                        <Button variant="ghost" size="sm" type="submit">
                          <BsTrash className="w-4 h-4" />
                        </Button>
                      </Form>
                    </div>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
