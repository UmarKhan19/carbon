import {
  Avatar,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack
} from "@carbon/react";
import { useMode } from "@carbon/remix";
import { Trans, useLingui } from "@lingui/react/macro";
import { BsFillHexagonFill } from "react-icons/bs";
import { LuChevronsUpDown, LuHouse } from "react-icons/lu";
import { Form, Link } from "react-router";
import { useRouteData, useUser } from "~/hooks";
import type { Company } from "~/modules/settings";
import { path } from "~/utils/path";

const CompanySwitcher = () => {
  const { t } = useLingui();
  const routeData = useRouteData<{ company: Company; companies: Company[] }>(
    path.to.authenticatedRoot
  );
  const user = useUser();
  const mode = useMode();

  const hasMultipleCompanies = Boolean(
    routeData?.companies && routeData?.companies.length > 1
  );

  const canSwitchCompany = hasMultipleCompanies;

  if (!canSwitchCompany) {
    // Just show the company logo without dropdown
    const logo =
      mode === "dark"
        ? user.company?.logoDarkIcon
        : user.company?.logoLightIcon;

    return (
      <Button isIcon asChild variant="ghost" size="lg">
        <Link to="/">
          {logo ? (
            <img
              src={logo}
              alt={`${user.company.name} logo`}
              className="w-full h-auto rounded"
            />
          ) : (
            <BsFillHexagonFill />
          )}
        </Link>
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="px-2 focus-visible:ring-transparent"
          rightIcon={<LuChevronsUpDown />}
        >
          {(() => {
            const logo =
              mode === "dark"
                ? user.company?.logoDarkIcon
                : user.company?.logoLightIcon;
            return logo ? (
              <img
                src={logo}
                alt={`${user.company.name} logo`}
                className="w-full h-auto rounded"
              />
            ) : (
              <BsFillHexagonFill />
            );
          })()}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[240px]">
        <DropdownMenuItem asChild>
          <Link to={path.to.authenticatedRoot}>
            <DropdownMenuIcon icon={<LuHouse />} />
            <Trans>Dashboard</Trans>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuLabel>{t`Companies`}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {routeData?.companies.map((c) => {
            const logo = mode === "dark" ? c.logoDarkIcon : c.logoLightIcon;
            const isCurrent = c.companyId === user.company.id;

            return (
              <Form
                key={c.companyId}
                method="post"
                action={path.to.companySwitch(c.companyId!)}
              >
                <DropdownMenuItem
                  className="flex items-center justify-between w-full"
                  asChild
                  disabled={isCurrent}
                >
                  <button type="submit">
                    <HStack>
                      <Avatar
                        size="xs"
                        name={c.name ?? undefined}
                        src={logo ?? undefined}
                      />
                      <span>{c.name}</span>
                    </HStack>
                    <Badge variant="secondary" className="ml-2">
                      {c.employeeType}
                    </Badge>
                  </button>
                </DropdownMenuItem>
              </Form>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default CompanySwitcher;
