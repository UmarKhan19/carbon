import { ValidatedForm } from "@carbon/form";
import { resolveLanguage, useTranslation } from "@carbon/locale";
import { VStack } from "@carbon/react";
import { Hidden, Select, Submit } from "~/components/Form";
import { path } from "~/utils/path";
import { accountLanguageValidator } from "../../account.models";

const ProfileLanguageForm = ({ locale }: { locale: string }) => {
  const { t } = useTranslation("shared");

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
          label={t("Language")}
          options={[
            { label: t("English"), value: "en" },
            { label: t("Polish"), value: "pl" }
          ]}
        />
        <p className="text-sm text-muted-foreground">
          {t("Choose your preferred language for the interface.")}
        </p>
        <Hidden name="intent" value="locale" />
        <Submit>{t("Save")}</Submit>
      </VStack>
    </ValidatedForm>
  );
};

export default ProfileLanguageForm;
