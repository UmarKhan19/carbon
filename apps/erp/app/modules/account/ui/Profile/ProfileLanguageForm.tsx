import { ValidatedForm } from "@carbon/form";
import { resolveLanguage } from "@carbon/locale";
import { VStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { Hidden, Select, Submit } from "~/components/Form";
import { path } from "~/utils/path";
import { accountLanguageValidator } from "../../account.models";

const ProfileLanguageForm = ({ locale }: { locale: string }) => {
  const { t } = useLingui();

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
      <VStack spacing={4}>
        <Select
          name="locale"
          label={t({ id: "Language", message: "Language" })}
          options={[
            {
              label: t({ id: "English", message: "English" }),
              value: "en"
            },
            { label: t({ id: "Polish", message: "Polish" }), value: "pl" }
          ]}
        />
        <p className="text-sm text-muted-foreground">
          {t({
            id: "Choose your preferred language for the interface.",
            message: "Choose your preferred language for the interface."
          })}
        </p>
        <Hidden name="intent" value="locale" />
        <Submit>{t({ id: "Save", message: "Save" })}</Submit>
      </VStack>
    </ValidatedForm>
  );
};

export default ProfileLanguageForm;
