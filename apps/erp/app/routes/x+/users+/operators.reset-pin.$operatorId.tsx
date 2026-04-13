import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import {
  Button,
  Copy,
  HStack,
  IconButton,
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuRefreshCw } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData, useNavigate } from "react-router";
import type { Result } from "~/types";
import { path } from "~/utils/path";

function generatePin(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, { update: "users" });

  const { operatorId } = params;
  if (!operatorId) throw new Error("Operator ID is required");

  const user = await client
    .from("user")
    .select("id, firstName, lastName")
    .eq("id", operatorId)
    .single();

  if (user.error || !user.data) {
    throw redirect(
      path.to.operators,
      await flash(request, error(user.error, "Operator not found"))
    );
  }

  return { operator: user.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId } = await requirePermissions(request, {
    update: "users"
  });

  const { operatorId } = params;
  if (!operatorId) throw new Error("Operator ID is required");

  const formData = await request.formData();
  const newPin = formData.get("pin") as string;

  if (!newPin || !/^\d{4}$/.test(newPin)) {
    return { success: false, message: "PIN must be 4 digits" };
  }

  const serviceRole = getCarbonServiceRole();
  const update = await serviceRole
    .from("employee")
    .update({ pin: newPin } as any)
    .eq("id", operatorId)
    .eq("companyId", companyId);

  if (update.error) {
    return { success: false, message: update.error.message };
  }

  throw redirect(
    path.to.operators,
    await flash(request, success("PIN reset successfully"))
  );
}

export default function ResetPinRoute() {
  const { operator } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const formFetcher = useFetcher<Result>();
  const [pinValue, setPinValue] = useState(generatePin);
  const { t } = useLingui();

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) navigate(-1);
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <formFetcher.Form method="post" className="flex flex-col h-full">
          <ModalHeader>
            <ModalTitle>
              <Trans>
                Reset PIN for {operator.firstName} {operator.lastName}
              </Trans>
            </ModalTitle>
          </ModalHeader>

          <ModalBody>
            <VStack spacing={4}>
              <p className="text-sm text-muted-foreground">
                <Trans>
                  Generate a new 4-digit PIN. Share it with the operator so they
                  can pin in at MES terminals.
                </Trans>
              </p>
              <div className="space-y-2 w-full">
                <Label>
                  <Trans>New PIN</Trans>
                </Label>
                <div className="flex items-center justify-center gap-3">
                  <input type="hidden" name="pin" value={pinValue} />
                  <InputOTP
                    maxLength={4}
                    value={pinValue}
                    onChange={(value) => setPinValue(value)}
                    autoFocus={false}
                  >
                    <InputOTPGroup>
                      <InputOTPSlot index={0} />
                      <InputOTPSlot index={1} />
                      <InputOTPSlot index={2} />
                      <InputOTPSlot index={3} />
                    </InputOTPGroup>
                  </InputOTP>
                  <Copy text={pinValue} size="sm" />
                  <IconButton
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={t`Generate new PIN`}
                    icon={<LuRefreshCw />}
                    onClick={() => {
                      const newPin = generatePin();
                      setPinValue(newPin);
                    }}
                  />
                </div>
              </div>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Button
                type="submit"
                isLoading={formFetcher.state !== "idle"}
                isDisabled={formFetcher.state !== "idle" || pinValue.length < 4}
              >
                <Trans>Reset PIN</Trans>
              </Button>
            </HStack>
          </ModalFooter>
        </formFetcher.Form>
      </ModalContent>
    </Modal>
  );
}
