"use client";

import { useState } from "react";
import type { ApiSamples } from "@/lib/api-types";
import { applyBase, applyConfig, useApiConfig } from "./config-context";
import { MethodBadge } from "./method-badge";

const LANGS: { key: keyof ApiSamples; label: string }[] = [
  { key: "curl", label: "cURL" },
  { key: "javascript", label: "JavaScript" },
  { key: "python", label: "Python" },
  { key: "go", label: "Go" },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      className="absolute top-[10px] right-[10px] z-10 rounded-[6px] border border-[#3A3A38] bg-[#262624] px-[8px] py-[3px] font-[family-name:var(--font-mono)] text-[11px] text-[#C9C9C5] transition-colors hover:border-[#4A4A47] hover:text-white"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[12px] border border-[#0e2a3f] bg-[#011627] shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
      {children}
    </div>
  );
}

export function CodePanel({
  samples,
  highlighted,
  method,
  fullPath,
  response,
  responseHtml,
}: {
  samples: ApiSamples;
  highlighted: Record<keyof ApiSamples, string>;
  method: string;
  fullPath: string;
  response: string;
  responseHtml: string;
}) {
  const [lang, setLang] = useState<keyof ApiSamples>("curl");
  const { base, apiKey } = useApiConfig();

  return (
    <div className="sticky top-[88px] flex flex-col gap-[16px]">
      <Panel>
        <div className="flex h-[44px] items-center justify-between gap-[8px] border-b border-[#0e2a3f] pr-[10px] pl-[14px]">
          <div className="flex min-w-0 items-center gap-[8px]">
            <MethodBadge method={method} />
            <span className="truncate font-[family-name:var(--font-mono)] text-[12px] text-[#9A9A96]">
              {applyBase(fullPath, base)}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-[2px]">
            {LANGS.map((l) => (
              <button
                key={l.key}
                type="button"
                onClick={() => setLang(l.key)}
                className={`rounded-[6px] px-[8px] py-[4px] text-[12px] transition-colors ${
                  lang === l.key ? "bg-[#2E2E2B] text-white" : "text-[#8C8C88] hover:text-[#C9C9C5]"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
        <div className="relative">
          <CopyButton text={applyConfig(samples[lang], base, apiKey)} />
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: build-time shiki HTML */}
          <div className="api-shiki" dangerouslySetInnerHTML={{ __html: applyConfig(highlighted[lang], base, apiKey, true) }} />
        </div>
      </Panel>

      {response ? (
        <Panel>
          <div className="flex h-[40px] items-center border-b border-[#0e2a3f] px-[14px]">
            <span className="font-[family-name:var(--font-mono)] text-[12px] tracking-[0.04em] text-[#9A9A96]">
              Response
            </span>
          </div>
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: build-time shiki HTML */}
          <div className="api-shiki-response" dangerouslySetInnerHTML={{ __html: responseHtml }} />
        </Panel>
      ) : (
        <div className="rounded-[10px] border border-[#E7E7E3] bg-[#FBFBF8] px-[14px] py-[12px] font-[family-name:var(--font-mono)] text-[13px] text-[rgba(38,35,35,0.63)]">
          204 No Content
        </div>
      )}
    </div>
  );
}
