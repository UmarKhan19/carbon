import {
  Badge,
  cn,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar
} from "@carbon/react";
import { useEffect, useState } from "react";
import { LuClock, LuCoffee, LuPlay, LuSquare } from "react-icons/lu";
import { Link, useFetcher, useLocation } from "react-router";
import { path } from "~/utils/path";

type TimeClockButtonProps = {
  openClockEntry: {
    id: string;
    clockIn: string;
  } | null;
  breakEntry?: {
    clockOut: string;
  } | null;
};

function formatElapsed(since: string) {
  const ms = Date.now() - new Date(since).getTime();
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

export function TimeClockButton({
  openClockEntry,
  breakEntry
}: TimeClockButtonProps) {
  const fetcher = useFetcher();
  const { isMobile, setOpenMobile } = useSidebar();
  const { pathname } = useLocation();
  const [, setTick] = useState(0);

  const isClockedIn =
    openClockEntry !== null ||
    (fetcher.formData?.get("intent") === "clockIn" && fetcher.state !== "idle");

  const isOnBreak =
    !isClockedIn && breakEntry !== null && breakEntry !== undefined;

  useEffect(() => {
    if (!openClockEntry && !breakEntry) return;
    const interval = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(interval);
  }, [openClockEntry, breakEntry]);

  const handleClockAction = (type: "shift_end" | "break" = "shift_end") => {
    if (isMobile) setOpenMobile(false);
    const formData = new FormData();
    formData.append("intent", "clockOut");
    formData.append("type", type);
    fetcher.submit(formData, {
      method: "post",
      action: path.to.timeclock
    });
  };

  const handleClockIn = () => {
    if (isMobile) setOpenMobile(false);
    const formData = new FormData();
    formData.append("intent", "clockIn");
    fetcher.submit(formData, {
      method: "post",
      action: path.to.timeclock
    });
  };

  const isOnTimeClockPage = pathname.includes("/timeclock");

  return (
    <>
      {isClockedIn ? (
        <>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Clock Out"
              onClick={() => handleClockAction("shift_end")}
              disabled={fetcher.state !== "idle"}
              className="font-medium bg-red-500 text-white hover:bg-red-600 hover:text-white"
            >
              <LuSquare className="size-4" />
              <span>Clock Out</span>
              {openClockEntry && (
                <span className="ml-auto text-xs opacity-80">
                  {formatElapsed(openClockEntry.clockIn)}
                </span>
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Take Break"
              onClick={() => handleClockAction("break")}
              disabled={fetcher.state !== "idle"}
              className="font-medium border-[3px] border-yellow-500 text-yellow-600 bg-transparent hover:bg-yellow-50 hover:text-yellow-700"
            >
              <LuCoffee className="size-4 -ml-[3px]" />
              <span>Break</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </>
      ) : isOnBreak ? (
        <>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Clock Back In"
              onClick={handleClockIn}
              disabled={fetcher.state !== "idle"}
              className="font-medium border-[3px] border-emerald-500 text-emerald-600 bg-transparent hover:bg-emerald-50 hover:text-emerald-700"
            >
              <LuPlay className="size-4 -ml-[3px]" />
              <span>Clock Back In</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <div className="px-2 py-1">
              <Badge
                variant="outline"
                className="text-yellow-600 border-yellow-600 text-xs"
              >
                On Break · {formatElapsed(breakEntry!.clockOut)}
              </Badge>
            </div>
          </SidebarMenuItem>
        </>
      ) : (
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip="Clock In"
            onClick={handleClockIn}
            disabled={fetcher.state !== "idle"}
            className={cn(
              "font-medium",
              "border-[3px] border-emerald-500 text-emerald-600 bg-transparent hover:bg-emerald-50 hover:text-emerald-700"
            )}
          >
            <LuPlay className="size-4 -ml-[3px]" />
            <span>Clock In</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      )}

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
