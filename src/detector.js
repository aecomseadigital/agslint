"use strict";

const { parseCsvLine, splitLinesDetailed } = require("./utils/lineParser");

function parseNonBlankLines(text) {
  const lines = [];

  for (const sourceLine of splitLinesDetailed(text)) {
    const rawLine = sourceLine.raw;
    if (!rawLine.trim()) {
      continue;
    }

    lines.push(parseCsvLine(rawLine, sourceLine.lineNumber));
  }

  return lines;
}

function majorFromEdition(edition) {
  if (!edition) {
    return null;
  }

  const trimmed = edition.trim();
  if (trimmed.startsWith("3")) {
    return "3";
  }

  if (trimmed.startsWith("4")) {
    return "4";
  }

  return null;
}

function detectAgs3Edition(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.firstValue !== "**PROJ") {
      continue;
    }

    const headingLine = lines[index + 1];
    if (!headingLine || !headingLine.firstValue.startsWith("*")) {
      return null;
    }

    const headings = headingLine.tokens.map((token) => token.value.startsWith("*") ? token.value.slice(1) : token.value);
    const projAgsIndex = headings.indexOf("PROJ_AGS");
    if (projAgsIndex === -1) {
      return null;
    }

    for (let cursor = index + 2; cursor < lines.length; cursor += 1) {
      const row = lines[cursor];

      if (row.firstValue.startsWith("**")) {
        break;
      }

      if (row.firstValue === "<UNITS>" || row.firstValue === "<CONT>") {
        continue;
      }

      const edition = row.tokens[projAgsIndex] ? row.tokens[projAgsIndex].value : "";
      const version = majorFromEdition(edition);

      if (version) {
        return {
          version,
          edition,
          source: "PROJ_AGS",
          reason: `Detected AGS${version} from PROJ_AGS="${edition}".`
        };
      }
    }
  }

  return null;
}

function detectAgs4Edition(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.firstValue !== "GROUP" || !line.tokens[1] || line.tokens[1].value !== "TRAN") {
      continue;
    }

    const headingLine = lines[index + 1];
    if (!headingLine || headingLine.firstValue !== "HEADING") {
      return null;
    }

    const headings = headingLine.tokens.slice(1).map((token) => token.value);
    const tranAgsIndex = headings.indexOf("TRAN_AGS");
    if (tranAgsIndex === -1) {
      return null;
    }

    for (let cursor = index + 2; cursor < lines.length; cursor += 1) {
      const row = lines[cursor];

      if (row.firstValue === "GROUP") {
        break;
      }

      if (row.firstValue !== "DATA") {
        continue;
      }

      const edition = row.tokens[tranAgsIndex + 1] ? row.tokens[tranAgsIndex + 1].value : "";
      const version = majorFromEdition(edition);

      if (version) {
        return {
          version,
          edition,
          source: "TRAN_AGS",
          reason: `Detected AGS${version} from TRAN_AGS="${edition}".`
        };
      }
    }
  }

  return null;
}

function detectVersion(text) {
  const lines = parseNonBlankLines(text);
  const declaredAgs4 = detectAgs4Edition(lines);
  if (declaredAgs4) {
    return declaredAgs4;
  }

  const declaredAgs3 = detectAgs3Edition(lines);
  if (declaredAgs3) {
    return declaredAgs3;
  }

  for (const parsed of lines) {
    if (parsed.firstValue === "GROUP") {
      return { version: "4", edition: null, source: "structure", reason: 'First non-blank line starts with "GROUP".' };
    }

    if (parsed.firstValue.startsWith("**")) {
      return { version: "3", edition: null, source: "structure", reason: "First non-blank line starts with **." };
    }
  }

  return {
    version: "4",
    edition: null,
    source: "default",
    reason: "Defaulted to AGS4 because no version marker was found."
  };
}

module.exports = {
  detectVersion
};
