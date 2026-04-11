import { useLingui } from "@lingui/react/macro";
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
  LuLayoutDashboard,
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
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

export default function useSettingsSubmodules() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { isCloud } = useFlags();

  const settingsRoutes: AuthenticatedRouteGroup<{
    requiresOwnership?: boolean;
    requiresCloudEnvironment?: boolean;
  }>[] = [
    {
      name: t`Company`,
      routes: [
        {
          name: t`Company`,
          to: path.to.company,
          role: "employee",
          icon: <LuFactory />
        },
        {
          name: t`Billing`,
          to: path.to.billing,
          role: "employee",
          icon: <LuCreditCard />,
          requiresOwnership: true,
          requiresCloudEnvironment: true
        },
        {
          name: t`Labels`,
          to: path.to.labelsSettings,
          role: "employee",
          icon: <LuBarcode />
        },
        {
          name: t`Logos`,
          to: path.to.logos,
          role: "employee",
          icon: <LuImage />
        }
      ]
    },
    {
      name: t`Modules`,
      routes: [
        {
          name: t`Inventory`,
          to: path.to.inventorySettings,
          role: "employee",
          icon: <LuBox />
        },
        {
          name: t`Items`,
          to: path.to.itemsSettings,
          role: "employee",
          icon: <LuSquareStack />
        },
        {
          name: t`People`,
          to: path.to.peopleSettings,
          role: "employee",
          icon: <LuUsers />
        },
        {
          name: t`Purchasing`,
          to: path.to.purchasingSettings,
          role: "employee",
          icon: <LuShoppingCart />
        },
        {
          name: t`Production`,
          to: path.to.productionSettings,
          role: "employee",
          icon: <LuFactory />
        },
        {
          name: t`Quality`,
          to: path.to.qualitySettings,
          role: "employee",
          icon: <LuClipboardCheck />
        },
        {
          name: t`Sales`,
          to: path.to.salesSettings,
          role: "employee",
          icon: <LuCrown />
        },
        {
          name: t`Resources`,
          to: path.to.resourcesSettings,
          role: "employee",
          icon: <LuWrench />
        }
      ]
    },
    {
      name: t`System`,
      routes: [
        {
          name: t`API Keys`,
          to: path.to.apiKeys,
          role: "employee",
          icon: <LuKey />
        },
        {
          name: t`Approval Rules`,
          to: path.to.approvalRules,
          role: "employee",
          icon: <LuCircleCheck />
        },
        {
          name: t`Audit Logs`,
          to: path.to.auditLog,
          role: "employee",
          icon: <LuHistory />
        },
        {
          name: t`Custom Fields`,
          to: path.to.customFields,
          role: "employee",
          icon: <LuLayoutDashboard />
        },
        {
          name: t`Integrations`,
          to: path.to.integrations,
          role: "employee",
          icon: <LuWorkflow />
        },
        {
          name: t`Sequences`,
          to: path.to.sequences,
          role: "employee",
          icon: <LuSheet />
        },
        {
          name: t`Webhooks`,
          to: path.to.webhooks,
          role: "employee",
          icon: <LuWebhook />
        }
      ]
    }
  ];

  return {
    groups: settingsRoutes
      .filter((group) => {
        const filteredRoutes = group.routes.filter((route) => {
          // Check role permission
          if (route.role && !permissions.is(route.role)) {
            return false;
          }

          return true;
        });

        return filteredRoutes.length > 0;
      })
      .map((group) => ({
        ...group,
        routes: group.routes.filter((route) => {
          // Check role permission
          if (route.role && !permissions.is(route.role)) {
            return false;
          }

          // Check ownership requirement
          if (route.requiresOwnership && !permissions.isOwner()) {
            return false;
          }

          if (route.requiresCloudEnvironment && !isCloud) {
            return false;
          }

          return true;
        })
      }))
  };
}
