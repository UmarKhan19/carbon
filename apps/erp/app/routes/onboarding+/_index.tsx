import { Button as _Button } from "@carbon/react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { LuBookOpen, LuChevronRight, LuPlay } from "react-icons/lu";
import { useNavigate } from "react-router";
import { onboardingSequence } from "~/utils/path";

const Button = motion.create(_Button);

// Linear-style easing: slow start, fast middle, gentle land
const ease = [0.25, 0.1, 0.25, 1] as const;

function DiscordLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 15 12"
      className={className}
    >
      <path
        d="M 12.708 0.993 C 11.74 0.538 10.719 0.214 9.669 0.028 C 9.649 0.024 9.629 0.034 9.62 0.052 C 9.481 0.31 9.354 0.576 9.241 0.848 C 8.094 0.672 6.952 0.672 5.828 0.848 C 5.726 0.597 5.575 0.291 5.443 0.052 C 5.433 0.034 5.414 0.025 5.394 0.028 C 4.344 0.213 3.323 0.538 2.355 0.993 C 2.346 0.997 2.339 1.003 2.335 1.011 C 0.399 3.973 -0.132 6.862 0.128 9.715 C 0.13 9.729 0.137 9.742 0.148 9.751 C 1.425 10.711 2.662 11.294 3.877 11.681 C 3.896 11.687 3.917 11.68 3.929 11.663 C 4.217 11.262 4.472 10.837 4.692 10.393 C 4.698 10.38 4.699 10.366 4.694 10.353 C 4.689 10.34 4.679 10.33 4.666 10.325 C 4.264 10.168 3.874 9.978 3.501 9.757 C 3.487 9.748 3.479 9.734 3.478 9.717 C 3.477 9.701 3.484 9.685 3.496 9.675 C 3.575 9.615 3.652 9.553 3.728 9.49 C 3.741 9.478 3.76 9.476 3.776 9.483 C 6.22 10.626 8.866 10.626 11.281 9.483 C 11.297 9.475 11.316 9.478 11.33 9.489 C 11.405 9.552 11.483 9.615 11.562 9.675 C 11.575 9.685 11.582 9.701 11.581 9.717 C 11.58 9.734 11.571 9.748 11.558 9.757 C 11.185 9.979 10.796 10.169 10.392 10.325 C 10.38 10.33 10.37 10.34 10.365 10.353 C 10.36 10.366 10.361 10.38 10.367 10.393 C 10.59 10.834 10.845 11.259 11.129 11.663 C 11.141 11.68 11.162 11.687 11.181 11.681 C 12.402 11.294 13.639 10.711 14.916 9.751 C 14.927 9.742 14.934 9.729 14.936 9.715 C 15.247 6.417 14.414 3.552 12.728 1.011 C 12.724 1.003 12.717 0.997 12.708 0.993 Z M 5.057 7.978 C 4.321 7.978 3.715 7.286 3.715 6.436 C 3.715 5.587 4.309 4.895 5.057 4.895 C 5.81 4.895 6.411 5.593 6.399 6.436 C 6.399 7.286 5.804 7.978 5.057 7.978 Z M 10.019 7.978 C 9.283 7.978 8.677 7.286 8.677 6.436 C 8.677 5.587 9.271 4.895 10.019 4.895 C 10.772 4.895 11.373 5.593 11.361 6.436 C 11.361 7.286 10.772 7.978 10.019 7.978 Z"
        fill="currentColor"
      />
    </svg>
  );
}

// Linear-style text reveal: each word fades up individually
function WordReveal({
  children,
  delay,
  className
}: {
  children: string;
  delay: number;
  className?: string;
}) {
  const words = children.split(" ");
  return (
    <span className={className}>
      {words.map((word, i) => (
        <span key={i} className="inline-block overflow-hidden">
          <motion.span
            className="inline-block"
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: "0%", opacity: 1 }}
            transition={{
              duration: 0.6,
              ease,
              delay: delay + i * 0.04
            }}
          >
            {word}
            {i < words.length - 1 ? "\u00A0" : ""}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

export default function GetStarted() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState(0);

  // Orchestrated reveal: brief pause then content
  useEffect(() => {
    const timer = setTimeout(() => setPhase(1), 300);
    return () => clearTimeout(timer);
  }, []);

  return (
    <AnimatePresence>
      <div className="flex items-center justify-center w-full">
        {phase >= 1 && (
          <div className="flex flex-col justify-start items-center gap-8 container mx-auto px-4">
            {/* Discord — animates in last */}
            <motion.div
              initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 0.6, ease, delay: 1.4 }}
            >
              <Button
                variant="outline"
                size="md"
                leftIcon={<DiscordLogo className="text-[#5865f2]" />}
                rightIcon={<LuChevronRight />}
                isRound
                asChild
              >
                <a
                  href="https://discord.gg/yGUJWhNqzy"
                  target="_blank"
                  rel="noopener"
                >
                  Join our Discord community
                </a>
              </Button>
            </motion.div>

            {/* Heading — word-by-word reveal */}
            <motion.h2 className="text-[#212278] dark:text-white text-balance mx-auto max-w-5xl text-center font-medium tracking-tighter text-balance leading-[105%] text-[2.6rem] sm:text-6xl lg:text-[5rem]">
              <WordReveal delay={0.15}>Welcome to the future</WordReveal>{" "}
              <WordReveal
                delay={0.35}
                className="text-[#5b42fe] dark:text-[#60ffd2]"
              >
                of manufacturing ERP
              </WordReveal>
            </motion.h2>

            {/* Subtitle — slides up with blur */}
            <motion.p
              className="text-muted-foreground dark:text-foreground text-balance mx-auto max-w-[780px] text-center font-medium tracking-tighter text-base md:text-lg lg:text-xl"
              initial={{ opacity: 0, y: 24, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 0.8, ease, delay: 0.7 }}
            >
              Carbon is a manufacturing system of record that combines ERP, MES,
              and QMS into a single, unified, API-first system that's perfect
              for complex manufacturing.
            </motion.p>

            {/* Buttons — staggered fade up */}
            <motion.div
              className="flex items-center justify-center gap-4"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease, delay: 0.95 }}
            >
              <Button
                size="lg"
                rightIcon={<LuPlay />}
                onClick={() => navigate(onboardingSequence[0])}
                className="!bg-none !bg-[#5b42fe] dark:!bg-[#60ffd2] hover:!bg-[#5b42fe]/90 dark:hover:!bg-[#60ffd2]/90 text-white dark:text-black px-8"
              >
                Get Started
              </Button>

              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, ease, delay: 1.2 }}
              >
                <Button
                  size="lg"
                  leftIcon={<LuBookOpen />}
                  variant="outline"
                  asChild
                >
                  <a
                    href="https://app.carbon.ms/docs/js/intro"
                    target="_blank"
                    rel="noopener"
                  >
                    API Docs
                  </a>
                </Button>
              </motion.div>
            </motion.div>
          </div>
        )}
      </div>
    </AnimatePresence>
  );
}
