import { cn, useDisclosure, VStack } from "@carbon/react";
import type { AnchorHTMLAttributes } from "react";
import { forwardRef, memo } from "react";
import { Link, useMatches } from "react-router";
import { useModules, useOptimisticLocation } from "~/hooks";
import type { Authenticated, NavItem } from "~/types";

const PrimaryNavigation = () => {
  const navigationPanel = useDisclosure();
  const location = useOptimisticLocation();
  const currentModule = getModule(location.pathname);
  const links = useModules();
  const matchedModules = useMatches().reduce((acc, match) => {
    const handle = match.handle as { module?: string } | undefined;

    if (handle && typeof handle.module === "string") {
      acc.add(handle.module);
    }

    return acc;
  }, new Set<string>());

  return (
    <div className="w-14 h-full flex-col z-50 hidden sm:flex">
      <nav
        data-state={navigationPanel.isOpen ? "expanded" : "collapsed"}
        className={cn(
          "bg-background py-2 group z-10 h-full w-14 data-[state=expanded]:w-[13rem]",
          "flex flex-col justify-between data-[state=expanded]:shadow-xl data-[state=expanded]:border-r data-[state=expanded]:border-border",
          "transition-width duration-200",
          "hide-scrollbar overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
        )}
        onMouseEnter={navigationPanel.onOpen}
        onMouseLeave={navigationPanel.onClose}
      >
        <VStack
          spacing={1}
          className="flex flex-col justify-between h-full px-2"
        >
          <VStack spacing={1}>
            {links.map((link) => {
              const m = getModule(link.to);

              const moduleMatches = matchedModules.has(m);

              const isActive = currentModule === m || moduleMatches;
              return (
                <NavigationIconLink
                  key={link.name}
                  link={link}
                  isActive={isActive}
                  isOpen={navigationPanel.isOpen}
                  onClick={navigationPanel.onClose}
                />
              );
            })}
          </VStack>
        </VStack>
      </nav>
    </div>
  );
};

interface NavigationIconButtonProps
  extends AnchorHTMLAttributes<HTMLAnchorElement> {
  link: Authenticated<NavItem>;
  isActive?: boolean;
  isOpen?: boolean;
}

const NavigationIconLink = forwardRef<
  HTMLAnchorElement,
  NavigationIconButtonProps
>(({ link, isActive = false, isOpen = false, onClick, ...props }, ref) => {
  const iconClasses = [
    "absolute left-3 top-3 flex items-center items-center justify-center" // Layout
  ];

  const classes = [
    // Layout
    "relative",
    "h-10 w-10 group-data-[state=expanded]:w-full",
    "flex items-center rounded-md",
    "group-data-[state=collapsed]:justify-center",
    "group-data-[state=expanded]:-space-x-2",
    // Typography & base styles
    "font-medium shrink-0 inline-flex items-center justify-center select-none",
    "disabled:opacity-50",
    // Animation: snappy 100ms ease-out
    "transition-[background-color,color,width] duration-100 ease-out",
    // Focus ring (after: pseudo-element)
    "focus:!outline-none focus:!ring-0 active:!outline-none active:!ring-0",
    "after:pointer-events-none after:absolute after:-inset-[3px] after:rounded-lg after:border after:border-blue-500 after:opacity-0 after:ring-2 after:ring-blue-500/20 after:transition-opacity focus-visible:after:opacity-100 active:after:opacity-0",
    // Hover state (non-active items)
    !isActive && "hover:bg-accent hover:text-accent-foreground",
    // Active/selected state - solid background, no gradient overlay
    isActive && "bg-active text-active-foreground shadow-button-base",
    "group/item"
  ];

  return (
    <Link
      role="button"
      aria-current={isActive}
      ref={ref}
      to={link.to}
      {...props}
      onClick={onClick}
      className={cn(classes, props.className)}
      prefetch="intent"
    >
      <link.icon className={cn(...iconClasses)} />

      <span
        aria-hidden={isOpen || undefined}
        className={cn(
          "min-w-[128px] text-sm",
          "absolute left-7 group-data-[state=expanded]:left-12",
          "opacity-0 group-data-[state=expanded]:opacity-100"
        )}
      >
        {link.name}
      </span>
    </Link>
  );
});
NavigationIconLink.displayName = "NavigationIconLink";

export default memo(PrimaryNavigation);

export function getModule(link: string) {
  return link.split("/")?.[2];
}
