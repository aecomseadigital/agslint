"use strict";

function parseCsvLine(rawLine, lineNumber) {
  const tokens = [];
  const errors = [];
  let index = 0;

  while (index < rawLine.length) {
    if (rawLine[index] === ",") {
      tokens.push({
        raw: "",
        value: "",
        quoted: false,
        start: index + 1,
        end: index + 1
      });
      index += 1;
      continue;
    }

    const start = index + 1;

    if (rawLine[index] === "\"") {
      let cursor = index + 1;
      let value = "";
      let closed = false;

      while (cursor < rawLine.length) {
        const char = rawLine[cursor];

        if (char === "\"") {
          if (rawLine[cursor + 1] === "\"") {
            value += "\"";
            cursor += 2;
            continue;
          }

          closed = true;
          cursor += 1;
          break;
        }

        value += char;
        cursor += 1;
      }

      if (!closed) {
        errors.push({
          code: "AGS-CSV",
          message: "Unterminated quoted field.",
          line: lineNumber,
          column: start,
          endColumn: rawLine.length + 1
        });
        cursor = rawLine.length;
      }

      const token = rawLine.slice(index, cursor);
      tokens.push({
        raw: token,
        value,
        quoted: true,
        start,
        end: cursor
      });

      index = cursor;
    } else {
      let cursor = index;
      while (cursor < rawLine.length && rawLine[cursor] !== ",") {
        cursor += 1;
      }

      const token = rawLine.slice(index, cursor);
      tokens.push({
        raw: token,
        value: token.trim(),
        quoted: false,
        start,
        end: cursor
      });

      index = cursor;
    }

    if (rawLine[index] === ",") {
      index += 1;
    } else if (index < rawLine.length) {
      errors.push({
        code: "AGS-CSV",
        message: "Expected a comma between fields.",
        line: lineNumber,
        column: index + 1,
        endColumn: index + 2
      });
      break;
    }
  }

  return {
    lineNumber,
    raw: rawLine,
    tokens,
    errors,
    trailingComma: rawLine.trimEnd().endsWith(","),
    firstValue: tokens[0] ? tokens[0].value : ""
  };
}

function splitLinesDetailed(text) {
  const lines = [];
  const hadBom = text.startsWith("\uFEFF");
  const input = hadBom ? text.slice(1) : text;
  let lineNumber = 1;
  let cursor = 0;
  let start = 0;

  while (cursor < input.length) {
    if (input[cursor] === "\r" && input[cursor + 1] === "\n") {
      lines.push({
        lineNumber,
        raw: input.slice(start, cursor),
        eol: "\r\n",
        hasBom: hadBom && lineNumber === 1
      });
      cursor += 2;
      start = cursor;
      lineNumber += 1;
      continue;
    }

    if (input[cursor] === "\n") {
      lines.push({
        lineNumber,
        raw: input.slice(start, cursor),
        eol: "\n",
        hasBom: hadBom && lineNumber === 1
      });
      cursor += 1;
      start = cursor;
      lineNumber += 1;
      continue;
    }

    cursor += 1;
  }

  lines.push({
    lineNumber,
    raw: input.slice(start),
    eol: "",
    hasBom: hadBom && lineNumber === 1
  });

  return lines;
}

function splitLines(text) {
  return splitLinesDetailed(text).map((line) => line.raw);
}

function countNonAscii(text) {
  const hits = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) > 127) {
      hits.push(index + 1);
    }
  }

  return hits;
}

module.exports = {
  countNonAscii,
  parseCsvLine,
  splitLines,
  splitLinesDetailed
};
