import type { AvatarProps } from "@carbon/react";
import { cn, HStack } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { usePeople } from "~/stores";
import Avatar from "./Avatar";

type EmployeeAvatarProps = AvatarProps & {
  employeeId: string | null;
  className?: string;
  withName?: boolean;
};

const EmployeeAvatar = ({
  employeeId,
  size,
  withName = true,
  className,
  ...props
}: EmployeeAvatarProps) => {
  const [people] = usePeople();
  if (!employeeId) return null;

  if (employeeId === "system") {
    return (
      <HStack className="truncate no-underline hover:no-underline">
        <Avatar size={size ?? "xs"} path={undefined} />
        {withName && (
          <span>
            <Trans>System</Trans>
          </span>
        )}
      </HStack>
    );
  }

  const person = people.find((p) => p.id === employeeId);

  if (!person) {
    return <Avatar size={size ?? "xs"} path={undefined} />;
  }

  const isInactive = person.status === "Inactive";

  return (
    <HStack className="truncate no-underline hover:no-underline">
      <Avatar
        size={size ?? "xs"}
        path={person.avatarUrl ?? undefined}
        name={person?.name ?? ""}
      />
      {withName && (
        <span className={cn(isInactive && "text-red-600 dark:text-red-400")}>
          {person.name}
        </span>
      )}
    </HStack>
  );
};

export default EmployeeAvatar;
