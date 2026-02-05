import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  Input,
  Label
} from "@carbon/react";
import { useEffect, useState } from "react";
import { BsGear, BsLink45Deg, BsPlus, BsTrash, BsWrench } from "react-icons/bs";
import { Link, useFetcher } from "react-router";
import { path } from "~/utils/path";

interface SettingsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SettingsTab = "tools" | "torque" | "associations";

interface ToolItem {
  id: string;
  name: string;
  category: string;
  partNumber?: string;
  description?: string;
}

interface TorqueSpec {
  id: string;
  name: string;
  torqueValue: number;
  unit: string;
  tolerance?: number;
  fastenerType?: string;
}

interface Association {
  id: string;
  name: string;
  matchPattern: string;
  matchType: string;
  defaultInstruction?: string;
}

export function SettingsDrawer({ open, onOpenChange }: SettingsDrawerProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("tools");

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "tools", label: "Tools" },
    { id: "torque", label: "Torque" },
    { id: "associations", label: "Rules" }
  ];

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent position="right" size="md">
        <DrawerHeader>
          <DrawerTitle className="flex items-center gap-2">
            <BsGear className="w-5 h-5" />
            Project Settings
          </DrawerTitle>
          <DrawerDescription>
            Manage tools, torque specs, and part associations.
          </DrawerDescription>
        </DrawerHeader>

        {/* Tab Navigation */}
        <div className="flex gap-1 border-b border-border px-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
                activeTab === tab.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <DrawerBody>
          {activeTab === "tools" && <ToolsTab />}
          {activeTab === "torque" && <TorqueTab />}
          {activeTab === "associations" && <AssociationsTab />}

          {/* Link to full settings */}
          <div className="mt-6 pt-4 border-t border-border">
            <Link
              to={
                activeTab === "tools"
                  ? path.to.settingsTools
                  : activeTab === "torque"
                    ? path.to.settingsTorque
                    : path.to.settingsAssociations
              }
              className="text-sm text-primary hover:underline flex items-center gap-1"
            >
              Open full settings page
              <BsLink45Deg className="w-3.5 h-3.5" />
            </Link>
          </div>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}

function ToolsTab() {
  const fetcher = useFetcher<{ tools?: ToolItem[] }>();
  const addFetcher = useFetcher();
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    fetcher.load("/x/settings/tools");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tools: ToolItem[] =
    (fetcher.data as Record<string, ToolItem[]>)?.tools ?? [];

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("_action", "create");
    addFetcher.submit(formData, {
      method: "post",
      action: "/x/settings/tools"
    });
    setShowAdd(false);
    // Reload after a short delay
    setTimeout(() => fetcher.load("/x/settings/tools"), 500);
  };

  const handleDelete = (id: string) => {
    const formData = new FormData();
    formData.set("_action", "delete");
    formData.set("toolId", id);
    addFetcher.submit(formData, {
      method: "post",
      action: "/x/settings/tools"
    });
    setTimeout(() => fetcher.load("/x/settings/tools"), 500);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Tools Library ({tools.length})</h3>
        <Button variant="ghost" size="sm" onClick={() => setShowAdd(!showAdd)}>
          <BsPlus className="w-4 h-4" />
        </Button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="p-3 border rounded-lg space-y-3">
          <div>
            <Label className="text-xs">Name</Label>
            <Input name="name" placeholder="Tool name" required />
          </div>
          <div>
            <Label className="text-xs">Category</Label>
            <Input name="category" placeholder="e.g., Wrenches" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm">
              Add
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAdd(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {fetcher.state === "loading" && tools.length === 0 && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          Loading...
        </p>
      )}

      {tools.length === 0 && fetcher.state === "idle" && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No tools added yet.
        </p>
      )}

      <div className="space-y-1">
        {tools.map((tool) => (
          <div
            key={tool.id}
            className="flex items-center justify-between p-2 rounded-md hover:bg-muted group"
          >
            <div className="flex items-center gap-2 min-w-0">
              <BsWrench className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm truncate">{tool.name}</p>
                {tool.category && (
                  <p className="text-xs text-muted-foreground">
                    {tool.category}
                  </p>
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="opacity-0 group-hover:opacity-100"
              onClick={() => handleDelete(tool.id)}
            >
              <BsTrash className="w-3.5 h-3.5 text-destructive" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function TorqueTab() {
  const fetcher = useFetcher<{ torqueSpecs?: TorqueSpec[] }>();
  const addFetcher = useFetcher();
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    fetcher.load("/x/settings/torque");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const specs: TorqueSpec[] =
    (fetcher.data as Record<string, TorqueSpec[]>)?.torqueSpecs ?? [];

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("_action", "create");
    addFetcher.submit(formData, {
      method: "post",
      action: "/x/settings/torque"
    });
    setShowAdd(false);
    setTimeout(() => fetcher.load("/x/settings/torque"), 500);
  };

  const handleDelete = (id: string) => {
    const formData = new FormData();
    formData.set("_action", "delete");
    formData.set("specId", id);
    addFetcher.submit(formData, {
      method: "post",
      action: "/x/settings/torque"
    });
    setTimeout(() => fetcher.load("/x/settings/torque"), 500);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Torque Specs ({specs.length})</h3>
        <Button variant="ghost" size="sm" onClick={() => setShowAdd(!showAdd)}>
          <BsPlus className="w-4 h-4" />
        </Button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="p-3 border rounded-lg space-y-3">
          <div>
            <Label className="text-xs">Name</Label>
            <Input name="name" placeholder="Spec name" required />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Torque Value</Label>
              <Input
                name="torqueValue"
                type="number"
                step="0.1"
                placeholder="25"
                required
              />
            </div>
            <div>
              <Label className="text-xs">Unit</Label>
              <Input name="unit" placeholder="Nm" defaultValue="Nm" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm">
              Add
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAdd(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {fetcher.state === "loading" && specs.length === 0 && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          Loading...
        </p>
      )}

      {specs.length === 0 && fetcher.state === "idle" && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No torque specs added yet.
        </p>
      )}

      <div className="space-y-1">
        {specs.map((spec) => (
          <div
            key={spec.id}
            className="flex items-center justify-between p-2 rounded-md hover:bg-muted group"
          >
            <div className="min-w-0">
              <p className="text-sm truncate">{spec.name}</p>
              <p className="text-xs text-muted-foreground">
                {spec.torqueValue} {spec.unit}
                {spec.tolerance ? ` ±${spec.tolerance}` : ""}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="opacity-0 group-hover:opacity-100"
              onClick={() => handleDelete(spec.id)}
            >
              <BsTrash className="w-3.5 h-3.5 text-destructive" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function AssociationsTab() {
  const fetcher = useFetcher<{ associations?: Association[] }>();
  const addFetcher = useFetcher();
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    fetcher.load("/x/settings/associations");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const associations: Association[] =
    (fetcher.data as Record<string, Association[]>)?.associations ?? [];

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("_action", "create");
    addFetcher.submit(formData, {
      method: "post",
      action: "/x/settings/associations"
    });
    setShowAdd(false);
    setTimeout(() => fetcher.load("/x/settings/associations"), 500);
  };

  const handleDelete = (id: string) => {
    const formData = new FormData();
    formData.set("_action", "delete");
    formData.set("associationId", id);
    addFetcher.submit(formData, {
      method: "post",
      action: "/x/settings/associations"
    });
    setTimeout(() => fetcher.load("/x/settings/associations"), 500);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">
          Part Rules ({associations.length})
        </h3>
        <Button variant="ghost" size="sm" onClick={() => setShowAdd(!showAdd)}>
          <BsPlus className="w-4 h-4" />
        </Button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="p-3 border rounded-lg space-y-3">
          <div>
            <Label className="text-xs">Name</Label>
            <Input name="name" placeholder="Rule name" required />
          </div>
          <div>
            <Label className="text-xs">Match Pattern</Label>
            <Input name="matchPattern" placeholder="e.g., M8_BOLT" required />
          </div>
          <div>
            <Label className="text-xs">Match Type</Label>
            <select
              name="matchType"
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              defaultValue="contains"
            >
              <option value="contains">Contains</option>
              <option value="exact">Exact</option>
              <option value="startsWith">Starts with</option>
              <option value="regex">Regex</option>
            </select>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm">
              Add
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAdd(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {fetcher.state === "loading" && associations.length === 0 && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          Loading...
        </p>
      )}

      {associations.length === 0 && fetcher.state === "idle" && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No associations added yet.
        </p>
      )}

      <div className="space-y-1">
        {associations.map((assoc) => (
          <div
            key={assoc.id}
            className="flex items-center justify-between p-2 rounded-md hover:bg-muted group"
          >
            <div className="min-w-0">
              <p className="text-sm truncate">{assoc.name}</p>
              <p className="text-xs text-muted-foreground">
                <code className="bg-muted px-1 rounded">
                  {assoc.matchPattern}
                </code>
                <span className="ml-1">({assoc.matchType})</span>
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="opacity-0 group-hover:opacity-100"
              onClick={() => handleDelete(assoc.id)}
            >
              <BsTrash className="w-3.5 h-3.5 text-destructive" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
