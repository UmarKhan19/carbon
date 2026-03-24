"use client";

import { Avatar } from "@carbon/react";
import { useState } from "react";
import { LuChevronDown, LuUser } from "react-icons/lu";
import type { PinnedInUser } from "~/types";
import { PinInOverlay } from "./PinInOverlay";

export function ConsolePill({
  user,
  companyId,
  locationEmployeeIds,
  sessionUserId
}: {
  user: PinnedInUser | null;
  companyId: string;
  locationEmployeeIds: string[];
  sessionUserId: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed top-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-full border bg-card/90 backdrop-blur-md px-3 py-1.5 shadow-lg transition-all duration-200 hover:shadow-xl active:scale-[0.98] select-none"
      >
        {user ? (
          <>
            <Avatar
              size="xs"
              name={user.name}
              src={user.avatarUrl ?? undefined}
            />
            <span className="text-xs font-medium max-w-[130px] truncate">
              {user.name}
            </span>
          </>
        ) : (
          <>
            <LuUser className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">
              Pin In
            </span>
          </>
        )}
        <LuChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>

      {open && (
        <PinInOverlay
          companyId={companyId}
          locationEmployeeIds={locationEmployeeIds}
          sessionUserId={sessionUserId}
          hasPinnedUser={!!user}
          dismissable
          onDismiss={() => setOpen(false)}
        />
      )}
    </>
  );
}
