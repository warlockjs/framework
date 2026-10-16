import { isCancel, multiselect, select } from "@clack/prompts";
import { getFeatureGroups } from "../features/features-map";
import { fitOptionsToWidth, multiselectMaxItems } from "./fit-to-terminal";

const CONTINUE = "@continue";
const SELECT_ALL = "@all";

/** Edit one short feature group at a time, preserving terminal paging. */
export async function askFeatures(
  initialValues: string[] = [],
): Promise<string[] | symbol> {
  const groups = getFeatureGroups();
  const selected = new Set(initialValues);
  let lastGroup: string | undefined;

  while (true) {
    const options = [
      ...groups.map(group => ({
        value: group.label,
        label: `${group.label} (${group.options.filter(option => selected.has(option.value)).length}/${group.options.length})`,
        hint: group.options.map(option => option.label).join(", "),
      })),
      { value: CONTINUE, label: `Continue (${selected.size} selected)` },
    ];
    const groupName = await select({
      message: "Optional features by group",
      initialValue: lastGroup,
      options: fitOptionsToWidth(options),
      maxItems: multiselectMaxItems(options.length),
    });

    if (isCancel(groupName)) return groupName;
    if (groupName === CONTINUE) return [...selected];

    lastGroup = groupName;
    const group = groups.find(candidate => candidate.label === groupName)!;
    const previouslySelected = new Set(
      group.options.filter(option => selected.has(option.value)).map(option => option.value),
    );
    const groupOptions = [
      {
        value: SELECT_ALL,
        label: "Select all",
        hint: "Include every feature in this group",
      },
      ...group.options,
    ];
    const answer = await multiselect({
      message: group.label,
      options: fitOptionsToWidth(groupOptions),
      initialValues: group.options
        .filter(option => selected.has(option.value))
        .map(option => option.value),
      required: false,
      maxItems: multiselectMaxItems(groupOptions.length),
    });
    if (isCancel(answer)) return answer;

    for (const option of group.options) {
      if (
        answer.includes(option.value) ||
        (answer.includes(SELECT_ALL) && !previouslySelected.has(option.value))
      )
        selected.add(option.value);
      else selected.delete(option.value);
    }
  }
}
