import { InputControlled, ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Heading,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuCheckCheck,
  LuCircleStop,
  LuLoaderCircle,
  LuPlay,
  LuTrash
} from "react-icons/lu";
import { useFetcher } from "react-router";
import type { z } from "zod";
import { DocumentHeader } from "~/components";
import {
  DatePicker,
  Employee,
  Hidden,
  Location,
  Submit,
  TextArea
} from "~/components/Form";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { pickingListValidator } from "../../inventory.models";
import type { getPickingList } from "../../inventory.service";
import PickingListStatus from "./PickingListStatus";

type PickingListData = NonNullable<
  Awaited<ReturnType<typeof getPickingList>>["data"]
>;

type PickingListFormProps = {
  initialValues: z.infer<typeof pickingListValidator>;
  pickingList?: PickingListData;
};

const PickingListForm = ({
  initialValues,
  pickingList
}: PickingListFormProps) => {
  const permissions = usePermissions();
  const statusFetcher = useFetcher();
  const deleteModal = useDisclosure();
  const { t } = useLingui();

  const isEditing = !!initialValues.id;
  const isLocked =
    pickingList?.status !== undefined &&
    !["Draft"].includes(pickingList.status);
  const canEdit = isEditing
    ? permissions.can("update", "inventory") &&
      ["Draft"].includes(pickingList?.status ?? "")
    : permissions.can("create", "inventory");

  return (
    <>
      <ValidatedForm
        validator={pickingListValidator}
        method="post"
        defaultValues={initialValues}
        className="w-full"
        isDisabled={isEditing && isLocked}
      >
        <Card className="w-full">
          {isEditing && pickingList ? (
            <DocumentHeader
              title={pickingList.pickingListId ?? ""}
              status={<PickingListStatus status={pickingList.status} />}
              menuItems={
                <>
                  <DropdownMenuItem
                    disabled={
                      ["Draft"].includes(pickingList.status ?? "") ||
                      statusFetcher.state !== "idle" ||
                      !permissions.can("update", "inventory")
                    }
                    onClick={() => {
                      statusFetcher.submit(
                        { status: "Draft" },
                        {
                          method: "post",
                          action: path.to.pickingListStatus(pickingList.id)
                        }
                      );
                    }}
                  >
                    <DropdownMenuIcon icon={<LuLoaderCircle />} />
                    <Trans>Reopen</Trans>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={
                      isLocked ||
                      !permissions.can("delete", "inventory") ||
                      !permissions.is("employee")
                    }
                    destructive
                    onClick={deleteModal.onOpen}
                  >
                    <DropdownMenuIcon icon={<LuTrash />} />
                    <Trans>Delete Picking List</Trans>
                  </DropdownMenuItem>
                </>
              }
              actions={
                <>
                  <Button
                    type="button"
                    leftIcon={<LuPlay />}
                    variant={
                      pickingList.status === "Draft" ? "primary" : "secondary"
                    }
                    isDisabled={
                      !["Draft"].includes(pickingList.status) ||
                      statusFetcher.state !== "idle" ||
                      !permissions.can("update", "inventory")
                    }
                    isLoading={
                      statusFetcher.state !== "idle" &&
                      statusFetcher.formData?.get("status") === "In Progress"
                    }
                    onClick={() => {
                      statusFetcher.submit(
                        { status: "In Progress" },
                        {
                          method: "post",
                          action: path.to.pickingListStatus(pickingList.id)
                        }
                      );
                    }}
                  >
                    <Trans>Start Picking</Trans>
                  </Button>

                  <Button
                    type="button"
                    leftIcon={<LuCheckCheck />}
                    variant={
                      pickingList.status === "In Progress"
                        ? "primary"
                        : "secondary"
                    }
                    isDisabled={
                      !["In Progress"].includes(pickingList.status) ||
                      statusFetcher.state !== "idle" ||
                      !permissions.can("update", "inventory")
                    }
                    isLoading={
                      statusFetcher.state !== "idle" &&
                      statusFetcher.formData?.get("status") === "Completed"
                    }
                    onClick={() => {
                      statusFetcher.submit(
                        { status: "Completed" },
                        {
                          method: "post",
                          action: path.to.pickingListStatus(pickingList.id)
                        }
                      );
                    }}
                  >
                    <Trans>Complete</Trans>
                  </Button>

                  <Button
                    type="button"
                    variant="secondary"
                    leftIcon={<LuCircleStop />}
                    isDisabled={
                      ["Cancelled", "Completed"].includes(pickingList.status) ||
                      statusFetcher.state !== "idle" ||
                      !permissions.can("update", "inventory")
                    }
                    isLoading={
                      statusFetcher.state !== "idle" &&
                      statusFetcher.formData?.get("status") === "Cancelled"
                    }
                    onClick={() => {
                      statusFetcher.submit(
                        { status: "Cancelled" },
                        {
                          method: "post",
                          action: path.to.pickingListStatus(pickingList.id)
                        }
                      );
                    }}
                  >
                    <Trans>Cancel</Trans>
                  </Button>
                </>
              }
            />
          ) : (
            <CardHeader>
              <Heading as="h1" size="h3">
                <Trans>New Picking List</Trans>
              </Heading>
            </CardHeader>
          )}

          <CardContent>
            <Hidden name="id" />
            <VStack spacing={4}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full items-start">
                {isEditing ? (
                  <InputControlled
                    name="pickingListId"
                    label={t`Picking List ID`}
                    isReadOnly
                    value={initialValues.pickingListId!}
                  />
                ) : null}
                <Location name="locationId" label={t`Location`} />
                <Employee name="assignee" label={t`Assignee`} />
                <DatePicker name="dueDate" label={t`Due Date`} />
              </div>
              <TextArea name="notes" label={t`Notes`} />
            </VStack>
          </CardContent>

          <CardFooter>
            <Submit disabled={!canEdit}>
              <Trans>Save</Trans>
            </Submit>
          </CardFooter>
        </Card>
      </ValidatedForm>

      {deleteModal.isOpen && pickingList && (
        <ConfirmDelete
          action={path.to.pickingListDelete(pickingList.id)}
          isOpen={deleteModal.isOpen}
          name={pickingList.pickingListId ?? "picking list"}
          text={t`Are you sure you want to delete ${pickingList.pickingListId}? This cannot be undone.`}
          onCancel={() => {
            deleteModal.onClose();
          }}
          onSubmit={() => {
            deleteModal.onClose();
          }}
        />
      )}
    </>
  );
};

export default PickingListForm;
