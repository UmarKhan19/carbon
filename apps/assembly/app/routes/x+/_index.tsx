import { requirePermissions } from "@carbon/auth/auth.server";
import { Button, Card, Heading } from "@carbon/react";
import { BsArrowRight, BsFolder2Open, BsPlus } from "react-icons/bs";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "assembly"
  });

  // Get recent projects
  const { data: projects } = await client
    .from("assemblyProject")
    .select("id, name, status, thumbnailPath, createdAt")
    .eq("companyId", companyId)
    .order("updatedAt", { ascending: false })
    .limit(5);

  // Get project stats
  const { count: totalProjects } = await client
    .from("assemblyProject")
    .select("*", { count: "exact", head: true })
    .eq("companyId", companyId);

  const { count: publishedProjects } = await client
    .from("assemblyProject")
    .select("*", { count: "exact", head: true })
    .eq("companyId", companyId)
    .eq("status", "published");

  return {
    recentProjects: projects ?? [],
    stats: {
      total: totalProjects ?? 0,
      published: publishedProjects ?? 0
    }
  };
}

export default function DashboardRoute() {
  const { recentProjects, stats } = useLoaderData<typeof loader>();

  return (
    <div className="p-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <Heading size="h2">Assembly Instructions</Heading>
          <p className="text-muted-foreground">
            Create animated work instructions from CAD files
          </p>
        </div>
        <Button asChild>
          <Link to={path.to.newProject}>
            <BsPlus className="w-4 h-4 mr-2" />
            New Project
          </Link>
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-6">
          <p className="text-muted-foreground text-sm">Total Projects</p>
          <p className="text-3xl font-bold">{stats.total}</p>
        </Card>
        <Card className="p-6">
          <p className="text-muted-foreground text-sm">Published</p>
          <p className="text-3xl font-bold">{stats.published}</p>
        </Card>
        <Card className="p-6">
          <p className="text-muted-foreground text-sm">In Progress</p>
          <p className="text-3xl font-bold">
            {stats.total - stats.published}
          </p>
        </Card>
      </div>

      {/* Recent Projects */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <Heading size="h4">Recent Projects</Heading>
          <Button variant="ghost" size="sm" asChild>
            <Link to={path.to.projects}>
              View all
              <BsArrowRight className="w-4 h-4 ml-2" />
            </Link>
          </Button>
        </div>

        {recentProjects.length === 0 ? (
          <Card className="p-12 text-center">
            <BsFolder2Open className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <Heading size="h4">No projects yet</Heading>
            <p className="text-muted-foreground mb-4">
              Upload a STEP file to create your first assembly instructions
            </p>
            <Button asChild>
              <Link to={path.to.newProject}>
                <BsPlus className="w-4 h-4 mr-2" />
                Create Project
              </Link>
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {recentProjects.map((project) => (
              <Link key={project.id} to={path.to.project(project.id)}>
                <Card className="p-4 hover:border-primary transition-colors cursor-pointer">
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
                  <div className="flex items-center gap-2 mt-1">
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
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
