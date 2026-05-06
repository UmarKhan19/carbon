import { Button, Card, CardContent, cn, VStack } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { path } from "~/utils/path";

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
  Icon: UpgradeOverlayIcon,
  Title: UpgradeOverlayTitle,
  Description: UpgradeOverlayDescription,
  Content: UpgradeOverlayContent,
  Actions: UpgradeOverlayActions,
  UpgradeButton: UpgradeOverlayUpgradeButton
});
