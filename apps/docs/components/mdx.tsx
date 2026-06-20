import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import type { ComponentProps } from "react";
import { MdxCodeBlock } from "@/components/api/mdx-code-block";
import { Checklist, Check } from "@/components/checklist";
// Editorial Callout/Card so the Reference matches the Guide (not Fumadocs defaults).
import { Callout, Card, Cards, EnvVar, EnvVars } from "@/components/editorial/reference-components";
import { FeatureCallout } from "@/components/feature-callout";
import { Frame } from "@/components/frame";
import { Eyebrow } from "@/components/prose";
import { ScrollReveal } from "@/components/scroll-reveal";

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    // Fenced code → our dark API-playground panel (not Fumadocs' default block).
    pre: ({ title, children }: ComponentProps<"pre">) => (
      <MdxCodeBlock title={typeof title === "string" ? title : undefined}>{children}</MdxCodeBlock>
    ),
    Card,
    Cards,
    Callout,
    EnvVar,
    EnvVars,
    Step,
    Steps,
    Tab,
    Tabs,
    ScrollReveal,
    FeatureCallout,
    Checklist,
    Check,
    Frame,
    Eyebrow,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;
