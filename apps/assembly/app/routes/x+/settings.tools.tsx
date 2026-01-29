import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Button,
  Card,
  Heading,
  Input,
  Label,
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

  const { data: tools } = await client
    .from("assemblyTool")
    .select("*")
    .eq("companyId", companyId)
    .order("name", { ascending: true });

  return {
    tools: tools ?? []
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
    const description = formData.get("description") as string;
    const category = formData.get("category") as string;
    const partNumber = formData.get("partNumber") as string;

    if (!name) {
      return redirect(
        path.to.settingsTools,
        await flash(request, error(null, "Tool name is required"))
      );
    }

    const { error: createError } = await client.from("assemblyTool").insert({
      companyId,
      name,
      description: description || null,
      category: category || null,
      partNumber: partNumber || null
    });

    if (createError) {
      return redirect(
        path.to.settingsTools,
        await flash(request, error(createError, "Failed to create tool"))
      );
    }

    return redirect(
      path.to.settingsTools,
      await flash(request, success("Tool created"))
    );
  }

  if (action === "delete") {
    const id = formData.get("id") as string;

    const { error: deleteError } = await client
      .from("assemblyTool")
      .delete()
      .eq("id", id)
      .eq("companyId", companyId);

    if (deleteError) {
      return redirect(
        path.to.settingsTools,
        await flash(request, error(deleteError, "Failed to delete tool"))
      );
    }

    return redirect(
      path.to.settingsTools,
      await flash(request, success("Tool deleted"))
    );
  }

  return null;
}

export default function SettingsToolsRoute() {
  const { tools } = useLoaderData<typeof loader>();
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
            <Heading size="h2">Tool Library</Heading>
          </div>
          <p className="text-muted-foreground mt-1 ml-10">
            Manage tools that can be assigned to assembly steps
          </p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <BsPlus className="w-4 h-4 mr-2" />
          Add Tool
        </Button>
      </div>

      {/* Add Tool Form */}
      {showForm && (
        <Card className="p-6">
          <Heading size="h4" className="mb-4">
            Add New Tool
          </Heading>
          <Form method="post" className="space-y-4">
            <input type="hidden" name="_action" value="create" />

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">Tool Name *</Label>
                <Input
                  id="name"
                  name="name"
                  placeholder="e.g., 13mm Socket Wrench"
                  required
                />
              </div>
              <div>
                <Label htmlFor="category">Category</Label>
                <Input
                  id="category"
                  name="category"
                  placeholder="e.g., Wrench"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="partNumber">Part Number</Label>
              <Input
                id="partNumber"
                name="partNumber"
                placeholder="e.g., TOOL-001"
              />
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                placeholder="Additional details about the tool..."
                rows={2}
              />
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={isSubmitting}>
                Add Tool
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

      {/* Tools Table */}
      {tools.length === 0 ? (
        <Card className="p-12 text-center">
          <Heading size="h4">No tools yet</Heading>
          <p className="text-muted-foreground mt-2">
            Add tools to your library so they can be assigned to assembly steps.
          </p>
          <Button className="mt-4" onClick={() => setShowForm(true)}>
            <BsPlus className="w-4 h-4 mr-2" />
            Add First Tool
          </Button>
        </Card>
      ) : (
        <Card>
          <Table>
            <Th>
              <Tr>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Part Number</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </Tr>
            </Th>
            <Tbody>
              {tools.map((tool) => (
                <Tr key={tool.id}>
                  <Td className="font-medium">{tool.name}</Td>
                  <Td>{tool.category || "-"}</Td>
                  <Td>{tool.partNumber || "-"}</Td>
                  <Td className="text-muted-foreground max-w-xs truncate">
                    {tool.description || "-"}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm">
                        <BsPencil className="w-4 h-4" />
                      </Button>
                      <Form method="post">
                        <input type="hidden" name="_action" value="delete" />
                        <input type="hidden" name="id" value={tool.id} />
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
