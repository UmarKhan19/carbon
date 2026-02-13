import { ValidatedForm } from "@carbon/form";
import { Card, CardContent, CardHeader, CardTitle } from "@carbon/react";
import { useState } from "react";
import type { z } from "zod";
import {
  CustomFormFields,
  DatePicker,
  Employee,
  Hidden,
  Input,
  Location,
  Shift,
  Submit
} from "~/components/Form";
import { employeeJobValidator } from "../../people.models";

type PersonJobProps = {
  initialValues: z.infer<typeof employeeJobValidator>;
};

const PersonJob = ({ initialValues }: PersonJobProps) => {
  const [location, setLocation] = useState<string | null>(
    initialValues.locationId ?? null
  );
  return (
    <ValidatedForm
      validator={employeeJobValidator}
      method="post"
      defaultValues={initialValues}
    >
      <Card>
        <CardHeader>
          <CardTitle>Job</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input name="title" label="Title" />
            <DatePicker name="startDate" label="Start Date" />
            <Location
              name="locationId"
              label="Location"
              onChange={(l) => setLocation(l?.value ?? null)}
            />
            <Shift
              location={location ?? undefined}
              name="shiftId"
              label="Shift"
            />
            <Employee name="managerId" label="Manager" />
            <Hidden name="intent" value="job" />
            <CustomFormFields table="employeeJob" />
          </div>
          <div>
            <Submit>Save</Submit>
          </div>
        </CardContent>
      </Card>
    </ValidatedForm>
  );
};

export default PersonJob;
