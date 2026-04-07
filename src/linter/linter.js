"use strict";

const fs = require("fs");
const path = require("path");
const { detectVersion } = require("../detector");
const { parseAgs3 } = require("../parser/ags3Parser");
const { parseAgs4 } = require("../parser/ags4Parser");
const { AGS3_RULES } = require("../references/ags3Rules");
const { loadReferences, normalizeAgs3HeadingToken } = require("../references/extractors");
const { countNonAscii } = require("../utils/lineParser");

function createDiagnostic(code, severity, message, line, column, endColumn) {
  return {
    code,
    severity,
    message,
    line,
    column: column || 1,
    endColumn: endColumn || (column || 1) + 1
  };
}

function canonicalAgs3Heading(name) {
  return name && name.startsWith("?") ? name.slice(1) : name;
}

function getAgs3HeadingReference(headingRefs, headingCode) {
  if (!headingRefs) {
    return null;
  }

  if (headingRefs.has(headingCode)) {
    return headingRefs.get(headingCode);
  }

  const canonical = canonicalAgs3Heading(headingCode);
  if (headingRefs.has(canonical)) {
    return headingRefs.get(canonical);
  }

  const optionalVariant = `?${canonical}`;
  if (headingRefs.has(optionalVariant)) {
    return headingRefs.get(optionalVariant);
  }

  return null;
}

function resolveHeadingIndex(headingIndex, field) {
  if (headingIndex.has(field)) {
    return headingIndex.get(field);
  }

  if (field.startsWith("?")) {
    const withoutOptionalPrefix = field.slice(1);
    if (headingIndex.has(withoutOptionalPrefix)) {
      return headingIndex.get(withoutOptionalPrefix);
    }
  } else {
    const optionalVariant = `?${field}`;
    if (headingIndex.has(optionalVariant)) {
      return headingIndex.get(optionalVariant);
    }
  }

  return undefined;
}

function getRowFieldValue(row, field) {
  const index = resolveHeadingIndex(row.headingIndex, field);
  if (index === undefined) {
    return "";
  }

  return row.values[index] || "";
}

function lintText(text, options = {}) {
  const baseDir = options.baseDir || process.cwd();
  const references = options.references || loadReferences(baseDir);
  const detected = options.version ? { version: options.version, reason: "Forced by options." } : detectVersion(text);
  const document = detected.version === "3" ? parseAgs3(text) : parseAgs4(text);
  const suppressedCodesByLine = detected.version === "3"
    ? getAgs3SuppressedCodesByLine(document)
    : new Map();
  const diagnostics = document.parseDiagnostics.filter((diagnostic) => !shouldSuppressDiagnostic(diagnostic, suppressedCodesByLine));

  lintRawLines(document, diagnostics, detected.version);
  filterSuppressedDiagnostics(diagnostics, suppressedCodesByLine);

  if (detected.version === "3") {
    lintAgs3(document, diagnostics, references);
  } else {
    lintAgs4(document, diagnostics, references);
  }

  return {
    version: detected.version,
    reason: detected.reason,
    diagnostics,
    document
  };
}

function getAgs3SuppressedCodesByLine(document) {
  const suppressedCodesByLine = new Map();

  for (const block of document.blocks) {
    for (const logicalRow of [block.headingRow, block.unitsRow]) {
      if (!logicalRow || logicalRow.sourceLines.length <= 1) {
        continue;
      }

      for (const sourceLine of logicalRow.sourceLines) {
        if (!suppressedCodesByLine.has(sourceLine.lineNumber)) {
          suppressedCodesByLine.set(sourceLine.lineNumber, new Set());
        }

        suppressedCodesByLine.get(sourceLine.lineNumber).add("AGS-CSV");
        suppressedCodesByLine.get(sourceLine.lineNumber).add("AGS-QUOTE");
      }
    }
  }

  return suppressedCodesByLine;
}

function shouldSuppressDiagnostic(diagnostic, suppressedCodesByLine) {
  const codes = suppressedCodesByLine.get(diagnostic.line);
  return Boolean(codes && codes.has(diagnostic.code));
}

function filterSuppressedDiagnostics(diagnostics, suppressedCodesByLine) {
  for (let index = diagnostics.length - 1; index >= 0; index -= 1) {
    if (shouldSuppressDiagnostic(diagnostics[index], suppressedCodesByLine)) {
      diagnostics.splice(index, 1);
    }
  }
}

function lintAgs3LogicalRowContinuationShape(diagnostics, logicalRow, code, label) {
  if (!logicalRow || logicalRow.sourceLines.length <= 1) {
    return;
  }

  for (let index = 0; index < logicalRow.sourceLines.length - 1; index += 1) {
    const currentLine = logicalRow.sourceLines[index];
    const nextLine = logicalRow.sourceLines[index + 1];
    const trimmedCurrent = currentLine.raw.trimEnd();
    const trimmedNext = nextLine.raw.trimStart();

    if (!trimmedCurrent.endsWith(",")) {
      diagnostics.push(
        createDiagnostic(
          code,
          "error",
          `AGS3 ${label} continuation must split between complete ${label === "HEADING" ? "headings" : "units"} and end the continued line with a comma.`,
          currentLine.lineNumber,
          1,
          currentLine.raw.length + 1
        )
      );
    }

    if (!trimmedNext.startsWith("\"")) {
      diagnostics.push(
        createDiagnostic(
          code,
          "error",
          `AGS3 ${label} continuation lines must begin with a quoted ${label === "HEADING" ? "heading" : "unit"} value.`,
          nextLine.lineNumber,
          1,
          Math.max(2, nextLine.raw.length + 1)
        )
      );
    }
  }
}

function lintFile(filePath, options = {}) {
  const text = fs.readFileSync(filePath, "utf8");
  return lintText(text, {
    ...options,
    baseDir: options.baseDir || path.resolve(__dirname, "../..")
  });
}

function lintRawLines(document, diagnostics, version) {
  for (const line of document.lines) {
    for (const token of line.tokens) {
      if (!token.quoted && token.value !== "") {
        diagnostics.push(
          createDiagnostic("AGS-QUOTE", "error", "All AGS values must be wrapped in double quotes.", line.lineNumber, token.start, token.end + 1)
        );
      }

      if (token.quoted && token.value !== "" && token.value.trim() === "") {
        diagnostics.push(
          createDiagnostic("AGS-EMPTY", "warning", "Whitespace-only values should be represented as empty quotes.", line.lineNumber, token.start, token.end + 1)
        );
      }
    }

    if (/\t/.test(line.raw)) {
      const column = line.raw.indexOf("\t") + 1;
      diagnostics.push(createDiagnostic("AGS-DELIM", "error", "Tab characters are not valid AGS delimiters.", line.lineNumber, column, column + 1));
    }

    if (version === "3" && line.raw.length > AGS3_RULES.maxLineLength) {
      diagnostics.push(
        createDiagnostic(
          "AGS3-LENGTH",
          "warning",
          `AGS3 lines must not exceed ${AGS3_RULES.maxLineLength} characters.`,
          line.lineNumber,
          AGS3_RULES.maxLineLength + 1,
          line.raw.length + 1
        )
      );
    }
  }
}

function lintAgs3(document, diagnostics, references) {
  const fileGroupNames = new Set();
  const rowsByGroup = new Map();
  const customNamesSeen = { groups: false, headings: false };

  for (const line of document.lines) {
    for (const column of countNonAscii(line.raw)) {
      diagnostics.push(createDiagnostic("AGS3-ASCII", "error", "AGS3 files must contain ASCII characters only.", line.lineNumber, column, column + 1));
    }
  }

  for (const block of document.blocks) {
    const groupCode = block.groupCode;
    const baseGroupCode = groupCode.replace(/^\?/, "");
    const groupRef = references.ags3.groups.get(groupCode);
    const headingRefs = references.ags3.headingsByGroup.get(groupCode);
    const keyEntries = references.ags3Keys.keysByGroup.get(groupCode) || [];
    const keyFields = keyEntries.map((entry) => entry.field);
    const headingIndex = new Map();

    fileGroupNames.add(groupCode);
    if (!rowsByGroup.has(groupCode)) {
      rowsByGroup.set(groupCode, []);
    }

    if (!groupRef && !groupCode.startsWith("?")) {
      diagnostics.push(createDiagnostic("AGS3-GROUP", "warning", `Unknown AGS3 group "${groupCode}".`, block.groupLine.lineNumber, 1, block.groupLine.raw.length + 1));
    }

    if (groupCode.startsWith("?")) {
      customNamesSeen.groups = true;
      if (!/^\?[A-Z]{1,4}$/.test(groupCode)) {
        diagnostics.push(createDiagnostic("AGS3-CUSTOM-GROUP", "error", "Custom AGS3 group names must match ?NAME with up to 4 uppercase letters.", block.groupLine.lineNumber, 1, block.groupLine.raw.length + 1));
      }
    }

    if (!block.headingRow) {
      diagnostics.push(createDiagnostic("AGS3-HEADINGS", "error", "AGS3 groups must include a heading row.", block.groupLine.lineNumber, 1, block.groupLine.raw.length + 1));
      continue;
    }

    lintAgs3LogicalRowContinuationShape(diagnostics, block.headingRow, "AGS3-HEADING-CONT", "HEADING");
    lintAgs3LogicalRowContinuationShape(diagnostics, block.unitsRow, "AGS3-UNITS-CONT", "UNIT");

    if (block.headingCodes.length > AGS3_RULES.maxHeadingsPerGroup) {
      diagnostics.push(createDiagnostic("AGS3-HEADING-COUNT", "error", `AGS3 groups must not contain more than ${AGS3_RULES.maxHeadingsPerGroup} headings.`, block.headingRow.startLine, 1, block.headingRow.sourceLines[0].raw.length + 1));
    }

    if (!AGS3_RULES.unitExemptGroups.has(baseGroupCode) && !block.unitsRow) {
      diagnostics.push(createDiagnostic("AGS3-UNITS", "error", `AGS3 group "${groupCode}" requires a <UNITS> row.`, block.headingRow.startLine, 1, block.headingRow.sourceLines[0].raw.length + 1));
    }

    const expectedColumnCount = block.headingRow.cells.length;
    if (block.unitsRow && block.unitsRow.cells.length !== expectedColumnCount) {
      diagnostics.push(
        createDiagnostic(
          "AGS3-COLUMNS",
          "error",
          `AGS3 <UNITS> row column count must match the heading row. Heading count: ${expectedColumnCount}. Row count: ${block.unitsRow.cells.length}.`,
          block.unitsRow.startLine,
          1,
          block.unitsRow.sourceLines[0].raw.length + 1
        )
      );
    }

    for (const [index, cell] of block.headingRow.cells.entries()) {
      const headingCode = normalizeAgs3HeadingToken(cell.value);
      headingIndex.set(headingCode, index);
      const headingRef = getAgs3HeadingReference(headingRefs, headingCode);

      if (headingCode.startsWith("?") && !headingRef) {
        customNamesSeen.headings = true;
        if (!/^\?[A-Z0-9_]{1,9}$/.test(headingCode)) {
          diagnostics.push(createDiagnostic("AGS3-CUSTOM-HEADING", "error", "Custom AGS3 headings must match ?NAME with up to 9 uppercase, numeric, or underscore characters.", block.headingRow.startLine, cell.start, cell.end + 1));
        }
      }

      if (!headingRef && !headingCode.startsWith("?")) {
        diagnostics.push(createDiagnostic("AGS3-HEADING", "info", `Heading "${headingCode}" is not defined for AGS3 group "${groupCode}".`, block.headingRow.startLine, cell.start, cell.end + 1));
      }

      if (headingRef && headingRef.code !== headingCode) {
        diagnostics.push(
          createDiagnostic(
            "AGS3-HEADING-STANDARD",
            "info",
            `Standard AGS 3.1 HEADING is "${headingRef.code}".`,
            block.headingRow.startLine,
            cell.start,
            cell.end + 1
          )
        );
      }
    }

    for (const keyField of keyFields) {
      if (resolveHeadingIndex(headingIndex, keyField) === undefined) {
        diagnostics.push(createDiagnostic("AGS3-KEY", "warning", `AGS3 key field "${keyField}" is missing from group "${groupCode}".`, block.headingRow.startLine, 1, block.headingRow.sourceLines[0].raw.length + 1));
      }
    }

    if (groupCode === "PROJ" && canonicalAgs3Heading(block.headingCodes[0]) !== "PROJ_ID") {
      diagnostics.push(createDiagnostic("AGS3-KEY-ORDER", "warning", 'AGS3 group "PROJ" should begin with "*PROJ_ID".', block.headingRow.startLine, 1, block.headingRow.sourceLines[0].raw.length + 1));
    }

    if (
      groupCode !== "PROJ" &&
      !AGS3_RULES.holeIdExemptGroups.has(baseGroupCode) &&
      (resolveHeadingIndex(headingIndex, "HOLE_ID") !== undefined) &&
      canonicalAgs3Heading(block.headingCodes[0]) !== "HOLE_ID"
    ) {
      diagnostics.push(createDiagnostic("AGS3-KEY-ORDER", "warning", `AGS3 group "${groupCode}" should begin with "*HOLE_ID".`, block.headingRow.startLine, 1, block.headingRow.sourceLines[0].raw.length + 1));
    }

    if (block.unitsRow) {
      for (const [index, cell] of block.unitsRow.cells.entries()) {
        if (index === 0) {
          if (cell.value !== "<UNITS>") {
            diagnostics.push(createDiagnostic("AGS3-UNITS", "error", 'AGS3 unit rows must start with "<UNITS>".', block.unitsRow.startLine, cell.start, cell.end + 1));
          }
          continue;
        }

        const headingCode = block.headingCodes[index];
        const expectedHeading = getAgs3HeadingReference(headingRefs, headingCode);
        if (expectedHeading && expectedHeading.unit !== cell.value) {
          diagnostics.push(createDiagnostic("AGS3-UNIT-VALUE", "warning", `Unit "${cell.value}" does not match the AGS3 reference unit "${expectedHeading.unit}" for "${headingCode}".`, block.unitsRow.startLine, cell.start, cell.end + 1));
        }
      }
    }

    for (const dataRow of block.dataRows) {
      if (dataRow.cells.length !== expectedColumnCount) {
        diagnostics.push(
          createDiagnostic(
            "AGS3-COLUMNS",
            "error",
            `AGS3 data row column count must match the heading row. Heading count: ${expectedColumnCount}. Row count: ${dataRow.cells.length}.`,
            dataRow.lineNumber,
            1,
            dataRow.raw.length + 1
          )
        );
      }

      if (dataRow.kind === "continuation") {
        if (!dataRow.cells[0] || dataRow.cells[0].value !== "<CONT>") {
          diagnostics.push(createDiagnostic("AGS3-CONT", "error", 'AGS3 data continuation rows must begin with "<CONT>".', dataRow.lineNumber, 1, Math.max(2, dataRow.raw.length + 1)));
        }
        continue;
      }

      rowsByGroup.get(groupCode).push({
        lineNumber: dataRow.lineNumber,
        values: dataRow.cells.map((cell) => cell.value),
        headingIndex
      });
    }
  }

  for (const requiredGroup of AGS3_RULES.mandatoryGroups) {
    if (!fileGroupNames.has(requiredGroup)) {
      diagnostics.push(createDiagnostic("AGS3-MISSING-GROUP", "error", `AGS3 files must contain the "${requiredGroup}" group.`, 1, 1, 2));
    }
  }

  for (const recommendedGroup of AGS3_RULES.recommendedGroups) {
    if (!fileGroupNames.has(recommendedGroup)) {
      diagnostics.push(createDiagnostic("AGS3-RECOMMENDED-GROUP", "warning", `AGS3 files are expected to contain the "${recommendedGroup}" group.`, 1, 1, 2));
    }
  }

  if ((customNamesSeen.groups || customNamesSeen.headings) && !fileGroupNames.has("DICT")) {
    diagnostics.push(createDiagnostic("AGS3-DICT", "error", "AGS3 files that use custom groups or headings must contain a DICT group.", 1, 1, 2));
  }

  if (Array.from(fileGroupNames).some((name) => AGS3_RULES.codeRequiredWhenGroupsPresent.has(name)) && !fileGroupNames.has("CODE")) {
    diagnostics.push(createDiagnostic("AGS3-CODE", "error", "AGS3 files containing CNMT or ?ICCT data must contain a CODE group.", 1, 1, 2));
  }

  lintAgs3KeyUniqueness(diagnostics, references, rowsByGroup);
  lintAgs3ParentReferences(diagnostics, references, rowsByGroup);
}

function lintAgs3KeyUniqueness(diagnostics, references, rowsByGroup) {
  for (const [groupCode, rows] of rowsByGroup.entries()) {
    const keyFields = (references.ags3Keys.keysByGroup.get(groupCode) || []).map((entry) => entry.field);
    if (!keyFields.length) {
      continue;
    }

    const seen = new Map();
    for (const row of rows) {
      const signature = keyFields.map((field) => getRowFieldValue(row, field)).join("\u0001");
      if (seen.has(signature)) {
        diagnostics.push(createDiagnostic("AGS3-KEY-DUP", "warning", `Duplicate AGS3 key combination in group "${groupCode}".`, row.lineNumber, 1, 2));
      } else {
        seen.set(signature, row.lineNumber);
      }
    }
  }
}

function lintAgs3ParentReferences(diagnostics, references, rowsByGroup) {
  const pkRowsByGroup = new Map();

  for (const [groupCode, rows] of rowsByGroup.entries()) {
    const pkFields = (references.ags3Keys.keysByGroup.get(groupCode) || [])
      .filter((entry) => entry.keyType === "PK")
      .map((entry) => entry.field);
    if (!pkFields.length) {
      continue;
    }

    pkRowsByGroup.set(
      groupCode,
      new Set(rows.map((row) => pkFields.map((field) => getRowFieldValue(row, field)).join("\u0001")))
    );
  }

  for (const [groupCode, rows] of rowsByGroup.entries()) {
    const fkFields = (references.ags3Keys.keysByGroup.get(groupCode) || [])
      .filter((entry) => entry.keyType === "FK")
      .map((entry) => entry.field);
    if (!fkFields.length) {
      continue;
    }

    const candidates = (references.ags3Keys.pkSignatureToGroups.get(fkFields.join("|")) || []).filter((candidate) => candidate !== groupCode);
    if (candidates.length !== 1 || !pkRowsByGroup.has(candidates[0])) {
      continue;
    }

    const parentGroup = candidates[0];
    const parentRows = pkRowsByGroup.get(parentGroup);

    for (const row of rows) {
      const signature = fkFields.map((field) => getRowFieldValue(row, field)).join("\u0001");
      if (!parentRows.has(signature)) {
        diagnostics.push(createDiagnostic("AGS3-PARENT", "warning", `Could not resolve AGS3 parent reference from "${groupCode}" to "${parentGroup}".`, row.lineNumber, 1, 2));
      }
    }
  }
}

function lintAgs4(document, diagnostics, references) {
  for (const block of document.blocks) {
    if (block.groupLine.tokens.length !== 2) {
      diagnostics.push(createDiagnostic("AGS4-GROUP", "error", "AGS4 GROUP rows must contain exactly two fields.", block.groupLine.lineNumber, 1, block.groupLine.raw.length + 1));
    }

    if (!references.ags4.groups.has(block.groupCode)) {
      diagnostics.push(createDiagnostic("AGS4-GROUP", "warning", `Unknown AGS4 group "${block.groupCode}".`, block.groupLine.lineNumber, 1, block.groupLine.raw.length + 1));
    }

    if (!block.headingRow) {
      diagnostics.push(createDiagnostic("AGS4-HEADINGS", "error", "AGS4 groups must contain a HEADING row.", block.groupLine.lineNumber, 1, block.groupLine.raw.length + 1));
      continue;
    }

    if (!block.typeRow) {
      diagnostics.push(createDiagnostic("AGS4-TYPE", "error", "AGS4 groups must contain a TYPE row.", block.groupLine.lineNumber, 1, block.groupLine.raw.length + 1));
      continue;
    }

    const headings = block.headingRow.tokens.slice(1).map((token) => token.value);
    const headingSet = new Set(headings);
    const headingRef = references.ags4.headingsByGroup.get(block.groupCode) || new Map();
    const expectedColumnCount = block.headingRow.tokens.length;

    for (const ref of headingRef.values()) {
      if (ref.status && ref.status.includes("REQUIRED") && !headingSet.has(ref.code)) {
        diagnostics.push(
          createDiagnostic(
            "AGS4-REQUIRED",
            "error",
            `Required AGS4 heading "${ref.code}" is missing from group "${block.groupCode}" (DICT_STAT="${ref.status}").`,
            block.headingRow.lineNumber,
            1,
            block.headingRow.raw.length + 1
          )
        );
      }
    }

    if (block.unitRow && block.unitRow.tokens.length !== expectedColumnCount) {
      diagnostics.push(createDiagnostic("AGS4-COLUMNS", "error", "AGS4 UNIT rows must match the HEADING row column count.", block.unitRow.lineNumber, 1, block.unitRow.raw.length + 1));
    }

    if (block.typeRow.tokens.length !== expectedColumnCount) {
      diagnostics.push(createDiagnostic("AGS4-COLUMNS", "error", "AGS4 TYPE rows must match the HEADING row column count.", block.typeRow.lineNumber, 1, block.typeRow.raw.length + 1));
    }

    for (const dataRow of block.dataRows) {
      if (dataRow.tokens.length !== expectedColumnCount) {
        diagnostics.push(createDiagnostic("AGS4-COLUMNS", "error", "AGS4 DATA rows must match the HEADING row column count.", dataRow.lineNumber, 1, dataRow.raw.length + 1));
      }
    }

    for (const [index, heading] of headings.entries()) {
      const headingToken = block.headingRow.tokens[index + 1];
      const ref = headingRef.get(heading);
      if (!ref) {
        diagnostics.push(createDiagnostic("AGS4-HEADING", "warning", `Heading "${heading}" is not defined for AGS4 group "${block.groupCode}".`, block.headingRow.lineNumber, headingToken.start, headingToken.end + 1));
        continue;
      }

      const actualType = block.typeRow.tokens[index + 1] ? block.typeRow.tokens[index + 1].value : "";
      if (ref.dataType && actualType !== ref.dataType) {
        diagnostics.push(createDiagnostic("AGS4-TYPE", "error", `TYPE "${actualType}" does not match AGS4 reference type "${ref.dataType}" for "${heading}".`, block.typeRow.lineNumber, block.typeRow.tokens[index + 1].start, block.typeRow.tokens[index + 1].end + 1));
      }

      if (block.unitRow) {
        const actualUnit = block.unitRow.tokens[index + 1] ? block.unitRow.tokens[index + 1].value : "";
        if (actualUnit !== ref.unit) {
          diagnostics.push(createDiagnostic("AGS4-UNIT", "warning", `UNIT "${actualUnit}" does not match AGS4 reference unit "${ref.unit}" for "${heading}".`, block.unitRow.lineNumber, block.unitRow.tokens[index + 1].start, block.unitRow.tokens[index + 1].end + 1));
        }
      }
    }
  }
}

module.exports = {
  lintFile,
  lintText
};
