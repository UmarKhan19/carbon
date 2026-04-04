import { CarbonEdition } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { useMode } from "@carbon/remix";
import { getStripeCustomerByCompanyId } from "@carbon/stripe/stripe.server";
import { Edition } from "@carbon/utils";
import { MeshGradient } from "@paper-design/shaders-react";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { Outlet, redirect } from "react-router";
import { getLocationsList } from "~/modules/resources";
import { getCompany } from "~/modules/settings";
import { onboardingSequence, path } from "~/utils/path";

export const shouldRevalidate: ShouldRevalidateFunction = () => true;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const [company, stripeCustomer, locations] = await Promise.all([
    getCompany(client, companyId),
    getStripeCustomerByCompanyId(companyId, userId),
    getLocationsList(client, companyId)
  ]);

  const pathname = new URL(request.url).pathname;

  if (company.data?.name && locations.data?.length) {
    if (CarbonEdition !== Edition.Cloud || stripeCustomer) {
      throw redirect(path.to.authenticatedRoot);
    }

    if (
      CarbonEdition === Edition.Cloud &&
      pathname !== path.to.onboarding.plan
    ) {
      throw redirect(path.to.onboarding.plan);
    }
  }

  const onboardingSteps =
    CarbonEdition === Edition.Cloud
      ? onboardingSequence
      : onboardingSequence.filter((p) => p !== path.to.onboarding.plan);

  const pathIndex = onboardingSteps.findIndex((p) => p === pathname);

  const previousPath =
    pathIndex === 0 ? undefined : onboardingSteps[pathIndex - 1];

  const nextPath =
    pathIndex === onboardingSteps.length - 1
      ? path.to.authenticatedRoot
      : onboardingSteps[pathIndex + 1];

  return {
    currentIndex: pathIndex,
    onboardingSteps: onboardingSteps.length,
    previousPath,
    nextPath
  };
}

export default function OnboardingLayout() {
  const mode = useMode();

  const meshGradientColors =
    mode === "light"
      ? ["#bdcdff", "#f7f5ff", "#ffffff", "#e6f3ff"]
      : ["#023225", "#000000", "#0D0D0D", "#050505"];

  return (
    <div className="relative h-screen w-screen">
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom_right,#f7f5ff_35.67%,#bdcdff_88.95%)] dark:bg-[linear-gradient(to_bottom_right,#0D0D0D_35.67%,#050505_88.95%)]">
        <MeshGradient
          speed={1}
          colors={meshGradientColors}
          distortion={0.8}
          swirl={0.1}
          grainMixer={0}
          grainOverlay={0}
          className="absolute inset-0 w-full h-full"
          style={{ height: "100%", width: "100%" }}
        />
      </div>
      <div className="relative z-10 flex h-full w-full items-center justify-center p-4">
        <Outlet />
      </div>
    </div>
  );
}
