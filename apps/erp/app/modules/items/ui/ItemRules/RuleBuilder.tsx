import {
  Button,
  ChoiceSelect,
  type ChoiceSelectOption,
  Heading,
  VStack
} from "@carbon/react";
import {
  type Condition,
  type ConditionAst,
  FIELD_REGISTRY,
  type MatchKind
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useMemo, useState } from "react";
import { LuBan, LuCheckCheck, LuListChecks, LuPlus } from "react-icons/lu";
import { Hidden } from "~/components/Form";
import ConditionRow, { CONDITION_GRID_CLASS } from "./ConditionRow";

type RuleBuilderProps = {
  name: string;
  initial?: ConditionAst;
};

const emptyCondition = (): Condition => ({
  field: FIELD_REGISTRY[0]?.path ?? "",
  op: "eq",
  value: undefined
});

export default function RuleBuilder({ name, initial }: RuleBuilderProps) {
  const { t } = useLingui();
  const [kind, setKind] = useState<MatchKind>(initial?.kind ?? "all");

  const matchOptions = useMemo<ChoiceSelectOption<MatchKind>[]>(
    () => [
      {
        value: "all",
        title: t`Match all`,
        description: t`Every condition must match`,
        icon: <LuCheckCheck />
      },
      {
        value: "any",
        title: t`Match any`,
        description: t`At least one condition must match`,
        icon: <LuListChecks />
      },
      {
        value: "none",
        title: t`Match none`,
        description: t`No condition may match`,
        icon: <LuBan />
      }
    ],
    [t]
  );
  const [conditions, setConditions] = useState<Condition[]>(
    initial?.conditions?.length ? initial.conditions : [emptyCondition()]
  );

  const handleChange = useCallback(
    (index: number, patch: Partial<Condition>) => {
      setConditions((prev) =>
        prev.map((c, i) => (i === index ? { ...c, ...patch } : c))
      );
    },
    []
  );

  const handleRemove = useCallback((index: number) => {
    setConditions((prev) =>
      prev.length > 1 ? prev.filter((_, i) => i !== index) : prev
    );
  }, []);

  const handleAdd = useCallback(() => {
    setConditions((prev) => [...prev, emptyCondition()]);
  }, []);

  const ast: ConditionAst = { kind, conditions };

  return (
    <VStack spacing={2} className="w-full">
      <div className="flex items-center justify-between w-full gap-3 flex-wrap">
        <Heading size="h5">
          <Trans>Conditions</Trans>
        </Heading>
        <ChoiceSelect<MatchKind>
          value={kind}
          onChange={setKind}
          options={matchOptions}
          aria-label={t`Match`}
          align="end"
          className="w-[180px]"
        />
      </div>

      <Hidden name={name} value={JSON.stringify(ast)} />

      <div className="flex flex-col gap-2 w-full">
        <div
          className={`${CONDITION_GRID_CLASS} hidden md:grid px-3 pr-9`}
          aria-hidden
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t`Field`}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t`Operator`}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t`Value`}
          </span>
        </div>
        {conditions.map((c, i) => (
          <ConditionRow
            key={i}
            condition={c}
            index={i}
            canRemove={conditions.length > 1}
            onChange={handleChange}
            onRemove={handleRemove}
          />
        ))}
      </div>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        leftIcon={<LuPlus />}
        onClick={handleAdd}
      >
        <Trans>Add condition</Trans>
      </Button>
    </VStack>
  );
}
