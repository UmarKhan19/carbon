import { requirePermissions } from "@carbon/auth/auth.server";
import type { stepParserOccTask } from "@carbon/jobs/trigger/step-parser-occ";
import { Button, Heading, Input } from "@carbon/react";
import { tasks } from "@trigger.dev/sdk";
import { useState } from "react";
import { BsFolder2Open, BsSearch } from "react-icons/bs";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { NewProjectCard } from "~/components/Home/NewProjectCard";
import { NewProjectModal } from "~/components/Home/NewProjectModal";
import { ProjectCard } from "~/components/Home/ProjectCard";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "assembly"
  });

  const url = new URL(request.url);
  const search = url.searchParams.get("search") || "";
  const status = url.searchParams.get("status") || "";

  // Fetch projects with optional search/filter
  let query = client
    .from("assemblyProject")
    .select(
      "id, name, description, status, thumbnailPath, createdAt, updatedAt"
    )
    .eq("companyId", companyId)
    .order("updatedAt", { ascending: false });

  if (search) {
    query = query.ilike("name", `%${search}%`);
  }
  if (status) {
    query = query.eq("status", status);
  }

  const { data: projects } = await query;

  // Stats
  const { count: totalProjects } = await client
    .from("assemblyProject")
    .select("*", { count: "exact", head: true })
    .eq("companyId", companyId);

  return {
    projects: projects ?? [],
    totalProjects: totalProjects ?? 0,
    filters: { search, status }
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "assembly"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent !== "createProject") {
    return { error: "Invalid action" };
  }

  const name = formData.get("name") as string;
  const file = formData.get("file") as File | null;

  if (!name?.trim()) {
    return { error: "Project name is required" };
  }

  if (!file || file.size === 0) {
    return { error: "STEP file is required" };
  }

  const validExtensions = [".step", ".stp"];
  const hasValidExtension = validExtensions.some((ext) =>
    file.name.toLowerCase().endsWith(ext)
  );

  if (!hasValidExtension) {
    return { error: "File must be a STEP file (.step or .stp)" };
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
    return { error: `Failed to upload file: ${uploadError.message}` };
  }

  // Create project record
  const { data: project, error: createError } = await client
    .from("assemblyProject")
    .insert({
      companyId,
      name: name.trim(),
      description: null,
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
    await client.storage.from("private").remove([storagePath]);
    return { error: "Failed to create project" };
  }

  // Trigger parse job (which auto-chains to simulation)
  await tasks.trigger<typeof stepParserOccTask>("step-parser-occ", {
    projectId: project.id,
    companyId,
    storagePath
  });

  return { projectId: project.id };
}

const statusFilters = [
  { value: "", label: "All" },
  { value: "preprocessing", label: "Processing" },
  { value: "editing", label: "Editing" },
  { value: "published", label: "Published" }
];

export default function HomeRoute() {
  const { projects, totalProjects, filters } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showNewProject, setShowNewProject] = useState(false);

  const handleSearch = (value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set("search", value);
    } else {
      params.delete("search");
    }
    setSearchParams(params);
  };

  const handleStatusFilter = (status: string) => {
    const params = new URLSearchParams(searchParams);
    if (status) {
      params.set("status", status);
    } else {
      params.delete("status");
    }
    setSearchParams(params);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Heading size="h2">Projects</Heading>
          <p className="text-sm text-muted-foreground mt-1">
            {totalProjects} project{totalProjects !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <BsSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input
            placeholder="Search projects..."
            defaultValue={filters.search}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {statusFilters.map((f) => (
            <Button
              key={f.value || "all"}
              variant={filters.status === f.value ? "primary" : "ghost"}
              size="sm"
              onClick={() => handleStatusFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Project Grid */}
      {projects.length === 0 && !filters.search && !filters.status ? (
        // Empty state — no projects at all
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <BsFolder2Open className="w-16 h-16 text-muted-foreground/30 mb-4" />
          <Heading size="h4">No projects yet</Heading>
          <p className="text-muted-foreground mt-2 mb-6 max-w-md">
            Upload a STEP file to create your first assembly instructions with
            automated disassembly simulation.
          </p>
          <Button onClick={() => setShowNewProject(true)}>
            Create your first project
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          <NewProjectCard onClick={() => setShowNewProject(true)} />
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}

      {/* Filtered empty state */}
      {projects.length === 0 && (filters.search || filters.status) && (
        <div className="text-center py-12 text-muted-foreground">
          No projects match your filters.
        </div>
      )}

      <NewProjectModal open={showNewProject} onOpenChange={setShowNewProject} />
    </div>
  );
}
