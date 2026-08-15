export type ArtifactTextDiffLineKind = "equal" | "added" | "removed" | "context";

export interface ArtifactTextDiffLine {
  kind: ArtifactTextDiffLineKind;
  text: string;
  beforeLine?: number;
  afterLine?: number;
  skippedLines?: number;
}

export interface ArtifactTextDiffResult {
  addedLines: number;
  removedLines: number;
  unchangedLines: number;
  truncated: boolean;
  lines: readonly ArtifactTextDiffLine[];
}

interface DiffOperation {
  kind: "equal" | "added" | "removed";
  text: string;
}

const MAX_DIFF_BYTES = 200_000;
const MAX_DIFF_LINES = 4_000;
const MAX_LCS_CELLS = 2_000_000;
const MAX_RENDERED_LINES = 2_000;
const CONTEXT_LINES = 3;

export function createArtifactTextDiff(
  beforeContent: Buffer | string,
  afterContent: Buffer | string,
): ArtifactTextDiffResult {
  const beforeBuffer = Buffer.isBuffer(beforeContent)
    ? beforeContent
    : Buffer.from(beforeContent, "utf8");
  const afterBuffer = Buffer.isBuffer(afterContent)
    ? afterContent
    : Buffer.from(afterContent, "utf8");
  if (beforeBuffer.length > MAX_DIFF_BYTES || afterBuffer.length > MAX_DIFF_BYTES) {
    throw new Error(`Artifact text diff supports files up to ${MAX_DIFF_BYTES} bytes`);
  }
  const before = splitLines(beforeBuffer.toString("utf8"));
  const after = splitLines(afterBuffer.toString("utf8"));
  if (before.length > MAX_DIFF_LINES || after.length > MAX_DIFF_LINES) {
    throw new Error(`Artifact text diff supports files up to ${MAX_DIFF_LINES} lines`);
  }

  const operations = before.length * after.length <= MAX_LCS_CELLS
    ? lcsOperations(before, after)
    : boundedFallbackOperations(before, after);
  const addedLines = operations.filter((operation) => operation.kind === "added").length;
  const removedLines = operations.filter((operation) => operation.kind === "removed").length;
  const unchangedLines = operations.filter((operation) => operation.kind === "equal").length;
  if (addedLines === 0 && removedLines === 0) {
    return { addedLines, removedLines, unchangedLines, truncated: false, lines: [] };
  }

  const contextual = addLineNumbersAndCollapseContext(operations);
  if (contextual.length <= MAX_RENDERED_LINES) {
    return { addedLines, removedLines, unchangedLines, truncated: false, lines: contextual };
  }
  const headCount = Math.floor((MAX_RENDERED_LINES - 1) / 2);
  const tailCount = MAX_RENDERED_LINES - headCount - 1;
  const omitted = contextual.length - headCount - tailCount;
  return {
    addedLines,
    removedLines,
    unchangedLines,
    truncated: true,
    lines: [
      ...contextual.slice(0, headCount),
      { kind: "context", text: `… ${omitted} diff rows omitted …`, skippedLines: omitted },
      ...contextual.slice(-tailCount),
    ],
  };
}

function splitLines(text: string): string[] {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
}

function lcsOperations(before: readonly string[], after: readonly string[]): DiffOperation[] {
  const columns = after.length + 1;
  const matrix = new Uint32Array((before.length + 1) * columns);
  for (let beforeIndex = 1; beforeIndex <= before.length; beforeIndex += 1) {
    for (let afterIndex = 1; afterIndex <= after.length; afterIndex += 1) {
      const offset = beforeIndex * columns + afterIndex;
      matrix[offset] = before[beforeIndex - 1] === after[afterIndex - 1]
        ? (matrix[(beforeIndex - 1) * columns + afterIndex - 1] ?? 0) + 1
        : Math.max(
            matrix[(beforeIndex - 1) * columns + afterIndex] ?? 0,
            matrix[beforeIndex * columns + afterIndex - 1] ?? 0,
          );
    }
  }

  const reversed: DiffOperation[] = [];
  let beforeIndex = before.length;
  let afterIndex = after.length;
  while (beforeIndex > 0 || afterIndex > 0) {
    if (
      beforeIndex > 0
      && afterIndex > 0
      && before[beforeIndex - 1] === after[afterIndex - 1]
    ) {
      reversed.push({ kind: "equal", text: before[beforeIndex - 1] ?? "" });
      beforeIndex -= 1;
      afterIndex -= 1;
    } else if (
      afterIndex > 0
      && (beforeIndex === 0
        || (matrix[beforeIndex * columns + afterIndex - 1] ?? 0)
          >= (matrix[(beforeIndex - 1) * columns + afterIndex] ?? 0))
    ) {
      reversed.push({ kind: "added", text: after[afterIndex - 1] ?? "" });
      afterIndex -= 1;
    } else {
      reversed.push({ kind: "removed", text: before[beforeIndex - 1] ?? "" });
      beforeIndex -= 1;
    }
  }
  return reversed.reverse();
}

function boundedFallbackOperations(
  before: readonly string[],
  after: readonly string[],
): DiffOperation[] {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - suffix - 1] === after[after.length - suffix - 1]
  ) {
    suffix += 1;
  }
  return [
    ...before.slice(0, prefix).map((text) => ({ kind: "equal" as const, text })),
    ...before.slice(prefix, before.length - suffix).map((text) => ({ kind: "removed" as const, text })),
    ...after.slice(prefix, after.length - suffix).map((text) => ({ kind: "added" as const, text })),
    ...before.slice(before.length - suffix).map((text) => ({ kind: "equal" as const, text })),
  ];
}

function addLineNumbersAndCollapseContext(
  operations: readonly DiffOperation[],
): ArtifactTextDiffLine[] {
  const numbered: ArtifactTextDiffLine[] = [];
  let beforeLine = 1;
  let afterLine = 1;
  for (const operation of operations) {
    if (operation.kind === "equal") {
      numbered.push({ kind: operation.kind, text: operation.text, beforeLine, afterLine });
      beforeLine += 1;
      afterLine += 1;
    } else if (operation.kind === "removed") {
      numbered.push({ kind: operation.kind, text: operation.text, beforeLine });
      beforeLine += 1;
    } else {
      numbered.push({ kind: operation.kind, text: operation.text, afterLine });
      afterLine += 1;
    }
  }

  const contextual: ArtifactTextDiffLine[] = [];
  let index = 0;
  while (index < numbered.length) {
    if (numbered[index]?.kind !== "equal") {
      contextual.push(numbered[index] as ArtifactTextDiffLine);
      index += 1;
      continue;
    }
    let end = index;
    while (end < numbered.length && numbered[end]?.kind === "equal") end += 1;
    const group = numbered.slice(index, end);
    if (group.length <= CONTEXT_LINES * 2) {
      contextual.push(...group);
    } else {
      const skippedLines = group.length - CONTEXT_LINES * 2;
      contextual.push(
        ...group.slice(0, CONTEXT_LINES),
        { kind: "context", text: `… ${skippedLines} unchanged lines …`, skippedLines },
        ...group.slice(-CONTEXT_LINES),
      );
    }
    index = end;
  }
  return contextual;
}
