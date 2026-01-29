import { Button } from "@carbon/react";
import { BsBoxSeam } from "react-icons/bs";
import { Link, useLoaderData } from "react-router";
import { path } from "~/utils/path";

export function Topbar() {
  const { user, company } = useLoaderData<{
    user: { firstName: string; lastName: string; email: string } | null;
    company: { name: string } | null;
  }>();

  return (
    <header className="flex items-center justify-between h-[49px] px-4 border-b bg-background">
      <div className="flex items-center gap-4">
        <Link to={path.to.dashboard} className="flex items-center gap-2">
          <BsBoxSeam className="w-6 h-6 text-primary" />
          <span className="font-semibold text-lg">Assembly</span>
        </Link>
        {company?.name && (
          <span className="text-sm text-muted-foreground">{company.name}</span>
        )}
      </div>
      <div className="flex items-center gap-4">
        {user && (
          <span className="text-sm text-muted-foreground">
            {user.firstName} {user.lastName}
          </span>
        )}
        <Button variant="ghost" size="sm" asChild>
          <Link to={path.to.settings}>Settings</Link>
        </Button>
      </div>
    </header>
  );
}
