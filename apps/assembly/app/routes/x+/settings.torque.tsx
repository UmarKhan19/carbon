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
  Text
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

  const { data: torqueSpecs } = await client
    .from("assemblyTorqueSpec")
    .select("*")
    .eq("companyId", companyId)
    .order("name", { ascending: true });

  return {
    torqueSpecs: torqueSpecs ?? []
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
    const torqueValue = parseFloat(formData.get("torqueValue") as string);
    const torqueUnit = formData.get("torqueUnit") as string;
    const tolerance = formData.get("tolerance") as string;
    const fastenerType = formData.get("fastenerType") as string;
    const notes = formData.get("notes") as string;

    if (!name || isNaN(torqueValue)) {
      return redirect(
        path.to.settingsTorque,
        await flash(request, error(null, "Name and torque value are required"))
      );
    }

    const { error: createError } = await client
      .from("assemblyTorqueSpec")
      .insert({
        companyId,
        name,
        torqueValue,
        torqueUnit: torqueUnit || "Nm",
        tolerance: tolerance ? parseFloat(tolerance) : null,
        fastenerType: fastenerType || null,
        notes: notes || null
      });

    if (createError) {
      return redirect(
        path.to.settingsTorque,
        await flash(request, error(createError, "Failed to create torque spec"))
      );
    }

    return redirect(
      path.to.settingsTorque,
      await flash(request, success("Torque spec created"))
    );
  }

  if (action === "delete") {
    const id = formData.get("id") as string;

    const { error: deleteError } = await client
      .from("assemblyTorqueSpec")
      .delete()
      .eq("id", id)
      .eq("companyId", companyId);

    if (deleteError) {
      return redirect(
        path.to.settingsTorque,
        await flash(request, error(deleteError, "Failed to delete torque spec"))
      );
    }

    return redirect(
      path.to.settingsTorque,
      await flash(request, success("Torque spec deleted"))
    );
  }

  return null;
}

export default function SettingsTorqueRoute() {
  const { torqueSpecs } = useLoaderData<typeof loader>();
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
            <Heading size="h2">Torque Specifications</Heading>
          </div>
          <p className="text-muted-foreground mt-1 ml-10">
            Define torque specs for fasteners
          </p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <BsPlus className="w-4 h-4 mr-2" />
          Add Torque Spec
        </Button>
      </div>

      {/* Add Form */}
      {showForm && (
        <Card className="p-6">
          <Heading size="h4" className="mb-4">
            Add New Torque Specification
          </Heading>
          <Form method="post" className="space-y-4">
            <input type="hidden" name="_action" value="create" />

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  name="name"
                  placeholder="e.g., M8 Standard"
                  required
                />
              </div>
              <div>
                <Label htmlFor="fastenerType">Fastener Type</Label>
                <Input
                  id="fastenerType"
                  name="fastenerType"
                  placeholder="e.g., M8 Bolt"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="torqueValue">Torque Value *</Label>
                <Input
                  id="torqueValue"
                  name="torqueValue"
                  type="number"
                  step="0.1"
                  placeholder="25"
                  required
                />
              </div>
              <div>
                <Label htmlFor="torqueUnit">Unit</Label>
                <Select name="torqueUnit" defaultValue="Nm">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Nm">Nm</SelectItem>
                    <SelectItem value="ft-lb">ft-lb</SelectItem>
                    <SelectItem value="in-lb">in-lb</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="tolerance">Tolerance (+/-)</Label>
                <Input
                  id="tolerance"
                  name="tolerance"
                  type="number"
                  step="0.1"
                  placeholder="2"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="notes">Notes</Label>
              <Input
                id="notes"
                name="notes"
                placeholder="Additional notes..."
              />
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={isSubmitting}>
                Add Torque Spec
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
      {torqueSpecs.length === 0 ? (
        <Card className="p-12 text-center">
          <Heading size="h4">No torque specs yet</Heading>
          <p className="text-muted-foreground mt-2">
            Add torque specifications to standardize fastener requirements.
          </p>
          <Button className="mt-4" onClick={() => setShowForm(true)}>
            <BsPlus className="w-4 h-4 mr-2" />
            Add First Torque Spec
          </Button>
        </Card>
      ) : (
        <Card>
          <Table>
            <Th>
              <Tr>
                <TableHead>Name</TableHead>
                <TableHead>Fastener Type</TableHead>
                <TableHead>Torque</TableHead>
                <TableHead>Tolerance</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </Tr>
            </Th>
            <Tbody>
              {torqueSpecs.map((spec) => (
                <Tr key={spec.id}>
                  <Td className="font-medium">{spec.name}</Td>
                  <Td>{spec.fastenerType || "-"}</Td>
                  <Td>
                    {spec.torqueValue} {spec.torqueUnit}
                  </Td>
                  <Td>
                    {spec.tolerance
                      ? `+/- ${spec.tolerance} ${spec.torqueUnit}`
                      : "-"}
                  </Td>
                  <Td className="text-muted-foreground max-w-xs truncate">
                    {spec.notes || "-"}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm">
                        <BsPencil className="w-4 h-4" />
                      </Button>
                      <Form method="post">
                        <input type="hidden" name="_action" value="delete" />
                        <input type="hidden" name="id" value={spec.id} />
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
