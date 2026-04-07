"use strict";

const fs = require("fs");
const path = require("path");
const { parseCsvLine, splitLines } = require("../utils/lineParser");

const REFERENCE_FILE_NAMES = {
  ags3Schema: "ags3.1_standard_heading.csv",
  ags3Keys: "ags3.1_keys.csv",
  ags4Dictionary: "ags4.2_Standard_dictionary.ags"
};

function normalizeAgs3GroupToken(value) {
  return value.startsWith("**") ? value.slice(2) : value;
}

function normalizeAgs3HeadingToken(value) {
  return value.startsWith("*") ? value.slice(1) : value;
}

function extractAgs3Schema(text) {
  const groups = new Map();
  const headingsByGroup = new Map();
  let currentGroupCode = null;
  let optionalGroups = 0;
  let optionalHeadings = 0;
  let headingCount = 0;

  for (const [index, rawLine] of splitLines(text).entries()) {
    if (!rawLine.trim()) {
      continue;
    }

    const parsed = parseCsvLine(rawLine.trim(), index + 1);
    const values = parsed.tokens.map((token) => token.value);

    if (values.length === 1 && values[0].startsWith("Group Name: ")) {
      const match = values[0].match(/^Group Name: (\??[A-Z0-9]+)\s*-\s*(.+)$/);
      if (!match) {
        currentGroupCode = null;
        continue;
      }

      currentGroupCode = match[1];
      groups.set(currentGroupCode, {
        code: currentGroupCode,
        description: match[2],
        optional: currentGroupCode.startsWith("?")
      });
      headingsByGroup.set(currentGroupCode, new Map());
      if (currentGroupCode.startsWith("?")) {
        optionalGroups += 1;
      }
      continue;
    }

    if (values[0] === "Heading" && values[1] === "Description" && values[2] === "Type" && values[3] === "Unit") {
      continue;
    }

    if (!currentGroupCode) {
      continue;
    }

    const [code, description = "", type = "", unit = ""] = values;
    headingsByGroup.get(currentGroupCode).set(code, {
      code,
      description,
      type,
      unit,
      optional: code.startsWith("?")
    });
    headingCount += 1;
    if (code.startsWith("?")) {
      optionalHeadings += 1;
    }
  }

  return {
    groups,
    headingsByGroup,
    stats: {
      groups: groups.size,
      headings: headingCount,
      optionalGroups,
      optionalHeadings
    }
  };
}

function extractAgs3Keys(text) {
  const keysByGroup = new Map();

  for (const [index, rawLine] of splitLines(text).entries()) {
    if (index === 0 || !rawLine.trim()) {
      continue;
    }

    const parsed = parseCsvLine(rawLine.trim(), index + 1);
    const [group, field, keyType] = parsed.tokens.map((token) => token.value);
    if (!group || !field || !keyType) {
      continue;
    }

    if (!keysByGroup.has(group)) {
      keysByGroup.set(group, []);
    }

    keysByGroup.get(group).push({ field, keyType });
  }

  const pkSignatureToGroups = new Map();

  for (const [group, entries] of keysByGroup.entries()) {
    const signature = entries
      .filter((entry) => entry.keyType === "PK")
      .map((entry) => entry.field)
      .join("|");

    if (!signature) {
      continue;
    }

    if (!pkSignatureToGroups.has(signature)) {
      pkSignatureToGroups.set(signature, []);
    }

    pkSignatureToGroups.get(signature).push(group);
  }

  return {
    keysByGroup,
    pkSignatureToGroups
  };
}

function extractAgs4Dictionary(text) {
  const groups = new Map();
  const headingsByGroup = new Map();
  let headingCount = 0;

  for (const [index, rawLine] of splitLines(text).entries()) {
    if (!rawLine.trim()) {
      continue;
    }

    const parsed = parseCsvLine(rawLine.trim(), index + 1);
    const values = parsed.tokens.map((token) => token.value);

    if (values[0] !== "DATA") {
      continue;
    }

    if (values[1] === "GROUP") {
      const code = values[2];
      groups.set(code, {
        code,
        description: values[6] || "",
        parentGroup: values[9] && values[9] !== "-" ? values[9] : null
      });
      if (!headingsByGroup.has(code)) {
        headingsByGroup.set(code, new Map());
      }
      continue;
    }

    if (values[1] === "HEADING") {
      const group = values[2];
      const code = values[3];

      if (!headingsByGroup.has(group)) {
        headingsByGroup.set(group, new Map());
      }

      headingsByGroup.get(group).set(code, {
        group,
        code,
        status: values[4] || "",
        dataType: values[5] || "",
        description: values[6] || "",
        unit: values[7] || ""
      });
      headingCount += 1;
    }
  }

  return {
    groups,
    headingsByGroup,
    stats: {
      groups: groups.size,
      headings: headingCount,
      parentedGroups: Array.from(groups.values()).filter((group) => group.parentGroup).length
    }
  };
}

let cache = null;

function resolveReferenceBaseDir(baseDir) {
  const candidates = [
    baseDir,
    path.join(baseDir, "ref")
  ];

  for (const candidate of candidates) {
    const hasAllFiles = Object.values(REFERENCE_FILE_NAMES)
      .every((fileName) => fs.existsSync(path.join(candidate, fileName)));

    if (hasAllFiles) {
      return candidate;
    }
  }

  throw new Error(
    `Could not find AGS reference files under "${baseDir}" or "${path.join(baseDir, "ref")}".`
  );
}

function loadReferences(baseDir) {
  const resolvedBaseDir = resolveReferenceBaseDir(baseDir);

  if (cache && cache.baseDir === resolvedBaseDir) {
    return cache.references;
  }

  const references = {
    ags3: extractAgs3Schema(fs.readFileSync(path.join(resolvedBaseDir, REFERENCE_FILE_NAMES.ags3Schema), "utf8")),
    ags3Keys: extractAgs3Keys(fs.readFileSync(path.join(resolvedBaseDir, REFERENCE_FILE_NAMES.ags3Keys), "utf8")),
    ags4: extractAgs4Dictionary(fs.readFileSync(path.join(resolvedBaseDir, REFERENCE_FILE_NAMES.ags4Dictionary), "utf8"))
  };

  cache = { baseDir: resolvedBaseDir, references };
  return references;
}

module.exports = {
  extractAgs3Keys,
  extractAgs3Schema,
  extractAgs4Dictionary,
  loadReferences,
  normalizeAgs3GroupToken,
  normalizeAgs3HeadingToken
};
