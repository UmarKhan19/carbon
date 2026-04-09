import { Button as _Button, Heading as _Heading, VStack } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router";
import { onboardingSequence } from "~/utils/path";

const Heading = motion.create(_Heading);
const Button = motion.create(_Button);

const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 }
};

export default function GetStarted() {
  const navigate = useNavigate();

  return (
    <AnimatePresence>
      <VStack spacing={2} className="max-w-lg p-4 items-center text-center">
        <motion.img
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 2, ease: "easeInOut" }}
          src="/carbon-logo-mark.svg"
          alt="Carbon"
          className="w-24 mb-3"
        />

        <Heading
          {...fade}
          transition={{ duration: 1.2, ease: "easeInOut", delay: 1.5 }}
          size="h1"
          className="m-0"
        >
          <Trans>Welcome to Carbon</Trans>
        </Heading>

        <motion.p
          {...fade}
          transition={{ duration: 1.2, ease: "easeInOut", delay: 1.7 }}
          className="text-muted-foreground text-balance text-base pb-4"
        >
          <Trans>The operating system for manufacturing</Trans>
        </motion.p>

        <Button
          {...fade}
          transition={{ duration: 1.2, ease: "easeInOut", delay: 1.9 }}
          size="lg"
          onClick={() => navigate(onboardingSequence[0])}
        >
          <Trans>Get Started</Trans>
        </Button>
      </VStack>
    </AnimatePresence>
  );
}
