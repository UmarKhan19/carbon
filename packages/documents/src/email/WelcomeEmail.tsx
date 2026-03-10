import { Body, Html, Preview, Text } from "@react-email/components";

export const WelcomeEmail = () => {
  return (
    <Html>
      <Preview>yo i saw that you just signed up for carbon</Preview>
      <Body>
        <Text>
          yo i saw that you just signed up for carbon. appreciate it! let me
          know if you want to meet to talk about anything.
        </Text>
        <Text>— brad</Text>
      </Body>
    </Html>
  );
};

export default WelcomeEmail;
