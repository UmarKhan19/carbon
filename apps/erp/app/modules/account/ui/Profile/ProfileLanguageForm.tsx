import { ValidatedForm } from "@carbon/form";
import { resolveLanguage } from "@carbon/locale";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Hidden, Select, Submit } from "~/components/Form";
import { path } from "~/utils/path";
import { accountLanguageValidator } from "../../account.models";

const ProfileLanguageForm = ({ locale }: { locale: string }) => {
  const { _: t } = useLingui();

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
          label={t(msg({ id: "Language", message: "Language" }))}
          options={[
            {
              label: t(msg({ id: "English", message: "English" })),
              value: "en"
            },
            { label: t(msg({ id: "Polish", message: "Polish" })), value: "pl" }
          ]}
        />
        <p className="text-sm text-muted-foreground">
          {t(
            msg({
              id: "Choose your preferred language for the interface.",
              message: "Choose your preferred language for the interface."
            })
          )}
        </p>
        <Hidden name="intent" value="locale" />
        <Submit>{t(msg({ id: "Save", message: "Save" }))}</Submit>
      </VStack>
    </ValidatedForm>
  );
};

export default ProfileLanguageForm;
