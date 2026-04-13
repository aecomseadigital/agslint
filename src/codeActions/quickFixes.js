"use strict";

const { getAgs4References, loadReferences } = require("../references/extractors");

function quoteValue(value) {
  return `"${String(value).replace(/"/g, "\"\"")}"`;
}

function getLineStartOffsets(text) {
  const offsets = [0];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      offsets.push(index + 1);
    }
  }

  return offsets;
}

function offsetAt(lineStarts, lineNumber, column) {
  const lineStart = lineStarts[lineNumber - 1];
  return lineStart + column - 1;
}

function detectEol(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function serializeAgsRow(values) {
  return values.map(quoteValue).join(",");
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

function findLine(lines, lineNumber) {
  return lines.find((line) => line.lineNumber === lineNumber) || null;
}

function findTokenIndexByRange(tokens, diagnostic) {
  const start = diagnostic.column;
  const end = diagnostic.endColumn;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.start < end && (token.end + 1) > start) {
      return index;
    }
  }

  return -1;
}

function createReplaceEdit(text, lineNumber, startColumn, endColumn, newText) {
  const lineStarts = getLineStartOffsets(text);
  return {
    startOffset: offsetAt(lineStarts, lineNumber, startColumn),
    endOffset: offsetAt(lineStarts, lineNumber, endColumn),
    newText
  };
}

function createTokenReplaceEdit(text, lineNumber, token, newText) {
  return createReplaceEdit(text, lineNumber, token.start, token.end + 1, newText);
}

function createInsertAfterLineEdit(text, afterLineNumber, rowText) {
  const lineStarts = getLineStartOffsets(text);
  const eol = detectEol(text);
  const hasTrailingNewline = /\r?\n$/.test(text);

  if (afterLineNumber < lineStarts.length) {
    return {
      startOffset: lineStarts[afterLineNumber],
      endOffset: lineStarts[afterLineNumber],
      newText: `${rowText}${eol}`
    };
  }

  return {
    startOffset: text.length,
    endOffset: text.length,
    newText: `${text.length > 0 && !hasTrailingNewline ? eol : ""}${rowText}`
  };
}

function createQuickFix(title, edits) {
  return {
    title,
    edits
  };
}

function hasCheckId(diagnostic, checkId) {
  return diagnostic && diagnostic.checkId === checkId;
}

function buildAgsQuoteFix(text, lintResult, diagnostic) {
  const line = findLine(lintResult.document.lines, diagnostic.line);
  if (!line) {
    return [];
  }

  const tokenIndex = findTokenIndexByRange(line.tokens, diagnostic);
  if (tokenIndex === -1) {
    return [];
  }

  const token = line.tokens[tokenIndex];
  return [
    createQuickFix(
      "Wrap value in double quotes",
      [createTokenReplaceEdit(text, diagnostic.line, token, quoteValue(token.value))]
    )
  ];
}

function buildAgsEmptyFix(text, lintResult, diagnostic) {
  const line = findLine(lintResult.document.lines, diagnostic.line);
  if (!line) {
    return [];
  }

  const tokenIndex = findTokenIndexByRange(line.tokens, diagnostic);
  if (tokenIndex === -1) {
    return [];
  }

  return [
    createQuickFix(
      "Replace with empty quotes",
      [createTokenReplaceEdit(text, diagnostic.line, line.tokens[tokenIndex], "\"\"")]
    )
  ];
}

function buildAgs3UnitsFirstCellFix(text, lintResult, diagnostic) {
  const line = findLine(lintResult.document.lines, diagnostic.line);
  if (!line) {
    return [];
  }

  const firstToken = line.tokens[0];
  if (firstToken) {
    return [
      createQuickFix(
        "Replace first cell with <UNITS>",
        [createTokenReplaceEdit(text, diagnostic.line, firstToken, quoteValue("<UNITS>"))]
      )
    ];
  }

  return [
    createQuickFix(
      "Insert <UNITS> first cell",
      [createReplaceEdit(text, diagnostic.line, 1, 1, `${quoteValue("<UNITS>")},`)]
    )
  ];
}

function buildAgs3MissingUnitsFix(text, lintResult, diagnostic, references) {
  const block = lintResult.document.blocks.find((entry) => entry.headingRow && entry.headingRow.startLine === diagnostic.line);
  if (!block) {
    return [];
  }

  const headingRefs = references.ags3.headingsByGroup.get(block.groupCode);
  const values = ["<UNITS>"];

  for (let index = 1; index < block.headingCodes.length; index += 1) {
    const ref = getAgs3HeadingReference(headingRefs, block.headingCodes[index]);
    values.push(ref ? ref.unit || "" : "");
  }

  return [
    createQuickFix(
      `Insert <UNITS> row for "${block.groupCode}"`,
      [createInsertAfterLineEdit(text, block.headingRow.endLine, serializeAgsRow(values))]
    )
  ];
}

function buildAgs3ContFix(text, lintResult, diagnostic) {
  const line = findLine(lintResult.document.lines, diagnostic.line);
  if (!line) {
    return [];
  }

  const firstToken = line.tokens[0];
  if (firstToken) {
    return [
      createQuickFix(
        "Replace first cell with <CONT>",
        [createTokenReplaceEdit(text, diagnostic.line, firstToken, quoteValue("<CONT>"))]
      )
    ];
  }

  return [
    createQuickFix(
      "Insert <CONT> first cell",
      [createReplaceEdit(text, diagnostic.line, 1, 1, `${quoteValue("<CONT>")},`)]
    )
  ];
}

function buildAgs3HeadingStandardFix(text, lintResult, diagnostic) {
  const block = lintResult.document.blocks.find((entry) => entry.headingRow && entry.headingRow.startLine === diagnostic.line);
  if (!block) {
    return [];
  }

  const tokenIndex = findTokenIndexByRange(block.headingRow.cells, diagnostic);
  if (tokenIndex === -1) {
    return [];
  }

  const messageMatch = diagnostic.message.match(/"([^"]+)"/);
  if (!messageMatch) {
    return [];
  }

  const canonicalHeading = messageMatch[1];
  return [
    createQuickFix(
      `Replace with standard heading ${canonicalHeading}`,
      [createTokenReplaceEdit(text, diagnostic.line, block.headingRow.cells[tokenIndex], quoteValue(`*${canonicalHeading}`))]
    )
  ];
}

function buildAgs4TypeMismatchFix(text, lintResult, diagnostic, references) {
  const block = lintResult.document.blocks.find((entry) => entry.typeRow && entry.typeRow.lineNumber === diagnostic.line);
  if (!block || !block.headingRow) {
    return [];
  }

  const tokenIndex = findTokenIndexByRange(block.typeRow.tokens, diagnostic);
  if (tokenIndex <= 0) {
    return [];
  }

  const heading = block.headingRow.tokens[tokenIndex] ? block.headingRow.tokens[tokenIndex].value : "";
  const ags4References = getAgs4References(references, lintResult.referenceEdition);
  const ref = (ags4References.headingsByGroup.get(block.groupCode) || new Map()).get(heading);
  if (!ref || !ref.dataType) {
    return [];
  }

  return [
    createQuickFix(
      `Replace TYPE with ${ref.dataType}`,
      [createTokenReplaceEdit(text, diagnostic.line, block.typeRow.tokens[tokenIndex], quoteValue(ref.dataType))]
    )
  ];
}

function buildAgs4MissingTypeRowFix(text, lintResult, diagnostic, references) {
  const block = lintResult.document.blocks.find((entry) => entry.groupLine.lineNumber === diagnostic.line);
  if (!block || !block.headingRow) {
    return [];
  }

  const ags4References = getAgs4References(references, lintResult.referenceEdition);
  const headingRefs = ags4References.headingsByGroup.get(block.groupCode) || new Map();
  const values = ["TYPE"];

  for (const headingToken of block.headingRow.tokens.slice(1)) {
    const ref = headingRefs.get(headingToken.value);
    values.push(ref ? ref.dataType || "" : "");
  }

  const insertAfterLine = block.unitRow ? block.unitRow.lineNumber : block.headingRow.lineNumber;
  return [
    createQuickFix(
      `Insert TYPE row for "${block.groupCode}"`,
      [createInsertAfterLineEdit(text, insertAfterLine, serializeAgsRow(values))]
    )
  ];
}

function buildQuickFixes(text, lintResult, diagnostic, options = {}) {
  const references = loadReferences(options.baseDir || process.cwd());

  if (hasCheckId(diagnostic, "ags3.quote.unquoted") || hasCheckId(diagnostic, "ags4.quote.unquoted")) {
    return buildAgsQuoteFix(text, lintResult, diagnostic);
  }

  if (hasCheckId(diagnostic, "ags3.null.whitespace") || hasCheckId(diagnostic, "ags4.quote.whitespace")) {
    return buildAgsEmptyFix(text, lintResult, diagnostic);
  }

  if (hasCheckId(diagnostic, "ags3.units.first-cell")) {
    return buildAgs3UnitsFirstCellFix(text, lintResult, diagnostic);
  }

  if (hasCheckId(diagnostic, "ags3.units.missing")) {
    return buildAgs3MissingUnitsFix(text, lintResult, diagnostic, references);
  }

  if (hasCheckId(diagnostic, "ags3.cont.first-cell")) {
    return buildAgs3ContFix(text, lintResult, diagnostic);
  }

  if (hasCheckId(diagnostic, "ags3.heading.standard")) {
    return buildAgs3HeadingStandardFix(text, lintResult, diagnostic);
  }

  if (hasCheckId(diagnostic, "ags4.type.reference-mismatch")) {
    return buildAgs4TypeMismatchFix(text, lintResult, diagnostic, references);
  }

  if (hasCheckId(diagnostic, "ags4.type.missing-row")) {
    return buildAgs4MissingTypeRowFix(text, lintResult, diagnostic, references);
  }

  return [];
}

function applyEdits(text, edits) {
  const orderedEdits = [...edits].sort((left, right) => right.startOffset - left.startOffset);
  let output = text;

  for (const edit of orderedEdits) {
    output = `${output.slice(0, edit.startOffset)}${edit.newText}${output.slice(edit.endOffset)}`;
  }

  return output;
}

module.exports = {
  applyEdits,
  buildQuickFixes
};
