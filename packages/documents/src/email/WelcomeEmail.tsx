import {
  Body,
  Container,
  Heading,
  Hr,
  Preview,
  Section,
  Text
} from "@react-email/components";
import { Logo } from "./components/Logo";
import {
  EmailThemeProvider,
  getEmailInlineStyles,
  getEmailThemeClasses
} from "./components/Theme";

interface Props {
  firstName?: string;
}

export const WelcomeEmail = ({ firstName }: Props = {}) => {
  const greeting = `Hey${firstName ? ` ${firstName}` : ""}`;
  const preview = `${greeting} — thanks for signing up for Carbon.`;
  const themeClasses = getEmailThemeClasses();
  const lightStyles = getEmailInlineStyles("light");

  return (
    <EmailThemeProvider preview={<Preview>{preview}</Preview>} disableDarkMode>
      <Body
        className={`my-auto mx-auto font-sans ${themeClasses.body}`}
        style={{ backgroundColor: "#f5f5f7" }}
      >
        <Container
          className={`my-[40px] mx-auto p-[36px] max-w-[560px] rounded-[16px] ${themeClasses.container}`}
          style={{
            borderStyle: "solid",
            borderWidth: 1,
            borderColor: "#e5e7eb",
            borderRadius: 16,
            backgroundColor: "#ffffff"
          }}
        >
          <Logo />

          <Heading
            className={`text-[24px] font-normal text-center tracking-tight p-0 mt-[40px] mb-[40px] mx-0 ${themeClasses.heading}`}
            style={{ color: lightStyles.text.color }}
          >
            Welcome to Carbon
          </Heading>

          <Section>
            <Text
              className={`text-[15px] leading-[26px] m-0 mb-[16px] ${themeClasses.text}`}
              style={{ color: lightStyles.text.color }}
            >
              {greeting} — I saw you just signed up for Carbon. Appreciate it!
              Let me know if you want to meet or talk about anything.
            </Text>

            <Text
              className={`text-[14px] leading-[24px] italic m-0 ${themeClasses.mutedText}`}
              style={{ color: lightStyles.mutedText.color }}
            >
              This is an automated email, but I'll respond to anything you send
              me.
            </Text>
          </Section>

          <Hr
            className={`my-[32px] ${themeClasses.border}`}
            style={{ borderColor: "#ececef" }}
          />

          <Section>
            <Text
              className={`text-[15px] m-0 mb-[2px] ${themeClasses.text}`}
              style={{ color: lightStyles.text.color }}
            >
              Thank you,
            </Text>
            <Text
              className={`text-[15px] m-0 mb-[2px] ${themeClasses.text}`}
              style={{ color: lightStyles.text.color }}
            >
              — Chase
            </Text>
            <Text
              className={`text-[13px] m-0 ${themeClasses.mutedText}`}
              style={{ color: lightStyles.mutedText.color }}
            >
              Co-Founder and CEO, Carbon
            </Text>
          </Section>
        </Container>
      </Body>
    </EmailThemeProvider>
  );
};

export default WelcomeEmail;
