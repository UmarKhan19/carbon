import { requirePermissions } from "@carbon/auth/auth.server";
import { Button, Card, Heading, Input } from "@carbon/react";
import { BsFolder2Open, BsPlus, BsSearch } from "react-icons/bs";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useSearchParams } from "react-router";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "assembly"
  });

  const url = new URL(request.url);
  const search = url.searchParams.get("search") || "";
  const status = url.searchParams.get("status") || "";

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

  return {
    projects: projects ?? [],
    filters: { search, status }
  };
}

export default function ProjectsListRoute() {
  const { projects, filters } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

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
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <Heading size="h2">Projects</Heading>
        <Button asChild>
          <Link to={path.to.newProject}>
            <BsPlus className="w-4 h-4 mr-2" />
            New Project
          </Link>
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <BsSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input
            placeholder="Search projects..."
            defaultValue={filters.search}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          {["", "preprocessing", "editing", "published"].map((status) => (
            <Button
              key={status || "all"}
              variant={filters.status === status ? "default" : "outline"}
              size="sm"
              onClick={() => handleStatusFilter(status)}
            >
              {status || "All"}
            </Button>
          ))}
        </div>
      </div>

      {/* Projects Grid */}
      {projects.length === 0 ? (
        <Card className="p-12 text-center">
          <BsFolder2Open className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <Heading size="h4">No projects found</Heading>
          <p className="text-muted-foreground mb-4">
            {filters.search || filters.status
              ? "Try adjusting your filters"
              : "Upload a STEP file to create your first assembly instructions"}
          </p>
          {!filters.search && !filters.status && (
            <Button asChild>
              <Link to={path.to.newProject}>
                <BsPlus className="w-4 h-4 mr-2" />
                Create Project
              </Link>
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {projects.map((project) => (
            <Link key={project.id} to={path.to.project(project.id)}>
              <Card className="p-4 hover:border-primary transition-colors cursor-pointer h-full">
                <div className="aspect-video bg-muted rounded-md mb-3 flex items-center justify-center">
                  {project.thumbnailPath ? (
                    <img
                      src={project.thumbnailPath}
                      alt={project.name}
                      className="w-full h-full object-cover rounded-md"
                    />
                  ) : (
                    <BsFolder2Open className="w-8 h-8 text-muted-foreground" />
                  )}
                </div>
                <p className="font-medium truncate">{project.name}</p>
                {project.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                    {project.description}
                  </p>
                )}
                <div className="flex items-center justify-between mt-3">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      project.status === "published"
                        ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                        : project.status === "editing"
                          ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                          : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                    }`}
                  >
                    {project.status}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {new Date(project.updatedAt).toLocaleDateString()}
                  </p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
