import { PlanView } from "@carbon/onboarding/ui";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { path } from "~/utils/path";

// Scroll to (and briefly highlight) the step card linked from the hub's
// "View in project plan" deep link. State + mutations come from
// <HubProvider> in the layout.
export default function GetStartedPlanRoute() {
  const { hash } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("ring-2", "ring-primary");
    const t = setTimeout(
      () => el.classList.remove("ring-2", "ring-primary"),
      1600
    );
    return () => clearTimeout(t);
  }, [hash]);

  // In-hub navigation stays in this tab — only external resources (Academy,
  // docs) and Setup Map deep links into ERP screens open new tabs. An anchor id
  // deep-links to the matching Setup Map group (see setup route's scroll effect).
  return (
    <PlanView
      onOpenSetupMap={(anchorId) =>
        navigate(
          `${path.to.getStartedPage("setup")}${anchorId ? `#${anchorId}` : ""}`
        )
      }
    />
  );
}
