import { Button, VStack } from "@carbon/react";
import { useEffect } from "react";
import { Link } from "react-router";
import { useOptimisticLocation, useUrlParams } from "~/hooks";
import { useUIStore } from "~/stores/ui";
import type { Route } from "~/types";
import { CollapsibleSidebar } from "./CollapsibleSidebar";

const ContentSidebar = ({ links }: { links: Route[] }) => {
  const location = useOptimisticLocation();
  const [params] = useUrlParams();
  const filter = params.get("q") ?? undefined;

  const setMobileSubNavLinks = useUIStore(
    (state) => state.setMobileSubNavLinks
  );
  useEffect(() => {
    setMobileSubNavLinks(links);
    return () => setMobileSubNavLinks(null);
  }, [links, setMobileSubNavLinks]);

  return (
    <CollapsibleSidebar>
      <div className="overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent h-full w-full pb-8">
        <VStack>
          <VStack spacing={1} className="p-2">
            {links.map((route) => {
              const isActive =
                location.pathname.includes(route.to) && route.q === filter;
              return (
                <Button
                  key={route.name}
                  asChild
                  leftIcon={route.icon}
                  variant={isActive ? "active" : "ghost"}
                  className="w-full justify-start"
                >
                  <Link
                    to={route.to + (route.q ? `?q=${route.q}` : "")}
                    prefetch="intent"
                  >
                    {route.name}
                  </Link>
                </Button>
              );
            })}
          </VStack>
        </VStack>
      </div>
    </CollapsibleSidebar>
  );
};

export default ContentSidebar;
