import { createHash } from "node:crypto";

import type { CalculationRegistry } from "./calculations.js";
import type { ToolDefinition } from "./tool-runtime.js";

interface CompareRatiosInput {
  leftNumerator: string;
  leftDenominator: string;
  rightNumerator: string;
  rightDenominator: string;
}

interface Fraction {
  numerator: bigint;
  denominator: bigint;
}

export function createNumericTools(registry: CalculationRegistry): readonly ToolDefinition[] {
  return [createCompareRatiosTool(registry)];
}

function createCompareRatiosTool(
  registry: CalculationRegistry,
): ToolDefinition<CompareRatiosInput> {
  return {
    name: "compare_ratios",
    description: "Compare two ratios exactly without model mental arithmetic, for example 46/128 versus 39/104.",
    parameters: {
      type: "object",
      properties: {
        leftNumerator: { type: "string" },
        leftDenominator: { type: "string" },
        rightNumerator: { type: "string" },
        rightDenominator: { type: "string" },
      },
      required: ["leftNumerator", "leftDenominator", "rightNumerator", "rightDenominator"],
      additionalProperties: false,
    },
    risk: "compute",
    permission: "deterministic.compute",
    parse(input) {
      const record = expectObject(input);
      return {
        leftNumerator: expectDecimalString(record.leftNumerator, "leftNumerator"),
        leftDenominator: expectDecimalString(record.leftDenominator, "leftDenominator"),
        rightNumerator: expectDecimalString(record.rightNumerator, "rightNumerator"),
        rightDenominator: expectDecimalString(record.rightDenominator, "rightDenominator"),
      };
    },
    async execute(input, context) {
      const left = divide(parseDecimal(input.leftNumerator), parseDecimal(input.leftDenominator));
      const right = divide(parseDecimal(input.rightNumerator), parseDecimal(input.rightDenominator));
      const comparison = left.numerator * right.denominator - right.numerator * left.denominator;
      const result = {
        operation: `${input.leftNumerator}/${input.leftDenominator} compared with ${input.rightNumerator}/${input.rightDenominator}`,
        leftDecimal: formatFraction(left, 12),
        rightDecimal: formatFraction(right, 12),
        relation: comparison < 0n ? "left_is_lower" : comparison > 0n ? "left_is_higher" : "equal",
        exactComparison: `${left.numerator}*${right.denominator} compared with ${right.numerator}*${left.denominator}`,
      };
      const calculationId = `calc-${createHash("sha256")
        .update(JSON.stringify({ tool: "compare_ratios", input, result }))
        .digest("hex")
        .slice(0, 12)}`;
      await registry.add({
        id: calculationId,
        runId: context.runId,
        taskId: context.taskId,
        agentId: context.agent.id,
        toolName: "compare_ratios",
        operation: result.operation,
        inputs: {
          leftNumerator: input.leftNumerator,
          leftDenominator: input.leftDenominator,
          rightNumerator: input.rightNumerator,
          rightDenominator: input.rightDenominator,
        },
        outputs: {
          leftDecimal: result.leftDecimal,
          rightDecimal: result.rightDecimal,
          relation: result.relation,
          exactComparison: result.exactComparison,
        },
      });
      return { calculationId, ...result };
    },
  };
}

function parseDecimal(value: string): Fraction {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [integer = "0", fractional = ""] = unsigned.split(".");
  const denominator = 10n ** BigInt(fractional.length);
  const numerator = BigInt(`${integer}${fractional}` || "0") * (negative ? -1n : 1n);
  return reduce({ numerator, denominator });
}

function divide(numerator: Fraction, denominator: Fraction): Fraction {
  if (denominator.numerator === 0n) {
    throw new Error("ratio denominator cannot be zero");
  }
  const sign = denominator.numerator < 0n ? -1n : 1n;
  return reduce({
    numerator: numerator.numerator * denominator.denominator * sign,
    denominator: numerator.denominator * denominator.numerator * sign,
  });
}

function reduce(fraction: Fraction): Fraction {
  const divisor = greatestCommonDivisor(abs(fraction.numerator), abs(fraction.denominator));
  return {
    numerator: fraction.numerator / divisor,
    denominator: fraction.denominator / divisor,
  };
}

function formatFraction(fraction: Fraction, decimalPlaces: number): string {
  const negative = fraction.numerator < 0n;
  const numerator = abs(fraction.numerator);
  const integer = numerator / fraction.denominator;
  let remainder = numerator % fraction.denominator;
  let decimals = "";
  for (let index = 0; index < decimalPlaces && remainder !== 0n; index += 1) {
    remainder *= 10n;
    decimals += String(remainder / fraction.denominator);
    remainder %= fraction.denominator;
  }
  return `${negative ? "-" : ""}${integer}${decimals.length === 0 ? "" : `.${decimals}`}`;
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left;
  let b = right;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a === 0n ? 1n : a;
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function expectObject(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("tool input must be an object");
  }
  return input as Record<string, unknown>;
}

function expectDecimalString(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(`${name} must be a decimal string`);
  }
  return value;
}
