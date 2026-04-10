import {
  Count,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useKeyboardShortcuts,
  usePrettifyShortcut
} from "@carbon/react";
import type { IconType } from "react-icons";
import { LuChevronDown } from "react-icons/lu";
import { Link, useNavigate } from "react-router";
import { useOptimisticLocation, useUrlParams } from "~/hooks";

type DetailLink = {
  name: string;
  to: string;
  icon?: IconType;
  count?: number;
  shortcut?: string;
  isActive?: (pathname: string) => boolean;
};

type DetailTopbarProps = {
  links: DetailLink[];
  preserveParams?: boolean;
};

const DetailTopbar = ({
  links,

  preserveParams = false
}: DetailTopbarProps) => {
  const navigate = useNavigate();
  const location = useOptimisticLocation();
  const [params] = useUrlParams();
  const prettifyShortcut = usePrettifyShortcut();

  useKeyboardShortcuts(
    links.reduce<Record<string, () => void>>((acc, link) => {
      if (link.shortcut) {
        acc[link.shortcut] = () => {
          const url = preserveParams
            ? `${link.to}?${params.toString()}`
            : link.to;
          navigate(url);
        };
      }
      return acc;
    }, {})
  );

  const isActive = (route: DetailLink) =>
    route.isActive
      ? route.isActive(location.pathname)
      : location.pathname.includes(route.to);

  const linkHref = (route: DetailLink) =>
    preserveParams ? `${route.to}?${params.toString()}` : route.to;

  const activeLink = links.find(isActive) ?? links[0];

  return (
    <>
      {/* Desktop: unchanged scrollable tab bar */}
      <div className="hidden lg:inline-flex h-9 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground shadow-[inset_0_1px_2px_rgba(0,0,0,0.15)] border-b border-border">
        {links.map((route) => (
          <Tooltip key={route.name}>
            <TooltipTrigger className="w-full">
              <Link
                to={linkHref(route)}
                prefetch="intent"
                className={cn(
                  "inline-flex items-center justify-center whitespace-nowrap rounded-[6px] px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  isActive(route) &&
                    "bg-background text-foreground shadow-button-base"
                )}
              >
                {route.icon && <route.icon className="mr-2" />}
                <span>{route.name}</span>
                {route.count !== undefined && (
                  <Count count={route.count} className="ml-auto" />
                )}
              </Link>
            </TooltipTrigger>
            {route.shortcut && (
              <TooltipContent side="bottom">
                <HStack>{prettifyShortcut(route.shortcut)}</HStack>
              </TooltipContent>
            )}
          </Tooltip>
        ))}
      </div>

      {/* Mobile/tablet: dropdown select */}
      <div className="lg:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-md bg-muted px-3 text-sm font-medium text-foreground shadow-[inset_0_1px_2px_rgba(0,0,0,0.15)] border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {activeLink?.icon && (
                <activeLink.icon className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="truncate max-w-[140px]">{activeLink?.name}</span>
              <LuChevronDown className="h-4 w-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[180px]">
            {links.map((route) => (
              <DropdownMenuItem
                key={route.name}
                asChild
                className={cn(isActive(route) && "bg-accent/60 font-semibold")}
              >
                <Link to={linkHref(route)} prefetch="intent">
                  {route.icon && <route.icon className="mr-2 h-4 w-4" />}
                  <span>{route.name}</span>
                  {route.count !== undefined && (
                    <Count count={route.count} className="ml-auto" />
                  )}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
};

export default DetailTopbar;
