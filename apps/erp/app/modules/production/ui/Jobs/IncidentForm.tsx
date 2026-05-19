import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useNavigate } from "react-router";
import type { z } from "zod";
import {
  Boolean,
  DatePicker,
  Hidden,
  InputControlled,
  Number,
  Select,
  Submit
} from "~/components/Form";
import {
  productionIncidentStatuses,
  productionIncidentValidator
} from "~/modules/production/production.models";
import { path } from "~/utils/path";

type IncidentFormProps = {
  jobId: string;
  incidentTypes: Array<{ id: string; name: string }>;
  initialValues: z.infer<typeof productionIncidentValidator>;
};

export default function IncidentForm({
  jobId,
  incidentTypes,
  initialValues
}: IncidentFormProps) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const isEditing = !!(initialValues as { id?: string }).id;

  const onClose = () => navigate(path.to.jobIncidents(jobId));

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <ValidatedForm
          method="post"
          validator={productionIncidentValidator}
          defaultValues={initialValues}
        >
          <ModalHeader>
            <ModalTitle>
              {isEditing ? (
                <Trans>Edit Incident</Trans>
              ) : (
                <Trans>Report Production Incident</Trans>
              )}
            </ModalTitle>
            <ModalDescription>
              <Trans>
                Quantity lost will reduce active picking list line quantities
                for this job when "Affects picking list" is checked.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody className="space-y-4">
            <Hidden name="id" />
            <Hidden name="jobId" value={jobId} />

            <VStack spacing={3}>
              <DatePicker name="incidentDate" label={t`Incident Date`} />

              <Select
                name="incidentTypeId"
                label={t`Incident Type`}
                options={incidentTypes.map((it) => ({
                  value: it.id,
                  label: it.name
                }))}
                isOptional
              />

              <Number
                name="quantityLost"
                label={t`Quantity Lost`}
                minValue={0}
              />

              <InputControlled
                name="position"
                label={t`Position / Location`}
                value={(initialValues as { position?: string }).position ?? ""}
              />

              <Select
                name="status"
                label={t`Status`}
                options={productionIncidentStatuses.map((s) => ({
                  value: s,
                  label: s
                }))}
              />

              <Boolean
                name="impactsPickingList"
                label={t`Affects picking list`}
                description={t`When on, active PL line quantities for this job get reduced by Quantity Lost.`}
              />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Button variant="secondary" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Submit>
                {isEditing ? <Trans>Save</Trans> : <Trans>Report</Trans>}
              </Submit>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
