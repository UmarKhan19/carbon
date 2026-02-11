import { Button, ClientOnly } from "@carbon/react";
import { LuEye, LuTable2 } from "react-icons/lu";
import type { MetaFunction } from "react-router";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { GroupedContentSidebar } from "~/components/Layout";
import { CollapsibleSidebarProvider } from "~/components/Layout/Navigation";
import { useSwaggerDocs } from "~/hooks/useSwaggerDocs";
import type { ValidLang } from "~/modules/api";
import { useSelectedLang } from "~/modules/api";
import DocsStyle from "~/styles/docs.css?url";
import type { RouteGroup } from "~/types";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | API Docs" }];
};

export const handle: Handle = {
  breadcrumb: "API Docs",
  to: path.to.apiIntroduction,
  module: "api"
};

export function links() {
  return [{ rel: "stylesheet", href: DocsStyle }];
}

export default function ApiDocsRoute() {
  const groups = useApiDocsMenu();
  const selectedLang = useSelectedLang();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const onChangeLanguage = (newLang: ValidLang) => {
    if (newLang === selectedLang) return;
    let newPath = "";
    switch (selectedLang) {
      case "bash":
        newPath = pathname.replace("/bash/", `/${newLang}/`);
        navigate(newPath);
        break;
      case "js":
        newPath = pathname.replace("/js/", `/${newLang}/`);
        navigate(newPath);
        break;
      default:
        throw new Error(`Invalid language: ${selectedLang}`);
    }
  };

  return (
    <CollapsibleSidebarProvider>
      <div className="flex flex-col h-screen">
        <div className="bg-background border-b h-[var(--header-height)] col-span-full px-6 items-center flex flex-shrink-0">
          <Link to={path.to.authenticatedRoot}>
            <img
              src="/carbon-word-light.svg"
              alt="Carbon Logo"
              className="h-6 dark:hidden z-50"
            />
            <img
              src="/carbon-word-dark.svg"
              alt="Carbon Logo"
              className="h-6 dark:block hidden z-50"
            />
          </Link>
        </div>
        <div className="relative grid grid-cols-[auto_1fr] w-full h-full">
          <div className="flex absolute top-2 right-2 z-50 gap-2">
            <Button
              variant={selectedLang === "js" ? "primary" : "secondary"}
              onClick={() => {
                onChangeLanguage("js");
              }}
            >
              JS
            </Button>
            <Button
              variant={selectedLang === "bash" ? "primary" : "secondary"}
              onClick={() => {
                onChangeLanguage("bash");
              }}
            >
              Bash
            </Button>
          </div>
          <GroupedContentSidebar groups={groups} width={270} exactMatch />
          <div className="Docs Docs--api-page w-full h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
            <div className="Docs--inner-wrapper pt-4">
              <ClientOnly>{() => <Outlet />}</ClientOnly>
            </div>
          </div>
        </div>
      </div>
    </CollapsibleSidebarProvider>
  );
}

const tableBlacklist = new Set([
  "apiKey",
  "challengeAttempt",
  "documentTransaction",
  "feedback",
  "groups_recursive",
  "invite",
  "lessonCompletion",
  "oauthClient",
  "oauthCode",
  "oauthToken",
  "purchaseOrderTransaction",
  "salesOrderTransaction",
  "search"
]);

function useApiDocsMenu(): RouteGroup[] {
  const swaggerDocsSchema = useSwaggerDocs();
  const selectedLang = useSelectedLang();
  const result: RouteGroup[] = [
    {
      name: "Getting Started",
      routes: [
        {
          name: "Introduction",
          to: path.to.apiIntro(selectedLang)
        }
      ]
    }
  ];

  const tables = Object.keys(swaggerDocsSchema?.definitions ?? {}).sort();
  const isTable = (table: string): boolean => {
    if (!swaggerDocsSchema?.paths) return false;
    const tableKey = `/${table}`;
    return Object.keys(swaggerDocsSchema.paths[tableKey] ?? {}).some(
      (x) => x.toUpperCase() === "POST"
    );
  };

  result.push({
    name: "Tables and Views",
    routes: tables
      .filter((table) => !tableBlacklist.has(table))
      .map((table) => ({
        name: table,
        to: path.to.apiTable(selectedLang, table),
        icon: isTable(table) ? (
          <LuTable2 className="flex-shrink-0" />
        ) : (
          <LuEye className="flex-shrink-0" />
        )
      }))
  });

  return result;
}
