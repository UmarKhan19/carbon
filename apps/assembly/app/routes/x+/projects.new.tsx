import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { stepParserOccTask } from "@carbon/jobs/trigger/step-parser-occ";
import {
  Button,
  Card,
  Heading,
  Input,
  Label,
  Text,
  Textarea
} from "@carbon/react";
import { tasks } from "@trigger.dev/sdk";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { BsCloudUpload, BsFileEarmarkCode, BsX } from "react-icons/bs";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useNavigation } from "react-router";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "assembly"
  });

  return {};
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "assembly"
  });

  const formData = await request.formData();
  const name = formData.get("name") as string;
  const description = formData.get("description") as string;
  const file = formData.get("file") as File | null;

  if (!name) {
    return redirect(
      path.to.newProject,
      await flash(request, error(null, "Project name is required"))
    );
  }

  if (!file || file.size === 0) {
    return redirect(
      path.to.newProject,
      await flash(request, error(null, "STEP file is required"))
    );
  }

  // Validate file extension
  const validExtensions = [".step", ".stp", ".STEP", ".STP"];
  const hasValidExtension = validExtensions.some((ext) =>
    file.name.toLowerCase().endsWith(ext.toLowerCase())
  );

  if (!hasValidExtension) {
    return redirect(
      path.to.newProject,
      await flash(
        request,
        error(null, "File must be a STEP file (.step or .stp)")
      )
    );
  }

  // Upload file to storage
  const fileName = `${crypto.randomUUID()}-${file.name}`;
  const storagePath = `${companyId}/assembly/${fileName}`;

  const { error: uploadError } = await client.storage
    .from("private")
    .upload(storagePath, file, {
      contentType: "application/octet-stream"
    });

  if (uploadError) {
    return redirect(
      path.to.newProject,
      await flash(request, error(uploadError, "Failed to upload file"))
    );
  }

  // Create project record
  const { data: project, error: createError } = await client
    .from("assemblyProject")
    .insert({
      companyId,
      name,
      description: description || null,
      status: "preprocessing",
      originalFileName: file.name,
      assemblyTree: {},
      originalAssemblyTree: {},
      createdBy: userId,
      updatedBy: userId
    })
    .select("id")
    .single();

  if (createError || !project) {
    // Cleanup uploaded file
    await client.storage.from("private").remove([storagePath]);

    return redirect(
      path.to.newProject,
      await flash(request, error(createError, "Failed to create project"))
    );
  }

  // Trigger OpenCascade parsing job to extract assembly tree and generate GLB
  await tasks.trigger<typeof stepParserOccTask>("step-parser-occ", {
    projectId: project.id,
    companyId,
    storagePath
  });

  return redirect(
    path.to.projectPrep(project.id),
    await flash(
      request,
      success("Project created! Now prepare your assembly tree.")
    )
  );
}

export default function NewProjectRoute() {
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setSelectedFile(acceptedFiles[0]);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/step": [".step", ".stp", ".STEP", ".STP"]
    },
    maxFiles: 1
  });

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <Heading size="h2" className="mb-6">
        New Assembly Project
      </Heading>

      <Form method="post" encType="multipart/form-data">
        <Card className="p-6 space-y-6">
          {/* Project Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Project Name *</Label>
            <Input
              id="name"
              name="name"
              placeholder="e.g., Motor Assembly Instructions"
              required
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              placeholder="Brief description of the assembly..."
              rows={3}
            />
          </div>

          {/* File Upload */}
          <div className="space-y-2">
            <Label>STEP File *</Label>
            <div
              {...getRootProps()}
              className={`
                border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
                ${isDragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"}
              `}
            >
              <input {...getInputProps()} name="file" />
              {selectedFile ? (
                <div className="flex items-center justify-center gap-3">
                  <BsFileEarmarkCode className="w-8 h-8 text-primary" />
                  <div className="text-left">
                    <p className="font-medium">{selectedFile.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedFile(null);
                    }}
                  >
                    <BsX className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <BsCloudUpload className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                  <p className="font-medium">
                    {isDragActive
                      ? "Drop file here"
                      : "Drop STEP file here or click to browse"}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Supports .step and .stp files
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Workflow Info */}
          <div className="bg-muted rounded-lg p-4">
            <Heading size="h5" className="mb-2">
              What happens next?
            </Heading>
            <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
              <li>
                Your STEP file will be parsed to extract the assembly tree
              </li>
              <li>You can rename parts and reorganize the tree structure</li>
              <li>Physics simulation will generate the assembly sequence</li>
              <li>Add instructions, tools, and annotations to each step</li>
              <li>Export as video, share link, or PDF</li>
            </ol>
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" asChild>
              <a href={path.to.projects}>Cancel</a>
            </Button>
            <Button type="submit" disabled={isSubmitting || !selectedFile}>
              {isSubmitting ? "Creating..." : "Create Project"}
            </Button>
          </div>
        </Card>
      </Form>
    </div>
  );
}
