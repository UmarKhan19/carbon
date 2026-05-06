import {
  Button,
  Card,
  CardContent,
  cn,
  Modal,
  ModalContent,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router";
import { path } from "~/utils/path";

function useIsScrolling(idleMs = 200): boolean {
  const [scrolling, setScrolling] = useState(false);
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      setScrolling(true);
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => setScrolling(false), idleMs);
    };
    document.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true
    });
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      if (timeout) clearTimeout(timeout);
    };
  }, [idleMs]);
  return scrolling;
}

type WithChildren = { children: ReactNode; className?: string };

function UpgradeOverlayRoot({ children, className }: WithChildren) {
  return (
    <div
      className={cn(
        "relative w-full h-full min-h-[calc(100dvh-49px)]",
        className
      )}
    >
      {children}
    </div>
  );
}

function UpgradeOverlayPreview({ children, className }: WithChildren) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "blur-[2px] pointer-events-none select-none w-full h-full",
        className
      )}
    >
      {children}
    </div>
  );
}

function UpgradeOverlayCard({ children, className }: WithChildren) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <Card className={cn("max-w-md shadow-lg", className)}>
        <CardContent className="flex flex-col items-center text-center gap-4 pt-6">
          {children}
        </CardContent>
      </Card>
    </div>
  );
}

function UpgradeOverlayInline({ children, className }: WithChildren) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-start flex-1 w-full pt-[15dvh] text-center gap-4 px-4 h-full",
        className
      )}
    >
      {children}
    </div>
  );
}

function UpgradeOverlayIcon({ children }: { children: ReactNode }) {
  return <div className="rounded-full bg-muted p-3">{children}</div>;
}

function UpgradeOverlayTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-lg font-semibold">{children}</h3>;
}

function UpgradeOverlayDescription({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm text-muted-foreground text-balance">{children}</p>
  );
}

function UpgradeOverlayContent({ children }: { children: ReactNode }) {
  return <VStack className="gap-2 items-center">{children}</VStack>;
}

function UpgradeOverlayActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-col items-center gap-2">{children}</div>;
}

function UpgradeOverlayStickyGradient({
  children,
  className,
  scrollOpacity = 0.9,
  onClick
}: {
  children: ReactNode;
  className?: string;
  scrollOpacity?: number;
  onClick?: () => void;
}) {
  const isScrolling = useIsScrolling();
  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 pointer-events-none",
        "h-[50dvh] flex items-end justify-center pb-24",
        "bg-gradient-to-t from-background from-[35%] via-background/70 via-[65%] to-transparent",
        "transition-opacity duration-200 ease-out",
        "motion-reduce:transition-none",
        className
      )}
      style={{ opacity: isScrolling ? scrollOpacity : 1 }}
    >
      <div
        onClick={onClick}
        className="pointer-events-auto px-4 w-full flex flex-col items-center text-center gap-3 max-w-md mx-auto cursor-pointer rounded-md"
      >
        {children}
      </div>
    </div>
  );
}

function UpgradeOverlayDialog({
  open,
  onOpenChange,
  children
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="max-w-md">
        <CardContent className="flex flex-col items-center text-center gap-4 pt-8 pb-6">
          {children}
        </CardContent>
      </ModalContent>
    </Modal>
  );
}

function UpgradeOverlayUpgradeButton({
  children,
  to = path.to.billing
}: {
  children?: ReactNode;
  to?: string;
}) {
  return (
    <Button asChild>
      <Link to={to}>{children ?? <Trans>Upgrade to Business</Trans>}</Link>
    </Button>
  );
}

export const UpgradeOverlay = Object.assign(UpgradeOverlayRoot, {
  Preview: UpgradeOverlayPreview,
  Card: UpgradeOverlayCard,
  Inline: UpgradeOverlayInline,
  StickyGradient: UpgradeOverlayStickyGradient,
  Dialog: UpgradeOverlayDialog,
  Icon: UpgradeOverlayIcon,
  Title: UpgradeOverlayTitle,
  Description: UpgradeOverlayDescription,
  Content: UpgradeOverlayContent,
  Actions: UpgradeOverlayActions,
  UpgradeButton: UpgradeOverlayUpgradeButton
});
