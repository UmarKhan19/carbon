import { requirePermissions } from "@carbon/auth/auth.server";
import { Card, Heading } from "@carbon/react";
import {
  BsArrowRight,
  BsGear,
  BsLink45Deg,
  BsTools,
  BsWrench
} from "react-icons/bs";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "assembly"
  });

  // Get counts for each setting category
  const [toolsCount, torqueSpecsCount, associationsCount] = await Promise.all([
    client
      .from("assemblyTool")
      .select("*", { count: "exact", head: true })
      .eq("companyId", companyId),
    client
      .from("assemblyTorqueSpec")
      .select("*", { count: "exact", head: true })
      .eq("companyId", companyId),
    client
      .from("assemblyPartAssociation")
      .select("*", { count: "exact", head: true })
      .eq("companyId", companyId)
  ]);

  return {
    counts: {
      tools: toolsCount.count ?? 0,
      torqueSpecs: torqueSpecsCount.count ?? 0,
      associations: associationsCount.count ?? 0
    }
  };
}

export default function SettingsIndexRoute() {
  const { counts } = useLoaderData<typeof loader>();

  const settingsItems = [
    {
      title: "Tool Library",
      description: "Manage tools that can be assigned to assembly steps",
      icon: <BsTools className="w-5 h-5" />,
      count: counts.tools,
      href: path.to.settingsTools,
      color: "bg-blue-500/10 text-blue-500"
    },
    {
      title: "Torque Specifications",
      description: "Define torque specs for fasteners",
      icon: <BsWrench className="w-5 h-5" />,
      count: counts.torqueSpecs,
      href: path.to.settingsTorque,
      color: "bg-green-500/10 text-green-500"
    },
    {
      title: "Part Associations",
      description: "Auto-apply tools and instructions based on part names",
      icon: <BsLink45Deg className="w-5 h-5" />,
      count: counts.associations,
      href: path.to.settingsAssociations,
      color: "bg-purple-500/10 text-purple-500"
    }
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <Heading size="h2">Settings</Heading>
        <p className="text-muted-foreground mt-1">
          Configure your assembly instruction libraries and automation rules
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {settingsItems.map((item) => (
          <Link key={item.href} to={item.href}>
            <Card className="p-6 hover:border-primary transition-colors h-full">
              <div className="flex items-start gap-4">
                <div className={`p-3 rounded-lg ${item.color}`}>
                  {item.icon}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <Heading size="h4">{item.title}</Heading>
                    <p className="text-sm text-muted-foreground">
                      {item.count} items
                    </p>
                  </div>
                  <p className="text-muted-foreground mt-1">
                    {item.description}
                  </p>
                  <div className="flex items-center text-primary mt-3 text-sm font-medium">
                    Manage
                    <BsArrowRight className="w-4 h-4 ml-2" />
                  </div>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      {/* General Settings Placeholder */}
      <Card className="p-6">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-muted rounded-lg">
            <BsGear className="w-5 h-5 text-muted-foreground" />
          </div>
          <div>
            <Heading size="h4">General Settings</Heading>
            <p className="text-muted-foreground mt-1">
              Default animation speeds, export preferences, and other global
              settings will be available here.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
