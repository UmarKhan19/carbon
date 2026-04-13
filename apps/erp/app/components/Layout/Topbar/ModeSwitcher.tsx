import { IconButton } from "@carbon/react";
import { useMode } from "@carbon/remix";
import { useLingui } from "@lingui/react/macro";
import { BiLaptop, BiMoon, BiSun } from "react-icons/bi";
import { useFetcher } from "react-router";
import type { action } from "~/root";
import { path } from "~/utils/path";

const ModeSwitcher = () => {
  const { t } = useLingui();
  const mode = useMode();
  const nextMode = mode === "dark" ? "light" : "dark";
  const modeLabel = {
    light: <BiSun />,
    dark: <BiMoon />,
    system: <BiLaptop />
  };

  const fetcher = useFetcher<typeof action>();

  return (
    <fetcher.Form
      action={path.to.root}
      method="post"
      onSubmit={() => {
        document.body.removeAttribute("style");
      }}
      className="hidden sm:block"
    >
      <input type="hidden" name="mode" value={nextMode} />

      <IconButton
        icon={modeLabel[nextMode]}
        aria-label={t`Light Mode`}
        variant="ghost"
        type="submit"
      />
    </fetcher.Form>
  );
};

export default ModeSwitcher;
