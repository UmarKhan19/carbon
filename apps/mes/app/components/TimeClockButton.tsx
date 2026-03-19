import {
  cn,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar
} from "@carbon/react";
import { useEffect, useState } from "react";
import { LuClock, LuPlay, LuSquare } from "react-icons/lu";
import { Link, useFetcher, useLocation } from "react-router";
import { path } from "~/utils/path";

type TimeClockButtonProps = {
  openClockEntry: {
    id: string;
    clockIn: string;
  } | null;
};

function formatElapsed(clockIn: string) {
  const ms = Date.now() - new Date(clockIn).getTime();
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

export function TimeClockButton({ openClockEntry }: TimeClockButtonProps) {
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

  const handleClockAction = () => {
    if (isMobile) setOpenMobile(false);
    const formData = new FormData();
    formData.append("intent", isClockedIn ? "clockOut" : "clockIn");
    fetcher.submit(formData, {
      method: "post",
      action: path.to.timeclock
    });
  };

  const isOnTimeClockPage = pathname.includes("/timeclock");

  return (
    <>
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={isClockedIn ? "Clock Out" : "Clock In"}
          onClick={handleClockAction}
          disabled={fetcher.state !== "idle"}
          className={cn(
            "font-medium",
            isClockedIn
              ? "bg-red-500 text-white hover:bg-red-600 hover:text-white"
              : "border-[3px] border-emerald-500 text-emerald-600 bg-transparent hover:bg-emerald-50 hover:text-emerald-700"
          )}
        >
          {isClockedIn ? (
            <LuSquare className="size-4" />
          ) : (
            <LuPlay className="size-4 -ml-[3px]" />
          )}
          <span>{isClockedIn ? "Clock Out" : "Clock In"}</span>
          {isClockedIn && openClockEntry && (
            <span className="ml-auto text-xs opacity-80">
              {formatElapsed(openClockEntry.clockIn)}
            </span>
          )}
        </SidebarMenuButton>
      </SidebarMenuItem>

      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip="My Hours"
          isActive={isOnTimeClockPage}
          asChild
        >
          <Link
            to={path.to.timeClockPage}
            onClick={() => isMobile && setOpenMobile(false)}
          >
            <LuClock />
            <span>My Hours</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </>
  );
}
