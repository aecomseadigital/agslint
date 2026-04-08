"use strict";

const { parseCsvLine, splitLinesDetailed } = require("../utils/lineParser");
const { createRuleDiagnostic } = require("../linter/diagnostics");

function finalizeBlock(block) {
  if (!block) {
    return null;
  }

  block.headingRow = block.headingRows[0] || null;
  block.unitRow = block.unitRows[0] || null;
  block.typeRow = block.typeRows[0] || null;
  return block;
}

function parseAgs4(text) {
  const document = {
    version: "4",
    lines: [],
    blocks: [],
    parseDiagnostics: []
  };

  let currentBlock = null;

  for (const sourceLine of splitLinesDetailed(text)) {
    const rawLine = sourceLine.raw;
    if (!rawLine.trim()) {
      continue;
    }

    const parsedLine = parseCsvLine(rawLine, sourceLine.lineNumber);
    parsedLine.eol = sourceLine.eol;
    parsedLine.hasBom = sourceLine.hasBom;
    document.lines.push(parsedLine);
    document.parseDiagnostics.push(...parsedLine.errors);

    if (parsedLine.firstValue === "GROUP") {
      if (currentBlock) {
        document.blocks.push(finalizeBlock(currentBlock));
      }

      currentBlock = {
        version: "4",
        groupLine: parsedLine,
        groupCode: parsedLine.tokens[1] ? parsedLine.tokens[1].value : "",
        rows: [],
        headingRows: [],
        unitRows: [],
        typeRows: [],
        headingRow: null,
        unitRow: null,
        typeRow: null,
        dataRows: []
      };
      continue;
    }

    if (!currentBlock) {
      document.parseDiagnostics.push(
        createRuleDiagnostic("AGS4", "2", "ags4.structure.before-group", "error", "Found AGS4 content before a GROUP row.", parsedLine.lineNumber, 1, Math.max(2, parsedLine.raw.length + 1))
      );
      continue;
    }

    currentBlock.rows.push(parsedLine);

    if (parsedLine.firstValue === "HEADING") {
      currentBlock.headingRows.push(parsedLine);
    } else if (parsedLine.firstValue === "UNIT") {
      currentBlock.unitRows.push(parsedLine);
    } else if (parsedLine.firstValue === "TYPE") {
      currentBlock.typeRows.push(parsedLine);
    } else {
      currentBlock.dataRows.push(parsedLine);
    }
  }

  if (currentBlock) {
    document.blocks.push(finalizeBlock(currentBlock));
  }

  return document;
}

module.exports = {
  parseAgs4
};
