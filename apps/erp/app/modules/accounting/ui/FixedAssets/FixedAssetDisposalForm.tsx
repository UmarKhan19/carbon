import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack
} from "@carbon/react";
import { useFetcher } from "react-router";
import { DatePicker, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { fixedAssetDisposalValidator } from "../../fixedAssets.models";

type FixedAssetDisposalFormProps = {
  currentNBV: number;
  onClose: () => void;
};

const FixedAssetDisposalForm = ({
  currentNBV,
  onClose
}: FixedAssetDisposalFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher();

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={fixedAssetDisposalValidator}
            method="post"
            fetcher={fetcher}
            className="flex flex-col h-full"
            defaultValues={{
              disposalDate: ""
            }}
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>Dispose Asset</ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <VStack spacing={4}>
                <div className="text-sm text-muted-foreground">
                  Current Net Book Value:{" "}
                  <span className="font-medium text-foreground">
                    {currentNBV.toFixed(2)}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  This will write off the remaining book value of the asset.
                </p>
                <DatePicker name="disposalDate" label="Disposal Date" />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={!permissions.can("update", "accounting")}>
                  Dispose
                </Submit>
                <Button size="md" variant="solid" onClick={() => onClose?.()}>
                  Cancel
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default FixedAssetDisposalForm;
