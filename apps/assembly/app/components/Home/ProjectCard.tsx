import { Card } from "@carbon/react";
import { BsFolder2Open } from "react-icons/bs";
import { Link } from "react-router";
import { path } from "~/utils/path";

interface ProjectCardProps {
  project: {
    id: string;
    name: string;
    description?: string | null;
    status: string;
    thumbnailPath?: string | null;
    updatedAt: string;
  };
}

const statusStyles: Record<string, string> = {
  published: "bg-green-100 text-green-700",
  editing: "bg-blue-100 text-blue-700",
  simulating: "bg-violet-100 text-violet-700",
  preprocessing: "bg-yellow-100 text-yellow-700",
  parsing: "bg-yellow-100 text-yellow-700",
  failed: "bg-red-100 text-red-700"
};

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function ProjectCard({ project }: ProjectCardProps) {
  return (
    <Link to={path.to.projectEdit(project.id)}>
      <Card className="group p-4 hover:border-primary/50 hover:shadow-md transition-all cursor-pointer h-full">
        <div className="aspect-video bg-muted rounded-md mb-3 flex items-center justify-center overflow-hidden">
          {project.thumbnailPath ? (
            <img
              src={project.thumbnailPath}
              alt={project.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <BsFolder2Open className="w-8 h-8 text-muted-foreground/50" />
          )}
        </div>
        <p className="font-medium truncate group-hover:text-primary transition-colors">
          {project.name}
        </p>
        {project.description && (
          <p className="text-sm text-muted-foreground line-clamp-1 mt-0.5">
            {project.description}
          </p>
        )}
        <div className="flex items-center justify-between mt-3">
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              statusStyles[project.status] ?? "bg-gray-100 text-gray-600"
            }`}
          >
            {project.status}
          </span>
          <span className="text-xs text-muted-foreground">
            {timeAgo(project.updatedAt)}
          </span>
        </div>
      </Card>
    </Link>
  );
}
