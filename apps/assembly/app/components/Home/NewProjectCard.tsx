import { BsPlus } from "react-icons/bs";

interface NewProjectCardProps {
  onClick: () => void;
}

export function NewProjectCard({ onClick }: NewProjectCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-center justify-center h-full min-h-[200px] rounded-lg border-2 border-dashed border-muted-foreground/25 hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer"
    >
      <div className="w-12 h-12 rounded-full bg-muted group-hover:bg-primary/10 flex items-center justify-center transition-colors mb-3">
        <BsPlus className="w-6 h-6 text-muted-foreground group-hover:text-primary transition-colors" />
      </div>
      <span className="text-sm font-medium text-muted-foreground group-hover:text-primary transition-colors">
        New Project
      </span>
    </button>
  );
}
