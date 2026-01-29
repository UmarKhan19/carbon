import { cn } from "@carbon/react";
import {
  BsFolder2Open,
  BsGear,
  BsHouseDoor,
  BsTools,
  BsWrench
} from "react-icons/bs";
import { Link, useLocation } from "react-router";
import { path } from "~/utils/path";

interface NavItem {
  label: string;
  to: string;
  icon: React.ReactNode;
}

const mainNavItems: NavItem[] = [
  {
    label: "Dashboard",
    to: path.to.dashboard,
    icon: <BsHouseDoor className="w-4 h-4" />
  },
  {
    label: "Projects",
    to: path.to.projects,
    icon: <BsFolder2Open className="w-4 h-4" />
  }
];

const settingsNavItems: NavItem[] = [
  {
    label: "Settings",
    to: path.to.settings,
    icon: <BsGear className="w-4 h-4" />
  },
  {
    label: "Tools Library",
    to: path.to.settingsTools,
    icon: <BsTools className="w-4 h-4" />
  },
  {
    label: "Torque Specs",
    to: path.to.settingsTorque,
    icon: <BsWrench className="w-4 h-4" />
  }
];

function NavLink({ item }: { item: NavItem }) {
  const location = useLocation();
  const isActive =
    location.pathname === item.to ||
    location.pathname.startsWith(item.to + "/");

  return (
    <Link
      to={item.to}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
        isActive
          ? "bg-primary/10 text-primary font-medium"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {item.icon}
      {item.label}
    </Link>
  );
}

export function Sidebar() {
  return (
    <aside className="w-56 border-r bg-background flex flex-col">
      <nav className="flex-1 p-3 space-y-1">
        {mainNavItems.map((item) => (
          <NavLink key={item.to} item={item} />
        ))}
      </nav>
      <div className="border-t p-3 space-y-1">
        {settingsNavItems.map((item) => (
          <NavLink key={item.to} item={item} />
        ))}
      </div>
    </aside>
  );
}
