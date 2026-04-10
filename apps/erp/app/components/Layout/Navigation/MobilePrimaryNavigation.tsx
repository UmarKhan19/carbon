import {
  cn,
  Drawer,
  DrawerContent,
  IconButton,
  useDisclosure
} from "@carbon/react";
import { useEffect, useRef } from "react";
import { LuMenu } from "react-icons/lu";
import { Link, useLocation, useMatches } from "react-router";
import { useModules, useOptimisticLocation } from "~/hooks";
import { useUIStore } from "~/stores/ui";
import { getModule } from "./PrimaryNavigation";

const MobilePrimaryNavigation = () => {
  const disclosure = useDisclosure();
  const location = useLocation();
  const prevPathnameRef = useRef(location.pathname);

  // Auto-close the drawer after navigating to a new route.
  useEffect(() => {
    if (disclosure.isOpen && prevPathnameRef.current !== location.pathname) {
      disclosure.onClose();
    }
    prevPathnameRef.current = location.pathname;
  }, [location.pathname, disclosure]);

  const modules = useModules();
  const optimisticLocation = useOptimisticLocation();
  const currentModule = getModule(optimisticLocation.pathname);
  const matchedModules = useMatches().reduce((acc, match) => {
    const handle = match.handle as { module?: string } | undefined;
    if (handle && typeof handle.module === "string") {
      acc.add(handle.module);
    }
    return acc;
  }, new Set<string>());

  const isModuleActive = (to: string) => {
    const m = getModule(to);
    return currentModule === m || matchedModules.has(m);
  };

  const subNavGroups = useUIStore((state) => state.mobileSubNavGroups);
  const subNavLinks = useUIStore((state) => state.mobileSubNavLinks);

  const currentModuleLink = modules.find((m) => isModuleActive(m.to));

  const isRouteActive = (to: string) => {
    return (
      optimisticLocation.pathname === to ||
      optimisticLocation.pathname.startsWith(`${to}/`)
    );
  };

  return (
    <>
      <IconButton
        aria-label="Open navigation"
        icon={<LuMenu />}
        variant="ghost"
        onClick={disclosure.onToggle}
      />
      <Drawer
        open={disclosure.isOpen}
        onOpenChange={(o) => (o ? disclosure.onOpen() : disclosure.onClose())}
      >
        <DrawerContent
          position="left"
          size="sm"
          overlayClassName="bg-black/40"
          className="p-0 overflow-hidden w-[86%] max-w-[300px] rounded-none border-0 border-r border-border"
        >
          <div className="flex flex-col h-full w-full bg-card overflow-hidden">
            {/* Current module header */}
            {currentModuleLink && (
              <div className="flex items-center gap-2.5 px-4 pt-12 pb-3 shrink-0">
                <div className="flex items-center justify-center h-7 w-7 rounded-md bg-active text-active-foreground shrink-0">
                  <currentModuleLink.icon className="h-4 w-4" />
                </div>
                <span className="text-base font-semibold text-foreground truncate">
                  {currentModuleLink.name}
                </span>
              </div>
            )}

            {/* Sub-nav for the current module — the primary content */}
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
              {subNavGroups && subNavGroups.length > 0 && (
                <div className="flex flex-col">
                  {subNavGroups.map((group) => (
                    <div
                      key={group.name}
                      className="flex flex-col px-2 py-2 border-b border-border last:border-b-0"
                    >
                      <h4 className="text-xxs text-foreground/70 uppercase font-light tracking-wide px-3 py-1">
                        {group.name}
                      </h4>
                      {group.routes.map((route) => {
                        const active = isRouteActive(route.to);
                        return (
                          <Link
                            key={route.name}
                            to={route.to + (route.q ? `?q=${route.q}` : "")}
                            prefetch="intent"
                            aria-current={active ? "page" : undefined}
                            className={cn(
                              "group flex items-center gap-3 h-10 px-3 rounded-md text-sm font-medium select-none",
                              "transition-colors duration-100 ease-out",
                              active
                                ? "bg-active text-active-foreground"
                                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground active:bg-accent/80"
                            )}
                          >
                            {route.icon && (
                              <span
                                className={cn(
                                  "h-[18px] w-[18px] shrink-0 flex items-center justify-center",
                                  active
                                    ? "text-active-foreground"
                                    : "text-muted-foreground group-hover:text-accent-foreground"
                                )}
                              >
                                {route.icon}
                              </span>
                            )}
                            <span className="truncate">{route.name}</span>
                          </Link>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}

              {subNavLinks && subNavLinks.length > 0 && (
                <div className="flex flex-col px-2 py-2">
                  {subNavLinks.map((route) => {
                    const active = isRouteActive(route.to);
                    return (
                      <Link
                        key={route.name}
                        to={route.to + (route.q ? `?q=${route.q}` : "")}
                        prefetch="intent"
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "group flex items-center gap-3 h-10 px-3 rounded-md text-sm font-medium select-none",
                          "transition-colors duration-100 ease-out",
                          active
                            ? "bg-active text-active-foreground"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground active:bg-accent/80"
                        )}
                      >
                        {route.icon && (
                          <span
                            className={cn(
                              "h-[18px] w-[18px] shrink-0 flex items-center justify-center",
                              active
                                ? "text-active-foreground"
                                : "text-muted-foreground group-hover:text-accent-foreground"
                            )}
                          >
                            {route.icon}
                          </span>
                        )}
                        <span className="truncate">{route.name}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Module switcher — visually distinct footer tray */}
            <div className="shrink-0 border-t-2 border-border bg-background/60 backdrop-blur-sm">
              <div className="flex items-center justify-between px-4 pt-3 pb-1">
                <span className="text-xxs text-foreground/60 uppercase tracking-wider font-medium">
                  Switch module
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1 px-2 pb-3 pt-1 max-h-[40dvh] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
                {modules.map((link) => {
                  const active = isModuleActive(link.to);
                  return (
                    <Link
                      key={link.name}
                      to={link.to}
                      prefetch="intent"
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-md select-none",
                        "transition-colors duration-100 ease-out",
                        active
                          ? "bg-active text-active-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground active:bg-accent/80"
                      )}
                    >
                      <link.icon
                        className={cn(
                          "h-[18px] w-[18px] shrink-0",
                          active
                            ? "text-active-foreground"
                            : "text-muted-foreground group-hover:text-accent-foreground"
                        )}
                      />
                      <span className="text-[10px] leading-tight font-medium truncate max-w-full text-center">
                        {link.name}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
};

export default MobilePrimaryNavigation;
