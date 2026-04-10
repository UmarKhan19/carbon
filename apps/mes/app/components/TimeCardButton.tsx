import {
  Badge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuClock, LuPlay, LuSquare } from "react-icons/lu";
import { Link, useFetcher, useLocation } from "react-router";
import { path } from "~/utils/path";

type TimeCardButtonProps = {
  openClockEntry: {
    id: string;
    clockIn: string;
  } | null;
};

function formatElapsed(since: string) {
  const ms = Date.now() - new Date(since).getTime();
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

export function TimeCardButton({ openClockEntry }: TimeCardButtonProps) {
  const { t } = useLingui();
  const fetcher = useFetcher();
  const { isMobile, setOpenMobile } = useSidebar();
  const { pathname } = useLocation();
  const [, setTick] = useState(0);

  const isClockedIn =
    openClockEntry !== null ||
    (fetcher.formData?.get("intent") === "clockIn" && fetcher.state !== "idle");

  useEffect(() => {
    if (!openClockEntry) return;
    const interval = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(interval);
  }, [openClockEntry]);

  const handleClockOut = () => {
    if (isMobile) setOpenMobile(false);
    const formData = new FormData();
    formData.append("intent", "clockOut");
    fetcher.submit(formData, {
      method: "post",
      action: path.to.timecard
    });
  };

  const handleClockIn = () => {
    if (isMobile) setOpenMobile(false);
    const formData = new FormData();
    formData.append("intent", "clockIn");
    fetcher.submit(formData, {
      method: "post",
      action: path.to.timecard
    });
  };

  const isOnTimeCardPage = pathname.includes("/timecard");

  return (
    <>
      {isClockedIn ? (
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip={t`Clock Out`}
            onClick={handleClockOut}
            disabled={fetcher.state !== "idle"}
            className="font-medium"
          >
            <LuSquare className="size-4" />
            <span>
              <Trans>Clock Out</Trans>
            </span>
            {openClockEntry && (
              <Badge variant="red" className="ml-auto">
                {formatElapsed(openClockEntry.clockIn)}
              </Badge>
            )}
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : (
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip={t`Clock In`}
            onClick={handleClockIn}
            disabled={fetcher.state !== "idle"}
            className="font-medium"
          >
            <LuPlay className="size-4" />
            <span>
              <Trans>Clock In</Trans>
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      )}

      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={t`My Hours`}
          isActive={isOnTimeCardPage}
          asChild
        >
          <Link
            to={path.to.timeCardPage}
            onClick={() => isMobile && setOpenMobile(false)}
          >
            <LuClock />
            <span>
              <Trans>My Hours</Trans>
            </span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </>
  );
}
