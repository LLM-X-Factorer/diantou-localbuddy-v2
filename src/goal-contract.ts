export interface GoalContractInput {
  outcome: string;
  constraints?: readonly string[];
  verificationCriteria?: readonly string[];
}

export interface GoalContract {
  version: 1;
  revision: 1;
  outcome: string;
  constraints: readonly string[];
  verificationCriteria: readonly string[];
}

const MAX_OUTCOME_CHARACTERS = 12_000;
const MAX_LIST_ITEMS = 20;
const MAX_ITEM_CHARACTERS = 1_000;
const MAX_CONTRACT_CHARACTERS = 20_000;

export function normalizeGoalContract(input: GoalContractInput): GoalContract {
  const outcome = normalizeRequiredText(input.outcome, "Goal outcome", MAX_OUTCOME_CHARACTERS);
  const constraints = normalizeItems(input.constraints ?? [], "Goal constraints");
  const verificationCriteria = normalizeItems(
    input.verificationCriteria ?? [],
    "Goal verification criteria",
  );
  const totalCharacters = outcome.length
    + constraints.reduce((sum, item) => sum + item.length, 0)
    + verificationCriteria.reduce((sum, item) => sum + item.length, 0);
  if (totalCharacters > MAX_CONTRACT_CHARACTERS) {
    throw new Error(`Goal Contract must contain at most ${MAX_CONTRACT_CHARACTERS} characters`);
  }
  return {
    version: 1,
    revision: 1,
    outcome,
    constraints,
    verificationCriteria,
  };
}

export function formatGoalContract(contract: GoalContract): string {
  const normalized = normalizeGoalContract(contract);
  return [
    "Outcome:",
    normalized.outcome,
    "",
    "Constraints:",
    formatItems(normalized.constraints, "No explicit constraints were supplied."),
    "",
    "Verification criteria:",
    formatItems(
      normalized.verificationCriteria,
      "No explicit verification criteria were supplied.",
    ),
  ].join("\n");
}

/** Preserve the exact legacy prompt when callers supplied only an outcome. */
export function compileGoalContract(contract: GoalContract): string {
  const normalized = normalizeGoalContract(contract);
  return normalized.constraints.length === 0 && normalized.verificationCriteria.length === 0
    ? normalized.outcome
    : formatGoalContract(normalized);
}

export function goalContractCharacterCount(contract: GoalContract): number {
  const normalized = normalizeGoalContract(contract);
  return normalized.outcome.length
    + normalized.constraints.reduce((sum, item) => sum + item.length, 0)
    + normalized.verificationCriteria.reduce((sum, item) => sum + item.length, 0);
}

function normalizeItems(items: readonly string[], label: string): readonly string[] {
  if (!Array.isArray(items) || items.length > MAX_LIST_ITEMS) {
    throw new Error(`${label} must contain at most ${MAX_LIST_ITEMS} items`);
  }
  const normalized = items.map((item, index) => {
    if (typeof item !== "string") {
      throw new Error(`${label}[${index}] must be a string`);
    }
    return normalizeRequiredText(item, `${label}[${index}]`, MAX_ITEM_CHARACTERS);
  });
  return [...new Set(normalized)];
}

function normalizeRequiredText(value: string, label: string, maximum: number): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new Error(`${label} must contain between 1 and ${maximum} characters`);
  }
  return normalized;
}

function formatItems(items: readonly string[], empty: string): string {
  return items.length === 0 ? `- ${empty}` : items.map((item) => `- ${item}`).join("\n");
}
