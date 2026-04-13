import { Card, CardContent, CardHeader, CardTitle } from "@carbon/react";
import { Trans } from "@lingui/react/macro";

type PersonDaysOffProps = {};

const PersonDaysOff = (props: PersonDaysOffProps) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Days Off</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-muted-foreground p-4 w-full text-center">
          <Trans>No days off scheduled</Trans>
        </div>
      </CardContent>
    </Card>
  );
};

export default PersonDaysOff;
