import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  ScrollArea,
  Status,
  useDisclosure,
  VStack
} from "@carbon/react";
import type { TargetType, TransactionSurface } from "@carbon/utils";
import { memo, useCallback, useMemo } from "react";
import {
  LuChevronDown,
  LuEllipsisVertical,
  LuPencil,
  LuPlus,
  LuTrash
} from "react-icons/lu";
import { Link, useNavigate } from "react-router";
import { Empty } from "~/components";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import SurfaceChips from "./SurfaceChips";

type RuleListItem = {
  id: string;
  name: string;
  targetType: TargetType;
  severity: "error" | "warn";
  active: boolean;
  appliesToAll: boolean;
  surfaces?: TransactionSurface[];
  assignmentCount?: number;
  description?: string | null;
  message?: string;
};

type BusinessRulesGroupsProps = {
  rules: RuleListItem[];
};

const TARGET_LABEL: Record<TargetType, string> = {
  item: "Item",
  storageUnit: "Storage unit",
  workCenter: "Work center"
};

const BusinessRulesGroups = memo(({ rules }: BusinessRulesGroupsProps) => {
  const permissions = usePermissions();
  const canCreate = permissions.can("update", "settings");

  const { inventoryRules, productionRules } = useMemo(() => {
    const inv: RuleListItem[] = [];
    const prod: RuleListItem[] = [];
    for (const r of rules) {
      if (r.targetType === "workCenter") prod.push(r);
      else inv.push(r);
    }
    return { inventoryRules: inv, productionRules: prod };
  }, [rules]);

  return (
    <ScrollArea className="h-full w-full">
      <div className="py-12 px-4 max-w-[60rem] mx-auto">
        <div className="mb-8">
          <Heading size="h2">Business Rules</Heading>
        </div>

        <VStack spacing={4}>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">Inventory rules</CardTitle>
                  <CardDescription className="text-sm">
                    Fire on receipts, shipments, transfers, adjustments, putaway
                    and pick. Target items or storage units.
                  </CardDescription>
                </div>
                {canCreate && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="primary"
                        leftIcon={<LuPlus />}
                        rightIcon={<LuChevronDown />}
                      >
                        New Rule
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link to={`${path.to.newBusinessRule}?targetType=item`}>
                          Item rule
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link
                          to={`${path.to.newBusinessRule}?targetType=storageUnit`}
                        >
                          Storage unit rule
                        </Link>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {inventoryRules.length === 0 ? (
                <Empty className="my-4" />
              ) : (
                <VStack spacing={3} className="items-stretch">
                  {inventoryRules.map((r) => (
                    <BusinessRuleCard key={r.id} rule={r} />
                  ))}
                </VStack>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">Production rules</CardTitle>
                  <CardDescription className="text-sm">
                    Fire on operation start/finish, material issue/receive.
                    Target work centers.
                  </CardDescription>
                </div>
                {canCreate && (
                  <Button variant="primary" leftIcon={<LuPlus />} asChild>
                    <Link
                      to={`${path.to.newBusinessRule}?targetType=workCenter`}
                    >
                      New Rule
                    </Link>
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {productionRules.length === 0 ? (
                <Empty className="my-4" />
              ) : (
                <VStack spacing={3} className="items-stretch">
                  {productionRules.map((r) => (
                    <BusinessRuleCard key={r.id} rule={r} />
                  ))}
                </VStack>
              )}
            </CardContent>
          </Card>
        </VStack>
      </div>
    </ScrollArea>
  );
});

BusinessRulesGroups.displayName = "BusinessRulesGroups";
export default BusinessRulesGroups;

const BusinessRuleCard = memo(({ rule }: { rule: RuleListItem }) => {
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const deleteDisclosure = useDisclosure();

  const canEdit = permissions.can("update", "settings");
  const canDelete = permissions.can("delete", "settings");

  const handleEdit = useCallback(() => {
    navigate(`${path.to.businessRule(rule.id)}?${params.toString()}`);
  }, [navigate, params, rule.id]);

  return (
    <>
      <Card className="p-0 border">
        <Accordion type="multiple" className="w-full">
          <AccordionItem value={rule.id} className="border-none">
            <div className="relative">
              <AccordionTrigger className="px-6 py-6 hover:no-underline w-full">
                <HStack spacing={4} className="flex-1 justify-between pr-12">
                  <div className="flex items-center gap-3 min-w-0">
                    <Heading size="h4" as="h3" className="truncate">
                      {rule.name}
                    </Heading>
                    <Badge variant="secondary">
                      {TARGET_LABEL[rule.targetType]}
                    </Badge>
                    {rule.severity === "error" ? (
                      <Badge variant="red">Error</Badge>
                    ) : (
                      <Badge variant="yellow">Warn</Badge>
                    )}
                    {rule.appliesToAll && (
                      <Badge variant="outline">Applies to all</Badge>
                    )}
                  </div>
                  <Status
                    color={rule.active ? "green" : "gray"}
                    className="text-xs font-medium"
                  >
                    {rule.active ? "Active" : "Inactive"}
                  </Status>
                </HStack>
              </AccordionTrigger>
              <div className="absolute right-12 top-1/2 -translate-y-1/2 z-10">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      aria-label="More options"
                      icon={<LuEllipsisVertical />}
                      variant="ghost"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      disabled={!canEdit}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEdit();
                      }}
                    >
                      <LuPencil className="mr-2 h-4 w-4" />
                      Edit Rule
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      destructive
                      disabled={!canDelete}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteDisclosure.onOpen();
                      }}
                    >
                      <LuTrash className="mr-2 h-4 w-4" />
                      Delete Rule
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <AccordionContent className="px-6 pb-5">
              <VStack spacing={3}>
                {rule.description && (
                  <p className="text-sm text-muted-foreground">
                    {rule.description}
                  </p>
                )}
                {rule.message && (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs uppercase tracking-wide font-medium text-muted-foreground">
                      Message
                    </span>
                    <p className="text-sm">{rule.message}</p>
                  </div>
                )}
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs uppercase tracking-wide font-medium text-muted-foreground">
                      Triggers
                    </span>
                    <SurfaceChips
                      surfaces={rule.surfaces}
                      targetType={rule.targetType}
                    />
                  </div>
                  {!rule.appliesToAll && (
                    <div className="flex flex-col gap-1">
                      <span className="text-xs uppercase tracking-wide font-medium text-muted-foreground">
                        Assignments
                      </span>
                      <span className="tabular-nums text-sm">
                        {rule.assignmentCount ?? 0}
                      </span>
                    </div>
                  )}
                </div>
              </VStack>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Card>
      <ConfirmDelete
        action={path.to.deleteBusinessRule(rule.id)}
        isOpen={deleteDisclosure.isOpen}
        name={`${TARGET_LABEL[rule.targetType]} rule "${rule.name}"`}
        text="Are you sure you want to delete this business rule? Assignments will also be removed."
        onCancel={deleteDisclosure.onClose}
        onSubmit={deleteDisclosure.onClose}
      />
    </>
  );
});

BusinessRuleCard.displayName = "BusinessRuleCard";
