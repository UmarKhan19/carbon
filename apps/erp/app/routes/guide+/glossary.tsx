import type { MetaFunction } from "react-router";
import { GuideChapter } from "./components/GuideChapter";
import { getChapter } from "./guide-content";

const chapter = getChapter("glossary")!;

export const meta: MetaFunction = () => [
  { title: `${chapter.title} — Carbon Guide` },
  { name: "description", content: chapter.summary }
];

export default function GlossaryGuide() {
  return <GuideChapter chapter={chapter} />;
}
