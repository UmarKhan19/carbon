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
import { Trans, useLingui } from "@lingui/react/macro";
import { useFetcher } from "react-router";
import type { z } from "zod";
import { Hidden, Input, Location, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { shelfValidator } from "~/modules/inventory";
import { path } from "~/utils/path";

type ShelfFormProps = {
  locationId: string;
  initialValues: z.infer<typeof shelfValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: () => void;
};

const ShelfForm = ({
  locationId,
  initialValues,
  open = true,
  type = "drawer",
  onClose
}: ShelfFormProps) => {
  const fetcher = useFetcher<{}>();
  const { t } = useLingui();

  const permissions = usePermissions();
  const isEditing = !!initialValues?.id;
  const isDisabled = isEditing
    ? !permissions.can("update", "sales")
    : !permissions.can("create", "sales");

  return (
    <ModalDrawerProvider type={type}>
      <ModalDrawer
        open={open}
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={shelfValidator}
            method="post"
            action={
              isEditing ? path.to.shelf(initialValues.id!) : path.to.newShelf
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            onSubmit={() => {
              if (type === "modal") {
                onClose?.();
              }
            }}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? t`Edit Shelf` : t`New Shelf`}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />

              <VStack spacing={4}>
                <Input name="name" label={t`Name`} />
                <Location
                  isReadOnly={isEditing}
                  name="locationId"
                  label={t`Location`}
                />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>
                  <Trans>Save</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={onClose}>
                  <Trans>Cancel</Trans>
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default ShelfForm;
