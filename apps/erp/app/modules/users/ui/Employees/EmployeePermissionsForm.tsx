import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
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
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useNavigate } from "react-router";
import type { z } from "zod";
import { Hidden, Select, Submit } from "~/components/Form";
import PermissionMatrix from "~/components/PermissionMatrix";
import {
  fromCompanyPermissions,
  fromEmployeeTypePermissions,
  toCompanyPermissions,
  usePermissionMatrix
} from "~/hooks/usePermissionMatrix";
import type { CompanyPermission } from "~/modules/users";
import { employeeValidator } from "~/modules/users";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type EmployeePermissionsFormProps = {
  name: string;
  employeeTypes: ListItem[];
  initialValues: z.infer<typeof employeeValidator> & {
    permissions: Record<string, CompanyPermission>;
  };
};

const EmployeePermissionsForm = ({
  name,
  employeeTypes,
  initialValues
}: EmployeePermissionsFormProps) => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);

  const employeeTypeOptions =
    employeeTypes?.map((et) => ({
      value: et.id,
      label: et.name
    })) ?? [];

  const { state: initialState, modules } = useMemo(
    () => fromCompanyPermissions(initialValues.permissions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initialValues.permissions]
  );

  const matrix = usePermissionMatrix({
    modules,
    initialState
  });

  // State for employee type change confirmation dialog
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const pendingEmployeeTypeId = useRef<string | null>(null);
  const permissionsFetcher = useFetcher<{
    permissions: Record<string, { name: string; permission: CompanyPermission }>;
  }>();

  // Handle permissions fetch result
  useEffect(() => {
    if (
      permissionsFetcher.state === "idle" &&
      permissionsFetcher.data?.permissions &&
      pendingEmployeeTypeId.current
    ) {
      setShowConfirmDialog(true);
    }
  }, [permissionsFetcher.state, permissionsFetcher.data]);

  const handleEmployeeTypeChange = (
    newValue: { value: string; label: string | JSX.Element } | null
  ) => {
    if (!newValue) return;

    const newEmployeeTypeId = newValue.value;
    if (newEmployeeTypeId && newEmployeeTypeId !== initialValues.employeeType) {
      pendingEmployeeTypeId.current = newEmployeeTypeId;
      permissionsFetcher.load(
        `/api/users/employee-type-permissions?employeeTypeId=${newEmployeeTypeId}`
      );
    }
  };

  const handleConfirmOverwrite = () => {
    if (permissionsFetcher.data?.permissions) {
      const { state: newState } = fromEmployeeTypePermissions(
        permissionsFetcher.data.permissions
      );
      matrix.setPermissions(newState);
    }
    setShowConfirmDialog(false);
    pendingEmployeeTypeId.current = null;
  };

  const handleCancelOverwrite = () => {
    setShowConfirmDialog(false);
    pendingEmployeeTypeId.current = null;
  };

  // Serialize permissions to the format expected by the action
  const permissionsData = JSON.stringify(
    toCompanyPermissions(matrix.permissions)
  );

  return (
    <>
      <Modal
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalContent size="xlarge">
          <ValidatedForm
            validator={employeeValidator}
            method="post"
            action={path.to.employeeAccount(initialValues.id)}
            defaultValues={initialValues}
            className="flex flex-col h-full"
          >
            <ModalHeader>
              <ModalTitle>{name}</ModalTitle>
            </ModalHeader>
            <ModalBody className="max-h-[70dvh] overflow-y-auto">
              <VStack spacing={4}>
                <Select
                  name="employeeType"
                  label={t`Employee Type`}
                  options={employeeTypeOptions}
                  placeholder={t`Select Employee Type`}
                  onChange={handleEmployeeTypeChange}
                />
                <PermissionMatrix matrix={matrix} />
                <Hidden name="id" />
                <Hidden name="data" value={permissionsData} />
              </VStack>
            </ModalBody>
            <ModalFooter>
              <HStack>
                <Submit>
                  <Trans>Save</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={onClose}>
                  <Trans>Cancel</Trans>
                </Button>
              </HStack>
            </ModalFooter>
          </ValidatedForm>
        </ModalContent>
      </Modal>

      <Modal open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            <ModalTitle>
              <Trans>Update Permissions</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <p className="text-sm text-muted-foreground">
              <Trans>
                Do you want to overwrite the user's current permissions with the
                default permissions for this employee type?
              </Trans>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={handleCancelOverwrite}>
              <Trans>Keep Current</Trans>
            </Button>
            <Button variant="primary" onClick={handleConfirmOverwrite}>
              <Trans>Overwrite Permissions</Trans>
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
};

export default EmployeePermissionsForm;
