import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCustomRulesDataForTarget } from "@carbon/ee/custom-rules.server";
import {
  Button,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import RuleAssignmentsList from "~/modules/customRules/ui/RuleAssignmentsList";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory",
    role: "employee"
  });
  const { storageUnitId } = params;
  if (!storageUnitId) throw notFound("storageUnitId required");

  const data = await getCustomRulesDataForTarget(client, {
    targetType: "storageUnit",
    targetId: storageUnitId,
    companyId
  });

  return { storageUnitId, ...data };
}

export default function StorageUnitRulesRoute() {
  const { storageUnitId, assignments, library } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalDrawerContent size="lg">
          <ModalDrawerHeader>
            <ModalDrawerTitle>
              <Trans>Storage unit rules</Trans>
            </ModalDrawerTitle>
          </ModalDrawerHeader>
          <ModalDrawerBody>
            <RuleAssignmentsList
              targetType="storageUnit"
              targetId={storageUnitId}
              assignments={assignments as never}
              library={library as never}
              variant="flat"
            />
          </ModalDrawerBody>
          <ModalDrawerFooter>
            <HStack>
              <Button variant="solid" onClick={onClose}>
                <Trans>Close</Trans>
              </Button>
            </HStack>
          </ModalDrawerFooter>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
}
