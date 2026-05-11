import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import {
  LuBarcode,
  LuBox,
  LuCircleCheck,
  LuClipboardCheck,
  LuCreditCard,
  LuCrown,
  LuFactory,
  LuHistory,
  LuImage,
  LuKey,
  LuLandmark,
  LuLayoutDashboard,
  LuNetwork,
  LuSheet,
  LuShoppingCart,
  LuSquareStack,
  LuUsers,
  LuWebhook,
  LuWorkflow,
  LuWrench
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useFlags } from "~/hooks/useFlags";
import type { AuthenticatedRouteGroup, Role } from "~/types";
import { path } from "~/utils/path";

const internalOnlyRoutes = new Set<string>([path.to.companies]);

export default function useSettingsSubmodules() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { isCloud, isInternal } = useFlags();

  const settingsRoutes: AuthenticatedRouteGroup<{
    requiresOwnership?: boolean;
    requiresCloudEnvironment?: boolean;
  }>[] = useMemo(
    () => [
      {
        name: t`Company`,
        routes: [
          {
            icon: <LuFactory />,
            name: t`Company`,
            role: "employee",
            to: path.to.company
          },
          {
            icon: <LuNetwork />,
            name: t`Companies`,
            role: "employee",
            to: path.to.companies
          },
          {
            icon: <LuCreditCard />,
            name: t`Billing`,
            requiresCloudEnvironment: true,
            requiresOwnership: true,
            role: "employee",
            to: path.to.billing
          },
          {
            icon: <LuBarcode />,
            name: t`Labels`,
            role: "employee",
            to: path.to.labelsSettings
          },
          {
            icon: <LuImage />,
            name: t`Logos`,
            role: "employee",
            to: path.to.logos
          }
        ]
      },
      {
        name: t`Modules`,
        routes: [
          {
            icon: <LuLandmark />,
            name: t`Accounting`,
            role: "employee",
            to: path.to.accountingSettings
          },
          {
            icon: <LuBox />,
            name: t`Inventory`,
            role: "employee",
            to: path.to.inventorySettings
          },
          {
            icon: <LuSquareStack />,
            name: t`Items`,
            role: "employee",
            to: path.to.itemsSettings
          },
          {
            icon: <LuUsers />,
            name: t`People`,
            role: "employee",
            to: path.to.peopleSettings
          },
          {
            icon: <LuShoppingCart />,
            name: t`Purchasing`,
            role: "employee",
            to: path.to.purchasingSettings
          },
          {
            icon: <LuFactory />,
            name: t`Production`,
            role: "employee",
            to: path.to.productionSettings
          },
          {
            icon: <LuClipboardCheck />,
            name: t`Quality`,
            role: "employee",
            to: path.to.qualitySettings
          },
          {
            icon: <LuCrown />,
            name: t`Sales`,
            role: "employee",
            to: path.to.salesSettings
          },
          {
            icon: <LuWrench />,
            name: t`Resources`,
            role: "employee",
            to: path.to.resourcesSettings
          }
        ]
      },
      {
        name: t`System`,
        routes: [
          {
            icon: <LuKey />,
            name: t`API Keys`,
            role: "employee",
            to: path.to.apiKeys
          },
          {
            icon: <LuCircleCheck />,
            name: t`Approval Rules`,
            role: "employee",
            to: path.to.approvalRules
          },
          {
            icon: <LuHistory />,
            name: t`Audit Logs`,
            role: "employee",
            to: path.to.auditLog
          },
          {
            icon: <LuLayoutDashboard />,
            name: t`Custom Fields`,
            role: "employee",
            to: path.to.customFields
          },
          {
            icon: <LuWorkflow />,
            name: t`Integrations`,
            role: "employee",
            to: path.to.integrations
          },
          {
            icon: <LuSheet />,
            name: t`Sequences`,
            role: "employee",
            to: path.to.sequences
          },
          {
            icon: <LuWebhook />,
            name: t`Webhooks`,
            role: "employee",
            to: path.to.webhooks
          }
        ]
      }
    ],
    [t]
  );

  const isRouteVisible = (route: {
    to: string;
    role?: string;
    requiresOwnership?: boolean;
    requiresCloudEnvironment?: boolean;
  }) => {
    if (route.role && !permissions.is(route.role as Role)) return false;
    if (route.requiresOwnership && !permissions.isOwner()) return false;
    if (route.requiresCloudEnvironment && !isCloud) return false;
    if (!isInternal && internalOnlyRoutes.has(route.to)) return false;
    return true;
  };

  return {
    groups: settingsRoutes
      .filter((group) => group.routes.some(isRouteVisible))
      .map((group) => ({
        ...group,
        routes: group.routes.filter(isRouteVisible)
      }))
  };
}
