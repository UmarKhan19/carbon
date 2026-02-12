import { Button } from "@carbon/react";
import { BsGear, BsHammer } from "react-icons/bs";
import { Link, useLoaderData } from "react-router";
import { path } from "~/utils/path";

export function Topbar() {
  const { user, company } = useLoaderData<{
    user: { firstName: string; lastName: string; email: string } | null;
    company: { name: string } | null;
  }>();

  const initials = user
    ? `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`
    : "?";

  return (
    <header className="flex items-center justify-between h-[49px] px-4 border-b bg-background">
      <Link to={path.to.dashboard} className="flex items-center gap-2">
        <BsHammer className="w-5 h-5 text-primary" />
        <span className="font-semibold text-lg">Smithy</span>
        {company?.name && (
          <>
            <span className="text-muted-foreground/40 mx-1">/</span>
            <span className="text-sm text-muted-foreground">
              {company.name}
            </span>
          </>
        )}
      </Link>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="md" asChild>
          <Link to={path.to.settings}>
            <BsGear className="w-4 h-4" />
          </Link>
        </Button>
        <div
          className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium select-none"
          title={user ? `${user.firstName} ${user.lastName}` : undefined}
        >
          {initials}
        </div>
      </div>
    </header>
  );
}
