"use strict";

const { parseCsvLine, splitLines } = require("../utils/lineParser");
const { normalizeAgs3GroupToken, normalizeAgs3HeadingToken } = require("../references/extractors");

function createLogicalRow(kind, parsedLine) {
  return {
    kind,
    startLine: parsedLine.lineNumber,
    endLine: parsedLine.lineNumber,
    sourceLines: [parsedLine],
    raw: parsedLine.raw,
    cells: [...parsedLine.tokens]
  };
}

function appendLogicalRowByRawJoin(row, parsedLine) {
  row.endLine = parsedLine.lineNumber;
  row.sourceLines.push(parsedLine);
  row.raw += parsedLine.raw;
  row.cells = parseCsvLine(row.raw, row.startLine).tokens;
}

function shouldContinueAgs3LogicalRow(raw, errors) {
  const trimmed = raw.trimEnd();
  return trimmed.endsWith(",") || trimmed.endsWith(",\"") || (errors && errors.length > 0);
}

function finalizeBlock(block) {
  if (!block) {
    return null;
  }

  block.headingCodes = block.headingRow
    ? block.headingRow.cells.map((cell) => normalizeAgs3HeadingToken(cell.value))
    : [];
  return block;
}

function parseAgs3(text) {
  const document = {
    version: "3",
    lines: [],
    blocks: [],
    parseDiagnostics: []
  };

  let currentBlock = null;
  let pendingRow = null;

  for (const [index, rawLine] of splitLines(text).entries()) {
    if (!rawLine.trim()) {
      continue;
    }

    const parsedLine = parseCsvLine(rawLine, index + 1);
    document.lines.push(parsedLine);
    document.parseDiagnostics.push(...parsedLine.errors);

    if (pendingRow) {
      appendLogicalRowByRawJoin(pendingRow, parsedLine);
      const reparsed = parseCsvLine(pendingRow.raw, pendingRow.startLine);
      pendingRow.cells = reparsed.tokens;
      if (!shouldContinueAgs3LogicalRow(pendingRow.raw, reparsed.errors)) {
        pendingRow = null;
      }
      continue;
    }

    if (parsedLine.firstValue.startsWith("**")) {
      const completed = finalizeBlock(currentBlock);
      if (completed) {
        document.blocks.push(completed);
      }

      currentBlock = {
        version: "3",
        groupLine: parsedLine,
        groupCode: normalizeAgs3GroupToken(parsedLine.firstValue),
        headingRow: null,
        unitsRow: null,
        dataRows: []
      };
      continue;
    }

    if (!currentBlock) {
      document.parseDiagnostics.push({
        code: "AGS3-STRUCTURE",
        message: "Found AGS3 content before a GROUP line.",
        line: parsedLine.lineNumber,
        column: 1,
        endColumn: Math.max(2, parsedLine.raw.length + 1)
      });
      continue;
    }

    if (parsedLine.firstValue.startsWith("*")) {
      currentBlock.headingRow = createLogicalRow("heading", parsedLine);
      if (shouldContinueAgs3LogicalRow(parsedLine.raw, parsedLine.errors)) {
        pendingRow = currentBlock.headingRow;
      }
      continue;
    }

    if (parsedLine.firstValue === "<UNITS>") {
      currentBlock.unitsRow = createLogicalRow("units", parsedLine);
      if (shouldContinueAgs3LogicalRow(parsedLine.raw, parsedLine.errors)) {
        pendingRow = currentBlock.unitsRow;
      }
      continue;
    }

    currentBlock.dataRows.push({
      kind: parsedLine.firstValue === "<CONT>" ? "continuation" : "data",
      lineNumber: parsedLine.lineNumber,
      raw: parsedLine.raw,
      cells: parsedLine.tokens
    });
  }

  const completed = finalizeBlock(currentBlock);
  if (completed) {
    document.blocks.push(completed);
  }

  return document;
}

module.exports = {
  parseAgs3
};
