import { Card, CardContent, CardHeader, CardTitle } from "@carbon/react";
import { Trans } from "@lingui/react/macro";

type PersonOvertimeProps = {};

const PersonOvertime = (props: PersonOvertimeProps) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Overtime</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-muted-foreground p-4 w-full text-center">
          <Trans>No overtime scheduled</Trans>
        </div>
      </CardContent>
    </Card>
  );
};

export default PersonOvertime;
