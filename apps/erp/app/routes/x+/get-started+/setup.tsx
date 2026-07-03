import { SetupMapView } from "@carbon/onboarding/ui";
import { useEffect } from "react";
import { useLocation } from "react-router";

// State, flags, and mutations come from <HubProvider> in the layout.
export default function GetStartedSetupRoute() {
  const { hash } = useLocation();

  // Scroll to (and briefly highlight) the group section deep-linked from a
  // Configure task in the Plan view. Mirrors the Plan route's anchor handling.
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

  return <SetupMapView />;
}
