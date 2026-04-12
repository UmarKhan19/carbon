import { Heading, useInterval } from "@carbon/react";
import { getLocalTimeZone, now } from "@internationalized/date";
import { useLingui } from "@lingui/react/macro";
import type { ComponentProps } from "react";
import { useMemo, useState } from "react";
import { useUser } from "~/hooks";

export function Greeting(props: ComponentProps<typeof Heading>) {
  const { t } = useLingui();
  const user = useUser();
  const [currentTime, setCurrentTime] = useState(() => now(getLocalTimeZone()));

  useInterval(
    () => {
      setCurrentTime(now(getLocalTimeZone()));
    },
    60 * 60 * 1000
  );

  const greeting = useMemo(() => {
    if (currentTime.hour >= 3 && currentTime.hour < 12) {
      return t`Good morning, ${user.firstName}`;
    } else if (currentTime.hour >= 12 && currentTime.hour < 18) {
      return t`Good afternoon, ${user.firstName}`;
    } else {
      return t`Good evening, ${user.firstName}`;
    }
  }, [currentTime.hour, t, user.firstName]);

  return (
    <Heading size="h3" {...props}>
      {greeting}
    </Heading>
  );
}
