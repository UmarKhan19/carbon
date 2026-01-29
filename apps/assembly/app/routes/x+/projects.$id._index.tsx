import { requirePermissions } from "@carbon/auth/auth.server";
import { Button, Card, Heading } from "@carbon/react";
import {
  BsArrowRight,
  BsClockHistory,
  BsDownload,
  BsListOl,
  BsPencil,
  BsPlay,
  BsShare
} from "react-icons/bs";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "assembly"
  });

  const projectId = params.id;
  if (!projectId) {
    throw new Response("Project not found", { status: 404 });
  }

  const { data: project, error: projectError } = await client
    .from("assemblyProject")
    .select("*")
    .eq("id", projectId)
    .eq("companyId", companyId)
    .single();

  if (projectError || !project) {
    throw new Response("Project not found", { status: 404 });
  }

  // Get step count
  const { count: stepCount } = await client
    .from("assemblyStep")
    .select("*", { count: "exact", head: true })
    .eq("projectId", projectId);

  return {
    project,
    stepCount: stepCount ?? 0
  };
}

export default function ProjectOverviewRoute() {
  const { project, stepCount } = useLoaderData<typeof loader>();

  const statusBadge =
    {
      preprocessing:
        "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
      simulating:
        "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
      editing:
        "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
      published:
        "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
    }[project.status] || "bg-gray-100 text-gray-700";

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Heading size="h2">{project.name}</Heading>
            <span className={`text-xs px-2 py-1 rounded-full ${statusBadge}`}>
              {project.status}
            </span>
          </div>
          {project.description && (
            <p className="text-muted-foreground mt-1">
              {project.description}
            </p>
          )}
          <p className="text-sm text-muted-foreground mt-2">
            <BsClockHistory className="inline w-3 h-3 mr-1" />
            Last updated: {new Date(project.updatedAt).toLocaleString()}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to={path.to.projectExport(project.id)}>
              <BsDownload className="w-4 h-4 mr-2" />
              Export
            </Link>
          </Button>
          <Button asChild>
            <Link to={path.to.projectEdit(project.id)}>
              <BsPencil className="w-4 h-4 mr-2" />
              Edit Instructions
            </Link>
          </Button>
        </div>
      </div>

      {/* Workflow Progress */}
      <Card className="p-6">
        <Heading size="h4" className="mb-4">
          Workflow Progress
        </Heading>
        <div className="flex items-center gap-4">
          <WorkflowStep
            step={1}
            title="Prepare"
            description="Rename parts, organize tree"
            status={
              project.status === "preprocessing"
                ? "current"
                : ["simulating", "editing", "published"].includes(
                      project.status
                    )
                  ? "completed"
                  : "pending"
            }
            link={path.to.projectPrep(project.id)}
          />
          <div className="flex-1 h-0.5 bg-muted" />
          <WorkflowStep
            step={2}
            title="Simulate"
            description="Generate assembly sequence"
            status={
              project.status === "simulating"
                ? "current"
                : ["editing", "published"].includes(project.status)
                  ? "completed"
                  : "pending"
            }
          />
          <div className="flex-1 h-0.5 bg-muted" />
          <WorkflowStep
            step={3}
            title="Edit"
            description="Add instructions & annotations"
            status={
              project.status === "editing"
                ? "current"
                : project.status === "published"
                  ? "completed"
                  : "pending"
            }
            link={
              ["editing", "published"].includes(project.status)
                ? path.to.projectEdit(project.id)
                : undefined
            }
          />
          <div className="flex-1 h-0.5 bg-muted" />
          <WorkflowStep
            step={4}
            title="Export"
            description="Share or download"
            status={project.status === "published" ? "current" : "pending"}
            link={
              project.status === "published"
                ? path.to.projectExport(project.id)
                : undefined
            }
          />
        </div>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <BsListOl className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stepCount}</p>
              <p className="text-sm text-muted-foreground">
                Assembly Steps
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <BsShare className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">0</p>
              <p className="text-sm text-muted-foreground">Share Links</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <BsPlay className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">0</p>
              <p className="text-sm text-muted-foreground">
                Video Exports
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-6 hover:border-primary transition-colors">
          <Link to={path.to.projectPrep(project.id)} className="block">
            <Heading size="h4">Preprocessing</Heading>
            <p className="text-muted-foreground mt-1">
              Rename parts, reorganize the assembly tree, and prepare for
              simulation
            </p>
            <div className="flex items-center text-primary mt-3 text-sm font-medium">
              Go to Preprocessing
              <BsArrowRight className="w-4 h-4 ml-2" />
            </div>
          </Link>
        </Card>
        <Card className="p-6 hover:border-primary transition-colors">
          <Link to={path.to.projectEdit(project.id)} className="block">
            <Heading size="h4">Instruction Editor</Heading>
            <p className="text-muted-foreground mt-1">
              Add notes, tools, annotations, and customize the assembly
              animation
            </p>
            <div className="flex items-center text-primary mt-3 text-sm font-medium">
              Go to Editor
              <BsArrowRight className="w-4 h-4 ml-2" />
            </div>
          </Link>
        </Card>
      </div>
    </div>
  );
}

function WorkflowStep({
  step,
  title,
  description,
  status,
  link
}: {
  step: number;
  title: string;
  description: string;
  status: "pending" | "current" | "completed";
  link?: string;
}) {
  const content = (
    <div className="flex flex-col items-center text-center">
      <div
        className={`
          w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold
          ${
            status === "completed"
              ? "bg-green-500 text-white"
              : status === "current"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
          }
        `}
      >
        {step}
      </div>
      <p className="font-medium mt-2">{title}</p>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );

  if (link) {
    return (
      <Link to={link} className="hover:opacity-80 transition-opacity">
        {content}
      </Link>
    );
  }

  return content;
}
