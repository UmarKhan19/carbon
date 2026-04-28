import { ValidatedForm } from "@carbon/form";
import { resolveLanguage } from "@carbon/locale";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { Hidden, Select, Submit } from "~/components/Form";
import { path } from "~/utils/path";
import { accountLanguageValidator } from "../../account.models";

const ProfileLanguageForm = ({ locale }: { locale: string }) => {
  const { t } = useLingui();

  const options = useMemo(() => {
    const items = [
      { label: t`English`, value: "en" },
      { label: t`French`, value: "fr" },
      { label: t`German`, value: "de" },
      { label: t`Spanish`, value: "es" },
      { label: t`Italian`, value: "it" },
      { label: t`Japanese`, value: "ja" },
      { label: t`Polish`, value: "pl" },
      { label: t`Portuguese`, value: "pt" },
      { label: t`Russian`, value: "ru" },
      { label: t`Chinese`, value: "zh" },
      { label: t`Hindi`, value: "hi" }
    ];
    return items.sort((a, b) => a.label.localeCompare(b.label, locale));
  }, [t, locale]);

  return (
    <ValidatedForm
      method="post"
      action={path.to.profile}
      validator={accountLanguageValidator}
      defaultValues={{
        locale: resolveLanguage(locale)
      }}
      className="w-full"
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Language</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>Choose your preferred language for the interface.</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select name="locale" label={t`Language`} options={options} />
          <Hidden name="intent" value="locale" />
        </CardContent>
        <CardFooter>
          <Submit>
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </Card>
    </ValidatedForm>
  );
};

export default ProfileLanguageForm;
