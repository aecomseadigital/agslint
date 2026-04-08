"use strict";

const fs = require("fs");
const path = require("path");
const { detectVersion } = require("../detector");
const { parseAgs3 } = require("../parser/ags3Parser");
const { parseAgs4 } = require("../parser/ags4Parser");
const { AGS3_RULES } = require("../references/ags3Rules");
const { loadReferences, normalizeAgs3HeadingToken } = require("../references/extractors");
const { countNonAscii } = require("../utils/lineParser");
const { convertGenericCsvDiagnostic, createRuleDiagnostic } = require("./diagnostics");

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

function createAgs3Diagnostic(ruleId, checkId, severity, message, line, column, endColumn, extra = {}) {
  return createRuleDiagnostic("AGS3", ruleId, checkId, severity, message, line, column, endColumn, extra);
}

function createAgs4Diagnostic(ruleId, checkId, severity, message, line, column, endColumn, extra = {}) {
  return createRuleDiagnostic("AGS4", ruleId, checkId, severity, message, line, column, endColumn, extra);
}

function normalizeParseDiagnostics(parseDiagnostics, version) {
  return parseDiagnostics.map((diagnostic) => {
    if (diagnostic.checkId && diagnostic.ruleId) {
      return diagnostic;
    }

    if (diagnostic.code === "AGS-CSV") {
      return convertGenericCsvDiagnostic(diagnostic, version);
    }

    return diagnostic;
  });
}

function lintText(text, options = {}) {
  const baseDir = options.baseDir || process.cwd();
  const references = options.references || loadReferences(baseDir);
  const detected = options.version ? { version: options.version, reason: "Forced by options." } : detectVersion(text);
  const document = detected.version === "3" ? parseAgs3(text) : parseAgs4(text);
  const suppressedCheckIdsByLine = detected.version === "3"
    ? getAgs3SuppressedChecksByLine(document)
    : new Map();
  const diagnostics = normalizeParseDiagnostics(document.parseDiagnostics, detected.version)
    .filter((diagnostic) => !shouldSuppressDiagnostic(diagnostic, suppressedCheckIdsByLine));

  lintRawLines(document, diagnostics, detected.version);
  filterSuppressedDiagnostics(diagnostics, suppressedCheckIdsByLine);

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

function getAgs3SuppressedChecksByLine(document) {
  const suppressedChecksByLine = new Map();

  for (const block of document.blocks) {
    for (const logicalRow of [block.headingRow, block.unitsRow]) {
      if (!logicalRow || logicalRow.sourceLines.length <= 1) {
        continue;
      }

      for (const sourceLine of logicalRow.sourceLines) {
        if (!suppressedChecksByLine.has(sourceLine.lineNumber)) {
          suppressedChecksByLine.set(sourceLine.lineNumber, new Set());
        }

        suppressedChecksByLine.get(sourceLine.lineNumber).add("ags3.csv.unterminated");
        suppressedChecksByLine.get(sourceLine.lineNumber).add("ags3.csv.delimiter");
        suppressedChecksByLine.get(sourceLine.lineNumber).add("ags3.quote.unquoted");
      }
    }
  }

  return suppressedChecksByLine;
}

function shouldSuppressDiagnostic(diagnostic, suppressedChecksByLine) {
  const checks = suppressedChecksByLine.get(diagnostic.line);
  return Boolean(checks && diagnostic.checkId && checks.has(diagnostic.checkId));
}

function filterSuppressedDiagnostics(diagnostics, suppressedChecksByLine) {
  for (let index = diagnostics.length - 1; index >= 0; index -= 1) {
    if (shouldSuppressDiagnostic(diagnostics[index], suppressedChecksByLine)) {
      diagnostics.splice(index, 1);
    }
  }
}

function lintRawLines(document, diagnostics, version) {
  for (const line of document.lines) {
    if (version === "3") {
      for (const column of countNonAscii(line.raw)) {
        diagnostics.push(createAgs3Diagnostic("1", "ags3.ascii.non-ascii", "error", "AGS3 files must contain ASCII characters only.", line.lineNumber, column, column + 1));
      }
    } else {
      if (line.hasBom) {
        diagnostics.push(createAgs4Diagnostic("1", "ags4.ascii.bom", "error", "AGS4 files should not include a byte-order mark (BOM).", line.lineNumber, 1, 2));
      }

      for (const column of countNonAscii(line.raw)) {
        diagnostics.push(createAgs4Diagnostic("1", "ags4.ascii.non-ascii", "error", "AGS4 files must contain ASCII characters only.", line.lineNumber, column, column + 1));
      }

      if (line.eol && line.eol !== "\r\n") {
        diagnostics.push(createAgs4Diagnostic("2A", "ags4.line-ending.crlf", "warning", "AGS4 lines should be terminated by <CR><LF>.", line.lineNumber, 1, Math.max(2, line.raw.length + 1)));
      }
    }

    for (const token of line.tokens) {
      if (!token.quoted && token.value !== "") {
        diagnostics.push(
          version === "3"
            ? createAgs3Diagnostic("8", "ags3.quote.unquoted", "error", "All AGS values must be wrapped in double quotes.", line.lineNumber, token.start, token.end + 1)
            : createAgs4Diagnostic("5", "ags4.quote.unquoted", "error", "All AGS values must be wrapped in double quotes.", line.lineNumber, token.start, token.end + 1)
        );
      }

      if (token.quoted && token.value !== "" && token.value.trim() === "") {
        diagnostics.push(
          version === "3"
            ? createAgs3Diagnostic("15", "ags3.null.whitespace", "warning", "Whitespace-only values should be represented as empty quotes.", line.lineNumber, token.start, token.end + 1)
            : createAgs4Diagnostic("5", "ags4.quote.whitespace", "warning", "Whitespace-only values should usually be represented as empty quotes.", line.lineNumber, token.start, token.end + 1)
        );
      }
    }

    if (/\t/.test(line.raw)) {
      const column = line.raw.indexOf("\t") + 1;
      diagnostics.push(
        version === "3"
          ? createAgs3Diagnostic("9", "ags3.delimiter.tab", "error", "Tab characters are not valid AGS delimiters.", line.lineNumber, column, column + 1)
          : createAgs4Diagnostic("6", "ags4.delimiter.tab", "error", "Tab characters are not valid AGS delimiters.", line.lineNumber, column, column + 1)
      );
    }

    if (version === "3" && line.raw.length > AGS3_RULES.maxLineLength) {
      diagnostics.push(
        createAgs3Diagnostic(
          "12",
          "ags3.line.length",
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

function lintAgs3LogicalRowContinuationShape(diagnostics, logicalRow, ruleId, checkId, label) {
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
        createAgs3Diagnostic(
          ruleId,
          `${checkId}.comma`,
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
        createAgs3Diagnostic(
          ruleId,
          `${checkId}.quote`,
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

function lintAgs3(document, diagnostics, references) {
  const fileGroupNames = new Set();
  const rowsByGroup = new Map();
  const customNamesSeen = { groups: false, headings: false };

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
      diagnostics.push(createAgs3Diagnostic("5", "ags3.group.unknown", "warning", `Unknown AGS3 group "${groupCode}".`, block.groupLine.lineNumber, 1, block.groupLine.raw.length + 1));
    }

    if (groupCode.startsWith("?")) {
      customNamesSeen.groups = true;
      if (!/^\?[A-Z]{1,4}$/.test(groupCode)) {
        diagnostics.push(createAgs3Diagnostic("22", "ags3.group.custom-pattern", "error", "Custom AGS3 group names must match ?NAME with up to 4 uppercase letters.", block.groupLine.lineNumber, 1, block.groupLine.raw.length + 1));
      }
    }

    if (!block.headingRow) {
      diagnostics.push(createAgs3Diagnostic("4", "ags3.heading.missing", "error", "AGS3 groups must include a heading row.", block.groupLine.lineNumber, 1, block.groupLine.raw.length + 1));
      continue;
    }

    lintAgs3LogicalRowContinuationShape(diagnostics, block.headingRow, "13", "ags3.heading.continuation", "HEADING");
    lintAgs3LogicalRowContinuationShape(diagnostics, block.unitsRow, "18A", "ags3.units.continuation", "UNIT");

    if (block.headingCodes.length > AGS3_RULES.maxHeadingsPerGroup) {
      diagnostics.push(createAgs3Diagnostic("17", "ags3.heading.count", "error", `AGS3 groups must not contain more than ${AGS3_RULES.maxHeadingsPerGroup} headings.`, block.headingRow.startLine, 1, block.headingRow.sourceLines[0].raw.length + 1));
    }

    if (!AGS3_RULES.unitExemptGroups.has(baseGroupCode) && !block.unitsRow) {
      diagnostics.push(createAgs3Diagnostic("18", "ags3.units.missing", "error", `AGS3 group "${groupCode}" requires a <UNITS> row.`, block.headingRow.startLine, 1, block.headingRow.sourceLines[0].raw.length + 1));
    }

    const expectedColumnCount = block.headingRow.cells.length;
    if (block.unitsRow && block.unitsRow.cells.length !== expectedColumnCount) {
      diagnostics.push(
        createAgs3Diagnostic(
          "18",
          "ags3.units.columns",
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
          diagnostics.push(createAgs3Diagnostic("23", "ags3.heading.custom-pattern", "error", "Custom AGS3 headings must match ?NAME with up to 9 uppercase, numeric, or underscore characters.", block.headingRow.startLine, cell.start, cell.end + 1));
        }
      }

      if (!headingRef && !headingCode.startsWith("?")) {
        diagnostics.push(createAgs3Diagnostic("5", "ags3.heading.unknown", "information", `Heading "${headingCode}" is not defined for AGS3 group "${groupCode}".`, block.headingRow.startLine, cell.start, cell.end + 1));
      }

      if (headingRef && headingRef.code !== headingCode) {
        diagnostics.push(
          createAgs3Diagnostic(
            "5",
            "ags3.heading.standard",
            "information",
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
        diagnostics.push(createAgs3Diagnostic("6", "ags3.key.missing", "warning", `AGS3 key field "${keyField}" is missing from group "${groupCode}".`, block.headingRow.startLine, 1, block.headingRow.sourceLines[0].raw.length + 1));
      }
    }

    if (groupCode === "PROJ" && canonicalAgs3Heading(block.headingCodes[0]) !== "PROJ_ID") {
      diagnostics.push(createAgs3Diagnostic("6A", "ags3.key.order", "warning", 'AGS3 group "PROJ" should begin with "*PROJ_ID".', block.headingRow.startLine, 1, block.headingRow.sourceLines[0].raw.length + 1));
    }

    if (
      groupCode !== "PROJ" &&
      !AGS3_RULES.holeIdExemptGroups.has(baseGroupCode) &&
      (resolveHeadingIndex(headingIndex, "HOLE_ID") !== undefined) &&
      canonicalAgs3Heading(block.headingCodes[0]) !== "HOLE_ID"
    ) {
      diagnostics.push(createAgs3Diagnostic("6A", "ags3.key.order", "warning", `AGS3 group "${groupCode}" should begin with "*HOLE_ID".`, block.headingRow.startLine, 1, block.headingRow.sourceLines[0].raw.length + 1));
    }

    if (block.unitsRow) {
      for (const [index, cell] of block.unitsRow.cells.entries()) {
        if (index === 0) {
          if (cell.value !== "<UNITS>") {
            diagnostics.push(createAgs3Diagnostic("18", "ags3.units.first-cell", "error", 'AGS3 unit rows must start with "<UNITS>".', block.unitsRow.startLine, cell.start, cell.end + 1));
          }
          continue;
        }

        const headingCode = block.headingCodes[index];
        const expectedHeading = getAgs3HeadingReference(headingRefs, headingCode);
        if (expectedHeading && expectedHeading.unit !== cell.value) {
          diagnostics.push(createAgs3Diagnostic("18", "ags3.units.reference", "warning", `Unit "${cell.value}" does not match the AGS3 reference unit "${expectedHeading.unit}" for "${headingCode}".`, block.unitsRow.startLine, cell.start, cell.end + 1));
        }
      }
    }

    for (const dataRow of block.dataRows) {
      if (dataRow.cells.length !== expectedColumnCount) {
        diagnostics.push(
          createAgs3Diagnostic(
            "4",
            "ags3.data.columns",
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
          diagnostics.push(createAgs3Diagnostic("14", "ags3.cont.first-cell", "error", 'AGS3 data continuation rows must begin with "<CONT>".', dataRow.lineNumber, 1, Math.max(2, dataRow.raw.length + 1)));
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
    if (fileGroupNames.has(requiredGroup)) {
      continue;
    }

    if (requiredGroup === "PROJ") {
      diagnostics.push(createAgs3Diagnostic("19", "ags3.group.proj-missing", "error", 'AGS3 files must contain the "PROJ" group.', 1, 1, 2));
    } else if (requiredGroup === "UNIT") {
      diagnostics.push(createAgs3Diagnostic("18B", "ags3.group.unit-missing", "error", 'AGS3 files must contain the "UNIT" group.', 1, 1, 2));
    } else if (requiredGroup === "ABBR") {
      diagnostics.push(createAgs3Diagnostic("20", "ags3.group.abbr-missing", "error", 'AGS3 files must contain the "ABBR" group.', 1, 1, 2));
    }
  }

  if ((customNamesSeen.groups || customNamesSeen.headings) && !fileGroupNames.has("DICT")) {
    diagnostics.push(createAgs3Diagnostic("21", "ags3.group.dict-missing", "error", "AGS3 files that use custom groups or headings must contain a DICT group.", 1, 1, 2));
  }

  if (Array.from(fileGroupNames).some((name) => AGS3_RULES.codeRequiredWhenGroupsPresent.has(name)) && !fileGroupNames.has("CODE")) {
    diagnostics.push(createAgs3Diagnostic("25", "ags3.group.code-missing", "error", "AGS3 files containing CNMT or ?ICCT data must contain a CODE group.", 1, 1, 2));
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
        diagnostics.push(createAgs3Diagnostic("6B", "ags3.key.duplicate", "warning", `Duplicate AGS3 key combination in group "${groupCode}".`, row.lineNumber, 1, 2));
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
        diagnostics.push(createAgs3Diagnostic("6C", "ags3.parent.missing", "warning", `Could not resolve AGS3 parent reference from "${groupCode}" to "${parentGroup}".`, row.lineNumber, 1, 2));
      }
    }
  }
}

function cloneAgs4References(ags4References) {
  return {
    groups: new Map(Array.from(ags4References.groups.entries()).map(([code, group]) => [code, { ...group }])),
    headingsByGroup: new Map(
      Array.from(ags4References.headingsByGroup.entries()).map(([group, headings]) => [
        group,
        new Map(Array.from(headings.entries()).map(([code, heading]) => [code, { ...heading }]))
      ])
    )
  };
}

function getAgs4PrimaryDataRows(block) {
  return block.dataRows.filter((row) => row.firstValue === "DATA");
}

function decorateAgs4Block(block) {
  const headingRow = block.headingRow;
  const headings = headingRow ? headingRow.tokens.slice(1).map((token) => token.value) : [];
  const headingIndex = new Map(headings.map((heading, index) => [heading, index]));
  return {
    ...block,
    headings,
    headingIndex,
    primaryDataRows: getAgs4PrimaryDataRows(block)
  };
}

function getAgs4RowValue(table, row, field) {
  const index = table.headingIndex.get(field);
  if (index === undefined) {
    return "";
  }

  return row.tokens[index + 1] ? row.tokens[index + 1].value : "";
}

function buildMergedAgs4References(references, tablesByGroup) {
  const merged = cloneAgs4References(references.ags4);
  const dictTable = tablesByGroup.get("DICT");

  if (!dictTable || !dictTable.headingRow) {
    return merged;
  }

  const requiredFields = ["DICT_TYPE", "DICT_GRP", "DICT_DESC"];
  for (const field of requiredFields) {
    if (!dictTable.headingIndex.has(field)) {
      return merged;
    }
  }

  for (const row of dictTable.primaryDataRows) {
    const type = getAgs4RowValue(dictTable, row, "DICT_TYPE");
    const group = getAgs4RowValue(dictTable, row, "DICT_GRP");
    const heading = getAgs4RowValue(dictTable, row, "DICT_HDNG");

    if (type === "GROUP" && group) {
      merged.groups.set(group, {
        code: group,
        description: getAgs4RowValue(dictTable, row, "DICT_DESC"),
        parentGroup: getAgs4RowValue(dictTable, row, "DICT_PGRP") || null
      });
      if (!merged.headingsByGroup.has(group)) {
        merged.headingsByGroup.set(group, new Map());
      }
      continue;
    }

    if (type === "HEADING" && group && heading) {
      if (!merged.headingsByGroup.has(group)) {
        merged.headingsByGroup.set(group, new Map());
      }

      merged.headingsByGroup.get(group).set(heading, {
        group,
        code: heading,
        status: getAgs4RowValue(dictTable, row, "DICT_STAT"),
        dataType: getAgs4RowValue(dictTable, row, "DICT_DTYP"),
        description: getAgs4RowValue(dictTable, row, "DICT_DESC"),
        unit: getAgs4RowValue(dictTable, row, "DICT_UNIT")
      });
    }
  }

  return merged;
}

function escapeRegexLiteral(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validateDpValue(value, scale) {
  if (value === "") {
    return true;
  }

  if (scale === 0) {
    return /^-?\d+\.?$/.test(value);
  }

  return new RegExp(`^-?\\d+\\.\\d{${scale}}$`).test(value);
}

function validateScientificValue(value, scale) {
  if (value === "") {
    return true;
  }

  return new RegExp(`^-?\\d\\.\\d{${scale}}[eE][+-]?\\d+$`).test(value);
}

function canonicalSfValue(value, sigFigs) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  if (numeric === 0) {
    return "0";
  }

  return Number(numeric).toPrecision(sigFigs).replace(/e\+?/i, "e");
}

function validateDatetimeValue(value, unit) {
  if (value === "") {
    return true;
  }

  if (unit === "hh:mm") {
    return /^\d{2}:\d{2}$/.test(value);
  }

  if (unit === "hh:mm:ss") {
    return /^\d{2}:\d{2}:\d{2}$/.test(value);
  }

  const pattern = unit
    .split("")
    .map((char) => {
      if ("ymdhs".includes(char)) {
        return "\\d";
      }
      if (char === "+") {
        return "[+-]";
      }
      return escapeRegexLiteral(char);
    })
    .join("");

  if (!(new RegExp(`^${pattern}$`).test(value))) {
    return false;
  }

  const candidate = value.includes("Z") ? value.split("Z")[0] : value;
  return !Number.isNaN(Date.parse(candidate));
}

function validateElapsedTimeValue(value, unit) {
  if (value === "") {
    return true;
  }

  if (unit === "hh:mm") {
    return /^\d+\d:\d{2}$/.test(value);
  }

  if (unit === "hh:mm:ss" || unit === "") {
    return /^\d+\d:\d{2}:\d{2}$/.test(value);
  }

  if (unit === "mm:ss") {
    return /^\d{2}:\d{2}$/.test(value);
  }

  return /^\d+\d:\d{2}:\d{2}$/.test(value);
}

function validateAgs4DataType(dataType, value, unit) {
  if (!dataType || value === "") {
    return { valid: true };
  }

  if (/^\d+DP$/.test(dataType)) {
    const scale = Number(dataType.slice(0, -2));
    return { valid: validateDpValue(value, scale) };
  }

  if (/^\d+SCI$/.test(dataType)) {
    const scale = Number(dataType.slice(0, -3));
    return { valid: validateScientificValue(value, scale) };
  }

  if (/^\d+SF$/.test(dataType)) {
    const sigFigs = Number(dataType.slice(0, -2));
    const expected = canonicalSfValue(value, sigFigs);
    if (expected === null || Number(value) === 0) {
      return { valid: Number.isFinite(Number(value)) };
    }

    return { valid: value.toLowerCase() === expected.toLowerCase(), expected };
  }

  if (dataType === "DT") {
    return { valid: validateDatetimeValue(value, unit || "") };
  }

  if (dataType === "T") {
    return { valid: validateElapsedTimeValue(value, unit || "") };
  }

  if (dataType === "U") {
    return { valid: Number.isFinite(Number(value)) };
  }

  if (dataType === "YN") {
    return { valid: /^(Y|N|y|n)$/.test(value) };
  }

  if (dataType === "DMS") {
    return { valid: /^-?\d+:\d{2}:\d{2}\.?\d*$/.test(value) };
  }

  return { valid: true };
}

function lintAgs4(document, diagnostics, references) {
  const tablesByGroup = new Map(document.blocks.map((block) => [block.groupCode, decorateAgs4Block(block)]));
  const mergedRefs = buildMergedAgs4References(references, tablesByGroup);
  const rule9Hits = [];

  for (const table of tablesByGroup.values()) {
    lintAgs4Block(table, tablesByGroup, mergedRefs, diagnostics, rule9Hits);
  }

  lintAgs4GlobalRules(tablesByGroup, mergedRefs, diagnostics, rule9Hits);
}

function lintAgs4Block(table, tablesByGroup, mergedRefs, diagnostics, rule9Hits) {
  if (table.groupLine.tokens.length !== 2) {
    diagnostics.push(createAgs4Diagnostic("4", "ags4.group.shape", "error", "AGS4 GROUP rows must contain exactly two fields.", table.groupLine.lineNumber, 1, table.groupLine.raw.length + 1));
  }

  if (!/^[A-Z]{4}$/.test(table.groupCode)) {
    diagnostics.push(createAgs4Diagnostic("19", "ags4.group.pattern", "error", "GROUP name should consist of four uppercase letters.", table.groupLine.lineNumber, 1, table.groupLine.raw.length + 1));
  }

  if (!mergedRefs.groups.has(table.groupCode)) {
    rule9Hits.push({ group: table.groupCode });
    diagnostics.push(createAgs4Diagnostic("9", "ags4.group.unknown", "warning", `Unknown AGS4 group "${table.groupCode}".`, table.groupLine.lineNumber, 1, table.groupLine.raw.length + 1));
  }

  if (!table.headingRow) {
    diagnostics.push(createAgs4Diagnostic("4", "ags4.heading.missing", "error", "AGS4 groups must contain a HEADING row.", table.groupLine.lineNumber, 1, table.groupLine.raw.length + 1));
    return;
  }

  if (!table.primaryDataRows.length) {
    diagnostics.push(createAgs4Diagnostic("2", "ags4.data.missing", "error", "AGS4 groups must contain at least one DATA row.", table.groupLine.lineNumber, 1, table.groupLine.raw.length + 1));
  }

  lintAgs4RowPlacement(table, diagnostics);
  lintAgs4HeadingRules(table, mergedRefs, diagnostics, rule9Hits);
  lintAgs4TypeAndUnitRows(table, mergedRefs, diagnostics);
  lintAgs4DataTypeRules(table, diagnostics);
  lintAgs4KeyRules(table, mergedRefs, diagnostics);
}

function lintAgs4RowPlacement(table, diagnostics) {
  const descriptorOrder = table.rows.map((row) => row.firstValue);

  if (!table.unitRow) {
    diagnostics.push(createAgs4Diagnostic("2B", "ags4.unit.missing", "error", "UNIT row missing from group.", table.groupLine.lineNumber, 1, table.groupLine.raw.length + 1));
  } else {
    const headingIndex = descriptorOrder.indexOf("HEADING");
    const unitIndex = descriptorOrder.indexOf("UNIT");
    if (headingIndex !== -1 && unitIndex !== headingIndex + 1) {
      diagnostics.push(createAgs4Diagnostic("2B", "ags4.unit.misplaced", "error", "UNIT row is misplaced. It should be immediately below the HEADING row.", table.unitRow.lineNumber, 1, table.unitRow.raw.length + 1));
    }
  }

  if (!table.typeRow) {
    diagnostics.push(createAgs4Diagnostic("2B", "ags4.type.missing-row", "error", "TYPE row missing from group.", table.groupLine.lineNumber, 1, table.groupLine.raw.length + 1));
  } else {
    const unitIndex = descriptorOrder.indexOf("UNIT");
    const typeIndex = descriptorOrder.indexOf("TYPE");
    if (unitIndex !== -1 && typeIndex !== unitIndex + 1) {
      diagnostics.push(createAgs4Diagnostic("2B", "ags4.type.misplaced", "error", "TYPE row is misplaced. It should be immediately below the UNIT row.", table.typeRow.lineNumber, 1, table.typeRow.raw.length + 1));
    }
  }

  if (table.headingRows.length > 1) {
    for (const extraRow of table.headingRows.slice(1)) {
      diagnostics.push(createAgs4Diagnostic("2B", "ags4.heading.duplicate-row", "error", "Additional HEADING row found in group.", extraRow.lineNumber, 1, extraRow.raw.length + 1));
    }
  }

  if (table.unitRows.length > 1) {
    for (const extraRow of table.unitRows.slice(1)) {
      diagnostics.push(createAgs4Diagnostic("2B", "ags4.unit.duplicate-row", "error", "Additional UNIT row found in group.", extraRow.lineNumber, 1, extraRow.raw.length + 1));
    }
  }

  if (table.typeRows.length > 1) {
    for (const extraRow of table.typeRows.slice(1)) {
      diagnostics.push(createAgs4Diagnostic("2B", "ags4.type.duplicate-row", "error", "Additional TYPE row found in group.", extraRow.lineNumber, 1, extraRow.raw.length + 1));
    }
  }
}

function lenInvalidAgs4Heading(heading) {
  return /[^A-Z0-9_]/.test(heading) || heading.length > 9;
}

function lintAgs4HeadingRules(table, mergedRefs, diagnostics, rule9Hits) {
  const headingRef = mergedRefs.headingsByGroup.get(table.groupCode) || new Map();
  const headingSet = new Set();
  const seenHeadings = new Set();
  const headings = table.headings;

  for (const [index, heading] of headings.entries()) {
    const headingToken = table.headingRow.tokens[index + 1];
    if (seenHeadings.has(heading)) {
      diagnostics.push(createAgs4Diagnostic("7", "ags4.heading.duplicate", "error", `HEADING row contains duplicate heading "${heading}".`, table.headingRow.lineNumber, headingToken.start, headingToken.end + 1));
    }
    seenHeadings.add(heading);
    headingSet.add(heading);

    if (lenInvalidAgs4Heading(heading)) {
      diagnostics.push(createAgs4Diagnostic("19A", "ags4.heading.pattern", "error", `Heading ${heading} should consist of only uppercase letters, numbers, and an underscore character and be no more than 9 characters long.`, table.headingRow.lineNumber, headingToken.start, headingToken.end + 1));
    }

    const ref = headingRef.get(heading);
    if (!ref) {
      rule9Hits.push({ group: table.groupCode, heading });
      diagnostics.push(createAgs4Diagnostic("9", "ags4.heading.unknown", "warning", `Heading "${heading}" is not defined for AGS4 group "${table.groupCode}".`, table.headingRow.lineNumber, headingToken.start, headingToken.end + 1));
    }
  }

  const missingKeyFields = [];
  for (const ref of headingRef.values()) {
    if (ref.status && ref.status.toUpperCase().includes("REQUIRED") && !headingSet.has(ref.code)) {
      diagnostics.push(createAgs4Diagnostic("10B", "ags4.required.missing-heading", "error", `Required AGS4 heading "${ref.code}" is missing from group "${table.groupCode}" (DICT_STAT="${ref.status}").`, table.headingRow.lineNumber, 1, table.headingRow.raw.length + 1));
    }
    if (ref.status && ref.status.toUpperCase().includes("KEY") && !headingSet.has(ref.code)) {
      missingKeyFields.push(ref.code);
    }
  }

  for (const keyField of missingKeyFields) {
    diagnostics.push(createAgs4Diagnostic("10A", "ags4.key.missing-heading", "error", `Key field ${keyField} not found.`, table.headingRow.lineNumber, 1, table.headingRow.raw.length + 1));
  }

  const unknownHeadings = headings.filter((heading) => !headingRef.has(heading));
  if (!unknownHeadings.length) {
    const expectedOrder = Array.from(headingRef.keys()).filter((heading) => headingSet.has(heading));
    for (let index = 0; index < headings.length; index += 1) {
      if (headings[index] !== expectedOrder[index]) {
        diagnostics.push(createAgs4Diagnostic("7", "ags4.heading.order", "error", `Headings not in AGS4 dictionary order starting from "${headings[index]}".`, table.headingRow.lineNumber, 1, table.headingRow.raw.length + 1));
        break;
      }
    }
  }

  lintAgs4HeadingPrefixRules(table, mergedRefs, diagnostics);
}

function lintAgs4HeadingPrefixRules(table, mergedRefs, diagnostics) {
  const groupHeadingRefs = mergedRefs.headingsByGroup.get(table.groupCode) || new Map();
  const allHeadings = new Set(Array.from(mergedRefs.headingsByGroup.values()).flatMap((headings) => Array.from(headings.keys())));

  for (const [index, heading] of table.headings.entries()) {
    const token = table.headingRow.tokens[index + 1];
    const parts = heading.split("_");

    if (parts.length < 2 || parts[0].length !== 4 || parts[1].length > 4) {
      diagnostics.push(createAgs4Diagnostic("19B", "ags4.heading.shape", "error", `Heading ${heading} should consist of a 4 character group name and a field name of up to 4 characters.`, table.headingRow.lineNumber, token.start, token.end + 1));
      continue;
    }

    const refGroupName = parts[0];
    if (refGroupName === table.groupCode || refGroupName === "SPEC" || refGroupName === "TEST") {
      continue;
    }

    const refHeadings = mergedRefs.headingsByGroup.get(refGroupName);
    if (!refHeadings) {
      diagnostics.push(createAgs4Diagnostic("19B", "ags4.heading.foreign-group-missing", "error", `Group ${refGroupName} referred to in ${heading} could not be found in either the standard dictionary or the DICT group.`, table.headingRow.lineNumber, token.start, token.end + 1));
      continue;
    }

    if (!refHeadings.has(heading) && groupHeadingRefs.has(heading)) {
      diagnostics.push(createAgs4Diagnostic("19B", "ags4.heading.foreign-definition", "error", `Definition for ${heading} not found under group ${refGroupName}. Either rename heading or add definition under correct group.`, table.headingRow.lineNumber, token.start, token.end + 1));
      continue;
    }

    if (refGroupName !== table.groupCode && !allHeadings.has(heading)) {
      diagnostics.push(createAgs4Diagnostic("19B", "ags4.heading.foreign-prefix", "error", `${heading} does not start with the name of this group, nor is it defined in another group.`, table.headingRow.lineNumber, token.start, token.end + 1));
    }
  }
}

function lintAgs4TypeAndUnitRows(table, mergedRefs, diagnostics) {
  const expectedColumnCount = table.headingRow.tokens.length;
  const headingRef = mergedRefs.headingsByGroup.get(table.groupCode) || new Map();

  if (table.unitRow && table.unitRow.tokens.length !== expectedColumnCount) {
    diagnostics.push(createAgs4Diagnostic("4", "ags4.unit.columns", "error", "AGS4 UNIT rows must match the HEADING row column count.", table.unitRow.lineNumber, 1, table.unitRow.raw.length + 1));
  }

  if (table.typeRow && table.typeRow.tokens.length !== expectedColumnCount) {
    diagnostics.push(createAgs4Diagnostic("4", "ags4.type.columns", "error", "AGS4 TYPE rows must match the HEADING row column count.", table.typeRow.lineNumber, 1, table.typeRow.raw.length + 1));
  }

  for (const dataRow of table.primaryDataRows) {
    if (dataRow.tokens.length !== expectedColumnCount) {
      diagnostics.push(createAgs4Diagnostic("4", "ags4.data.columns", "error", "AGS4 DATA rows must match the HEADING row column count.", dataRow.lineNumber, 1, dataRow.raw.length + 1));
    }
  }

  if (!table.typeRow) {
    return;
  }

  for (const [index, heading] of table.headings.entries()) {
    const ref = headingRef.get(heading);
    if (!ref) {
      continue;
    }

    const actualType = table.typeRow.tokens[index + 1] ? table.typeRow.tokens[index + 1].value : "";
    if (ref.dataType && actualType !== ref.dataType) {
      const token = table.typeRow.tokens[index + 1];
      diagnostics.push(createAgs4Diagnostic("8", "ags4.type.reference-mismatch", "error", `TYPE "${actualType}" does not match AGS4 reference type "${ref.dataType}" for "${heading}".`, table.typeRow.lineNumber, token ? token.start : 1, token ? token.end + 1 : 2));
    }

    if (table.unitRow) {
      const actualUnit = table.unitRow.tokens[index + 1] ? table.unitRow.tokens[index + 1].value : "";
      if (actualUnit !== ref.unit) {
        const token = table.unitRow.tokens[index + 1];
        diagnostics.push(createAgs4Diagnostic("8", "ags4.unit.reference-mismatch", "warning", `UNIT "${actualUnit}" does not match AGS4 reference unit "${ref.unit}" for "${heading}".`, table.unitRow.lineNumber, token ? token.start : 1, token ? token.end + 1 : 2));
      }
    }
  }
}

function lintAgs4DataTypeRules(table, diagnostics) {
  if (!table.typeRow) {
    return;
  }

  const units = table.unitRow
    ? table.unitRow.tokens.slice(1).map((token) => token.value)
    : table.headings.map(() => "");
  const types = table.typeRow.tokens.slice(1).map((token) => token.value);

  for (const [index, dataType] of types.entries()) {
    const heading = table.headings[index];
    const unit = units[index] || "";

    if (dataType === "ID" && heading.startsWith(table.groupCode)) {
      const seen = new Map();
      for (const row of table.primaryDataRows) {
        const value = row.tokens[index + 1] ? row.tokens[index + 1].value : "";
        if (!value) {
          continue;
        }
        if (seen.has(value)) {
          const token = row.tokens[index + 1];
          diagnostics.push(createAgs4Diagnostic("8", "ags4.type.id-duplicate", "error", `Value ${value} in ${heading} is not unique.`, row.lineNumber, token.start, token.end + 1));
        } else {
          seen.set(value, row.lineNumber);
        }
      }
      continue;
    }

    for (const row of table.primaryDataRows) {
      const valueToken = row.tokens[index + 1];
      const value = valueToken ? valueToken.value : "";
      const validation = validateAgs4DataType(dataType, value, unit);
      if (validation.valid) {
        continue;
      }

      const expectedSuffix = validation.expected ? ` (Expected: ${validation.expected})` : "";
      diagnostics.push(createAgs4Diagnostic("8", "ags4.type.value-invalid", "error", `Value ${value} in ${heading} not of data type ${dataType}.${expectedSuffix}`, row.lineNumber, valueToken ? valueToken.start : 1, valueToken ? valueToken.end + 1 : 2));
    }
  }
}

function lintAgs4KeyRules(table, mergedRefs, diagnostics) {
  const headingRef = mergedRefs.headingsByGroup.get(table.groupCode) || new Map();
  const keyFields = Array.from(headingRef.values())
    .filter((ref) => ref.status && ref.status.toUpperCase().includes("KEY"))
    .map((ref) => ref.code);

  if (!keyFields.length || !keyFields.every((field) => table.headingIndex.has(field))) {
    return;
  }

  const seen = new Map();
  for (const row of table.primaryDataRows) {
    const signature = keyFields.map((field) => getAgs4RowValue(table, row, field)).join("\u0001");
    if (seen.has(signature)) {
      diagnostics.push(createAgs4Diagnostic("10A", "ags4.key.duplicate", "error", `Duplicate key field combination: ${signature.replace(/\u0001/g, "|")}`, row.lineNumber, 1, row.raw.length + 1));
    } else {
      seen.set(signature, row.lineNumber);
    }

    for (const field of table.headings) {
      const ref = headingRef.get(field);
      if (!ref || !ref.status || !ref.status.toUpperCase().includes("REQUIRED")) {
        continue;
      }

      const tokenIndex = table.headingIndex.get(field) + 1;
      const token = row.tokens[tokenIndex];
      const value = token ? token.value : "";
      if (value.trim() === "") {
        diagnostics.push(createAgs4Diagnostic("10B", "ags4.required.empty-value", "error", `Empty REQUIRED field "${field}" in group "${table.groupCode}".`, row.lineNumber, token ? token.start : 1, token ? token.end + 1 : 2));
      }
    }
  }
}

function lintAgs4GlobalRules(tablesByGroup, mergedRefs, diagnostics, rule9Hits) {
  lintAgs4ParentRules(tablesByGroup, mergedRefs, diagnostics);
  lintAgs4TranRules(tablesByGroup, diagnostics);
  lintAgs4ProjRules(tablesByGroup, diagnostics);
  lintAgs4UnitGroupRules(tablesByGroup, diagnostics);
  lintAgs4AbbrRules(tablesByGroup, diagnostics);
  lintAgs4TypeGroupRules(tablesByGroup, diagnostics);
  lintAgs4DictRules(tablesByGroup, diagnostics, rule9Hits);
  lintAgs4RecordLinkRules(tablesByGroup, diagnostics);
  lintAgs4FileRules(tablesByGroup, diagnostics);
}

function lintAgs4ParentRules(tablesByGroup, mergedRefs, diagnostics) {
  const exemptGroups = new Set(["PROJ", "TRAN", "ABBR", "DICT", "UNIT", "TYPE", "LOCA", "FILE", "LBSG", "PREM", "STND"]);

  for (const table of tablesByGroup.values()) {
    if (exemptGroups.has(table.groupCode)) {
      continue;
    }

    const groupRef = mergedRefs.groups.get(table.groupCode);
    if (!groupRef || !groupRef.parentGroup) {
      diagnostics.push(createAgs4Diagnostic("10C", "ags4.parent.definition-missing", "warning", "Could not check parent entries since group definitions not found in standard dictionary or DICT group.", table.groupLine.lineNumber, 1, table.groupLine.raw.length + 1));
      continue;
    }

    const parentTable = tablesByGroup.get(groupRef.parentGroup);
    if (!parentTable) {
      diagnostics.push(createAgs4Diagnostic("10C", "ags4.parent.group-missing", "warning", `Could not find parent group ${groupRef.parentGroup}.`, table.groupLine.lineNumber, 1, table.groupLine.raw.length + 1));
      continue;
    }

    const parentHeadingRef = mergedRefs.headingsByGroup.get(groupRef.parentGroup) || new Map();
    const childHeadingRef = mergedRefs.headingsByGroup.get(table.groupCode) || new Map();
    const parentKeyFields = Array.from(parentHeadingRef.values())
      .filter((ref) => ref.status && ref.status.toUpperCase().includes("KEY"))
      .map((ref) => ref.code);
    const childKeyFields = Array.from(childHeadingRef.values())
      .filter((ref) => ref.status && ref.status.toUpperCase().includes("KEY"))
      .map((ref) => ref.code);

    if (!parentKeyFields.length) {
      diagnostics.push(createAgs4Diagnostic("10C", "ags4.parent.key-definition-missing", "warning", `No key fields have been defined in parent group (${groupRef.parentGroup}). Please check DICT group.`, table.groupLine.lineNumber, 1, table.groupLine.raw.length + 1));
      continue;
    }

    const missingChildKeyFields = parentKeyFields.filter((field) => !childKeyFields.includes(field));
    if (missingChildKeyFields.length) {
      diagnostics.push(createAgs4Diagnostic("10C", "ags4.parent.child-key-missing", "warning", `${missingChildKeyFields.join(", ")} defined as key field(s) in the parent group (${groupRef.parentGroup}) but not in the child group. Please check DICT group.`, table.groupLine.lineNumber, 1, table.groupLine.raw.length + 1));
      continue;
    }

    if (!parentKeyFields.every((field) => table.headingIndex.has(field) && parentTable.headingIndex.has(field))) {
      diagnostics.push(createAgs4Diagnostic("10C", "ags4.parent.key-column-missing", "warning", `Could not check parent entries due to missing key fields in ${table.groupCode} or ${groupRef.parentGroup}.`, table.headingRow.lineNumber, 1, table.headingRow.raw.length + 1));
      continue;
    }

    const parentSignatures = new Set(parentTable.primaryDataRows.map((row) => parentKeyFields.map((field) => getAgs4RowValue(parentTable, row, field)).join("\u0001")));
    for (const row of table.primaryDataRows) {
      const signature = parentKeyFields.map((field) => getAgs4RowValue(table, row, field)).join("\u0001");
      if (!parentSignatures.has(signature)) {
        diagnostics.push(createAgs4Diagnostic("10C", "ags4.parent.row-missing", "warning", `Parent entry for line not found in ${groupRef.parentGroup}: ${signature.replace(/\u0001/g, "|")}`, row.lineNumber, 1, row.raw.length + 1));
      }
    }
  }
}

function lintAgs4ProjRules(tablesByGroup, diagnostics) {
  const projTable = tablesByGroup.get("PROJ");
  if (!projTable) {
    diagnostics.push(createAgs4Diagnostic("13", "ags4.proj.missing", "error", "PROJ group not found.", 1, 1, 2));
    return;
  }

  if (!projTable.primaryDataRows.length) {
    diagnostics.push(createAgs4Diagnostic("13", "ags4.proj.data-missing", "error", "There should be at least one DATA row in the PROJ group.", projTable.groupLine.lineNumber, 1, projTable.groupLine.raw.length + 1));
  }

  for (const row of projTable.primaryDataRows.slice(1)) {
    diagnostics.push(createAgs4Diagnostic("13", "ags4.proj.data-duplicate", "error", "There should not be more than one DATA row in the PROJ group.", row.lineNumber, 1, row.raw.length + 1));
  }
}

function lintAgs4TranRules(tablesByGroup, diagnostics) {
  const tranTable = tablesByGroup.get("TRAN");
  if (!tranTable) {
    diagnostics.push(createAgs4Diagnostic("14", "ags4.tran.missing", "error", "TRAN group not found.", 1, 1, 2));
    return;
  }

  if (!tranTable.primaryDataRows.length) {
    diagnostics.push(createAgs4Diagnostic("14", "ags4.tran.data-missing", "error", "There should be at least one DATA row in the TRAN group.", tranTable.groupLine.lineNumber, 1, tranTable.groupLine.raw.length + 1));
    return;
  }

  for (const row of tranTable.primaryDataRows.slice(1)) {
    diagnostics.push(createAgs4Diagnostic("14", "ags4.tran.data-duplicate", "error", "There should not be more than one DATA row in the TRAN group.", row.lineNumber, 1, row.raw.length + 1));
  }

  const tranRow = tranTable.primaryDataRows[0];
  if (tranTable.headingIndex.has("TRAN_DLIM") && getAgs4RowValue(tranTable, tranRow, "TRAN_DLIM") === "") {
    diagnostics.push(createAgs4Diagnostic("11A", "ags4.tran.delimiter-missing", "error", "TRAN_DLIM missing.", tranRow.lineNumber, 1, tranRow.raw.length + 1));
  }

  if (tranTable.headingIndex.has("TRAN_RCON") && getAgs4RowValue(tranTable, tranRow, "TRAN_RCON") === "") {
    diagnostics.push(createAgs4Diagnostic("11B", "ags4.tran.concatenator-missing", "error", "TRAN_RCON missing.", tranRow.lineNumber, 1, tranRow.raw.length + 1));
  }
}

function lintAgs4UnitGroupRules(tablesByGroup, diagnostics) {
  const unitTable = tablesByGroup.get("UNIT");
  if (!unitTable) {
    diagnostics.push(createAgs4Diagnostic("15", "ags4.unit-group.missing", "error", "UNIT group not found.", 1, 1, 2));
    return;
  }

  const allowedUnits = new Set(unitTable.primaryDataRows.map((row) => getAgs4RowValue(unitTable, row, "UNIT_UNIT")));
  const unitLocations = new Map();

  for (const table of tablesByGroup.values()) {
    if (table.unitRow) {
      for (const [index, heading] of table.headings.entries()) {
        const unit = table.unitRow.tokens[index + 1] ? table.unitRow.tokens[index + 1].value : "";
        if (unit && unit !== "UNIT" && !unitLocations.has(unit)) {
          unitLocations.set(unit, `${heading} in UNIT row of ${table.groupCode}`);
        }
      }
    }

    if (!table.typeRow) {
      continue;
    }

    for (const [index, typeToken] of table.typeRow.tokens.slice(1).entries()) {
      if (typeToken.value !== "PU") {
        continue;
      }

      for (const row of table.primaryDataRows) {
        const value = row.tokens[index + 1] ? row.tokens[index + 1].value : "";
        if (value && !unitLocations.has(value)) {
          unitLocations.set(value, `${table.headings[index]} column in ${table.groupCode}`);
        }
      }
    }
  }

  for (const [unit, location] of unitLocations.entries()) {
    if (!allowedUnits.has(unit)) {
      diagnostics.push(createAgs4Diagnostic("15", "ags4.unit-group.undefined-unit", "error", `Unit "${unit}" not found in UNIT group. (This unit first appears in ${location})`, unitTable.groupLine.lineNumber, 1, unitTable.groupLine.raw.length + 1));
    }
  }
}

function lintAgs4AbbrRules(tablesByGroup, diagnostics) {
  const abbrTable = tablesByGroup.get("ABBR");
  const tranTable = tablesByGroup.get("TRAN");
  const concatenator = tranTable && tranTable.primaryDataRows.length ? getAgs4RowValue(tranTable, tranTable.primaryDataRows[0], "TRAN_RCON") : "";

  for (const table of tablesByGroup.values()) {
    if (!table.typeRow) {
      continue;
    }

    for (const [index, typeToken] of table.typeRow.tokens.slice(1).entries()) {
      if (typeToken.value !== "PA") {
        continue;
      }

      if (!abbrTable) {
        diagnostics.push(createAgs4Diagnostic("16", "ags4.abbr-group.missing", "error", "ABBR group not found.", table.groupLine.lineNumber, 1, table.groupLine.raw.length + 1));
        return;
      }

      const heading = table.headings[index];
      const allowedCodes = new Set(
        abbrTable.primaryDataRows
          .filter((row) => getAgs4RowValue(abbrTable, row, "ABBR_HDNG") === heading)
          .map((row) => getAgs4RowValue(abbrTable, row, "ABBR_CODE"))
      );

      for (const row of table.primaryDataRows) {
        const value = row.tokens[index + 1] ? row.tokens[index + 1].value : "";
        const parts = concatenator ? value.split(concatenator) : [value];
        for (const part of parts.filter(Boolean)) {
          if (!allowedCodes.has(part)) {
            diagnostics.push(createAgs4Diagnostic("16", "ags4.abbr.undefined-code", "error", `"${part}" under ${heading} in ${table.groupCode} not found in ABBR group.`, row.lineNumber, 1, row.raw.length + 1));
          }
        }
      }
    }
  }
}

function lintAgs4TypeGroupRules(tablesByGroup, diagnostics) {
  const typeTable = tablesByGroup.get("TYPE");
  if (!typeTable) {
    diagnostics.push(createAgs4Diagnostic("17", "ags4.type-group.missing", "error", "TYPE group not found.", 1, 1, 2));
    return;
  }

  const allowedTypes = new Set(typeTable.primaryDataRows.map((row) => getAgs4RowValue(typeTable, row, "TYPE_TYPE")));

  for (const table of tablesByGroup.values()) {
    if (!table.typeRow) {
      continue;
    }

    for (const token of table.typeRow.tokens.slice(1)) {
      if (token.value && token.value !== "TYPE" && !allowedTypes.has(token.value)) {
        diagnostics.push(createAgs4Diagnostic("17", "ags4.type-group.undefined-type", "error", `Data type "${token.value}" not found in TYPE group.`, table.typeRow.lineNumber, token.start, token.end + 1));
      }
    }
  }
}

function lintAgs4DictRules(tablesByGroup, diagnostics, rule9Hits) {
  if (!rule9Hits.length || tablesByGroup.has("DICT")) {
    return;
  }

  diagnostics.push(createAgs4Diagnostic("18", "ags4.dict-group.missing", "error", "DICT group not found. See Rule 9 diagnostics for non-standard groups/headings that need definitions.", 1, 1, 2));
}

function fetchRecord(recordParts, tablesByGroup) {
  const groupCode = recordParts[0];
  const table = tablesByGroup.get(groupCode);
  if (!table || !table.headingRow) {
    return [];
  }

  const values = recordParts.slice(1);
  if (values.length > table.headings.length) {
    return [];
  }

  return table.primaryDataRows.filter((row) =>
    values.every((value, index) => {
      const token = row.tokens[index + 1];
      return (token ? token.value : "") === value;
    })
  );
}

function lintAgs4RecordLinkRules(tablesByGroup, diagnostics) {
  const tranTable = tablesByGroup.get("TRAN");
  if (!tranTable || !tranTable.primaryDataRows.length) {
    return;
  }

  const tranRow = tranTable.primaryDataRows[0];
  const delimiter = getAgs4RowValue(tranTable, tranRow, "TRAN_DLIM");
  const concatenator = getAgs4RowValue(tranTable, tranRow, "TRAN_RCON");

  if (!delimiter || !concatenator) {
    return;
  }

  for (const table of tablesByGroup.values()) {
    if (!table.typeRow) {
      continue;
    }

    for (const [index, typeToken] of table.typeRow.tokens.slice(1).entries()) {
      if (!typeToken.value.includes("RL")) {
        continue;
      }

      for (const row of table.primaryDataRows) {
        const token = row.tokens[index + 1];
        const value = token ? token.value : "";
        if (!value) {
          continue;
        }

        if (!value.includes(delimiter)) {
          diagnostics.push(createAgs4Diagnostic("11C", "ags4.record-link.delimiter", "error", `Invalid record link: "${value}". "${delimiter}" should be used as delimiter.`, row.lineNumber, token.start, token.end + 1));
          continue;
        }

        for (const item of value.split(concatenator)) {
          const matches = fetchRecord(item.split(delimiter), tablesByGroup);
          if (!matches.length) {
            diagnostics.push(createAgs4Diagnostic("11C", "ags4.record-link.missing", "error", `Invalid record link: "${item}". No such record found.`, row.lineNumber, token.start, token.end + 1));
          } else if (matches.length > 1) {
            diagnostics.push(createAgs4Diagnostic("11C", "ags4.record-link.duplicate-target", "error", `Invalid record link: "${item}". Link refers to more than one record.`, row.lineNumber, token.start, token.end + 1));
          }
        }
      }
    }
  }
}

function lintAgs4FileRules(tablesByGroup, diagnostics) {
  const fileTable = tablesByGroup.get("FILE");
  const definedFileSets = new Set(fileTable ? fileTable.primaryDataRows.map((row) => getAgs4RowValue(fileTable, row, "FILE_FSET")) : []);
  let foundUsageWithoutFileGroup = false;

  for (const table of tablesByGroup.values()) {
    if (!table.headingIndex.has("FILE_FSET")) {
      continue;
    }

    const tokenIndex = table.headingIndex.get("FILE_FSET") + 1;
    for (const row of table.primaryDataRows) {
      const token = row.tokens[tokenIndex];
      const value = token ? token.value : "";
      if (!value) {
        continue;
      }

      if (!fileTable) {
        foundUsageWithoutFileGroup = true;
        continue;
      }

      if (!definedFileSets.has(value)) {
        diagnostics.push(createAgs4Diagnostic("20", "ags4.file.undefined-fileset", "error", `FILE_FSET entry "${value}" not found in FILE group.`, row.lineNumber, token.start, token.end + 1));
      }
    }
  }

  if (foundUsageWithoutFileGroup) {
    diagnostics.push(createAgs4Diagnostic("20", "ags4.file.group-missing", "error", "FILE table not found even though there are FILE_FSET entries in other groups.", 1, 1, 2));
  }
}

function lintFile(filePath, options = {}) {
  const text = fs.readFileSync(filePath, "utf8");
  return lintText(text, {
    ...options,
    baseDir: options.baseDir || path.resolve(__dirname, "../..")
  });
}

module.exports = {
  lintFile,
  lintText
};
