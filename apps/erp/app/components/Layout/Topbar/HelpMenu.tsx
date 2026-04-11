import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCircleHelp, LuFiles } from "react-icons/lu";
import { Link } from "react-router";
import { path } from "~/utils/path";

const HelpMenu = () => {
  const { t } = useLingui();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          className="hidden sm:flex"
          aria-label={t`Help`}
          icon={<LuCircleHelp />}
          variant="ghost"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem asChild>
          <Link to={path.to.apiIntroduction}>
            <DropdownMenuIcon icon={<LuFiles />} />
            <Trans>API Docs</Trans>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default HelpMenu;
