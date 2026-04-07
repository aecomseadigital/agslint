"use strict";

const { parseCsvLine, splitLines } = require("../utils/lineParser");

function parseAgs4(text) {
  const document = {
    version: "4",
    lines: [],
    blocks: [],
    parseDiagnostics: []
  };

  let currentBlock = null;

  for (const [index, rawLine] of splitLines(text).entries()) {
    if (!rawLine.trim()) {
      continue;
    }

    const parsedLine = parseCsvLine(rawLine, index + 1);
    document.lines.push(parsedLine);
    document.parseDiagnostics.push(...parsedLine.errors);

    if (parsedLine.firstValue === "GROUP") {
      if (currentBlock) {
        document.blocks.push(currentBlock);
      }

      currentBlock = {
        version: "4",
        groupLine: parsedLine,
        groupCode: parsedLine.tokens[1] ? parsedLine.tokens[1].value : "",
        headingRow: null,
        unitRow: null,
        typeRow: null,
        dataRows: []
      };
      continue;
    }

    if (!currentBlock) {
      document.parseDiagnostics.push({
        code: "AGS4-STRUCTURE",
        message: "Found AGS4 content before a GROUP row.",
        line: parsedLine.lineNumber,
        column: 1,
        endColumn: Math.max(2, parsedLine.raw.length + 1)
      });
      continue;
    }

    if (parsedLine.firstValue === "HEADING") {
      currentBlock.headingRow = parsedLine;
    } else if (parsedLine.firstValue === "UNIT") {
      currentBlock.unitRow = parsedLine;
    } else if (parsedLine.firstValue === "TYPE") {
      currentBlock.typeRow = parsedLine;
    } else {
      currentBlock.dataRows.push(parsedLine);
    }
  }

  if (currentBlock) {
    document.blocks.push(currentBlock);
  }

  return document;
}

module.exports = {
  parseAgs4
};
