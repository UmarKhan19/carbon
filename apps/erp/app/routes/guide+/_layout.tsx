import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import { WaveScrollRail } from "~/components/Docs/WaveScrollRail";
import GuideStyle from "~/styles/guide-docs.css?url";
import { GuideFooter } from "./components/GuideFooter";
import { GuideNav } from "./components/GuideNav";
import { GuideSidebar } from "./components/GuideSidebar";

export const meta: MetaFunction = () => [
  { title: "Carbon Guide — Learn Carbon" },
  {
    name: "description",
    content:
      "A written, end-to-end guide to running your manufacturing business in Carbon."
  }
];

// The stylesheet declared on the layout applies to every chapter route, so each
// page inherits it without re-declaring links.
export function links() {
  return [{ rel: "stylesheet", href: GuideStyle }];
}

// PUBLIC: deliberately no requireAuthSession / requirePermissions — the guide is
// shareable, like the /mcp docs.
export default function GuideLayout() {
  return (
    <div className="GUIDE bg-[var(--canvas)] text-foreground antialiased min-h-screen">
      <GuideNav />
      <WaveScrollRail />
      <div className="container">
        <div className="grid grid-cols-1 min-[880px]:grid-cols-[220px_minmax(0,720px)] gap-12 pt-[52px] pb-10">
          <GuideSidebar />
          <Outlet />
        </div>
      </div>
      <GuideFooter />
    </div>
  );
}
