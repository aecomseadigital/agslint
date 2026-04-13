"use strict";

const fs = require("fs");
const path = require("path");
const { parseCsvLine, splitLines } = require("../utils/lineParser");

const AGS3_REFERENCE_FILE_NAMES = {
  ags3Schema: "ags3.1_standard_heading.csv",
  ags3Keys: "ags3.1_keys.csv"
};

const AGS4_REFERENCE_FILE_NAMES = {
  "4.0.3": "ags4.0.3_standard_dictionary.ags",
  "4.0.4": "ags4.0.4_standard_dictionary.ags",
  "4.1": "ags4.1_standard_dictionary.ags",
  "4.1.1": "ags4.1.1_standard_dictionary.ags",
  "4.2": "ags4.2_standard_dictionary.ags"
};

const AGS4_REFERENCE_ALIASES = {
  "4.0": "4.0.3",
  "4.0.0": "4.0.3",
  "4.0.3": "4.0.3",
  "4.0.4": "4.0.4",
  "4.1": "4.1",
  "4.1.0": "4.1",
  "4.1.1": "4.1.1",
  "4.2": "4.2",
  "4.2.0": "4.2"
};

const LATEST_AGS4_REFERENCE_EDITION = "4.2";
const GENERATED_REFERENCE_FILE_NAMES = {
  ags3: path.join("generated", "ags3.references.json"),
  ags4: path.join("generated", "ags4.references.json")
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

function buildAgs3KeyReferences(entriesByGroup) {
  const keysByGroup = new Map(
    Object.entries(entriesByGroup).map(([group, entries]) => [group, entries.map((entry) => ({ ...entry }))])
  );

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

function extractAgs3Keys(text) {
  const entriesByGroup = {};

  for (const [index, rawLine] of splitLines(text).entries()) {
    if (index === 0 || !rawLine.trim()) {
      continue;
    }

    const parsed = parseCsvLine(rawLine.trim(), index + 1);
    const [group, field, keyType] = parsed.tokens.map((token) => token.value);
    if (!group || !field || !keyType) {
      continue;
    }

    if (!entriesByGroup[group]) {
      entriesByGroup[group] = [];
    }

    entriesByGroup[group].push({ field, keyType });
  }

  return buildAgs3KeyReferences(entriesByGroup);
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

const cache = new Map();

function hasRawReferenceFiles(candidate) {
  const requiredFileNames = [
    ...Object.values(AGS3_REFERENCE_FILE_NAMES),
    ...Object.values(AGS4_REFERENCE_FILE_NAMES)
  ];

  return requiredFileNames.every((fileName) => fs.existsSync(path.join(candidate, fileName)));
}

function hasGeneratedReferenceFiles(candidate) {
  return Object.values(GENERATED_REFERENCE_FILE_NAMES)
    .every((fileName) => fs.existsSync(path.join(candidate, fileName)));
}

function hydrateAgs3References(data) {
  return {
    groups: new Map(Object.entries(data.groups || {}).map(([code, group]) => [code, { ...group }])),
    headingsByGroup: new Map(
      Object.entries(data.headingsByGroup || {}).map(([group, headings]) => [
        group,
        new Map(Object.entries(headings).map(([code, heading]) => [code, { ...heading }]))
      ])
    ),
    stats: data.stats
  };
}

function hydrateAgs4References(data) {
  return {
    latestEdition: data.latestEdition || LATEST_AGS4_REFERENCE_EDITION,
    byEdition: Object.fromEntries(
      Object.entries(data.byEdition || {}).map(([edition, reference]) => [
        edition,
        {
          groups: new Map(Object.entries(reference.groups || {}).map(([code, group]) => [code, { ...group }])),
          headingsByGroup: new Map(
            Object.entries(reference.headingsByGroup || {}).map(([group, headings]) => [
              group,
              new Map(Object.entries(headings).map(([code, heading]) => [code, { ...heading }]))
            ])
          ),
          stats: reference.stats
        }
      ])
    )
  };
}

function loadGeneratedReferences(baseDir) {
  if (!hasGeneratedReferenceFiles(baseDir)) {
    return null;
  }

  const ags3Data = JSON.parse(fs.readFileSync(path.join(baseDir, GENERATED_REFERENCE_FILE_NAMES.ags3), "utf8"));
  const ags4Data = JSON.parse(fs.readFileSync(path.join(baseDir, GENERATED_REFERENCE_FILE_NAMES.ags4), "utf8"));

  return {
    ags3: hydrateAgs3References(ags3Data),
    ags3Keys: buildAgs3KeyReferences(ags3Data.keysByGroup || {}),
    ags4: hydrateAgs4References(ags4Data)
  };
}

function normalizeAgs4ReferenceEdition(edition) {
  if (!edition) {
    return null;
  }

  const trimmed = String(edition).trim();
  if (!trimmed) {
    return null;
  }

  if (AGS4_REFERENCE_FILE_NAMES[trimmed]) {
    return trimmed;
  }

  return AGS4_REFERENCE_ALIASES[trimmed] || null;
}

function resolveAgs4ReferenceEdition(edition) {
  return normalizeAgs4ReferenceEdition(edition) || LATEST_AGS4_REFERENCE_EDITION;
}

function getAgs4References(references, edition) {
  const resolvedEdition = resolveAgs4ReferenceEdition(edition);
  return references.ags4.byEdition[resolvedEdition];
}

function resolveReferenceBaseDir(baseDir, options = {}) {
  const { allowGenerated = true, requireRawFiles = false } = options;
  const candidates = [
    baseDir,
    path.join(baseDir, "ref")
  ];

  for (const candidate of candidates) {
    const hasRawFiles = hasRawReferenceFiles(candidate);
    const hasGeneratedFiles = allowGenerated && hasGeneratedReferenceFiles(candidate);

    if (requireRawFiles ? hasRawFiles : (hasRawFiles || hasGeneratedFiles)) {
      return candidate;
    }
  }

  throw new Error(
    `Could not find AGS reference files under "${baseDir}" or "${path.join(baseDir, "ref")}".`
  );
}

function loadRawReferences(baseDir) {
  return {
    ags3: extractAgs3Schema(fs.readFileSync(path.join(baseDir, AGS3_REFERENCE_FILE_NAMES.ags3Schema), "utf8")),
    ags3Keys: extractAgs3Keys(fs.readFileSync(path.join(baseDir, AGS3_REFERENCE_FILE_NAMES.ags3Keys), "utf8")),
    ags4: {
      latestEdition: LATEST_AGS4_REFERENCE_EDITION,
      byEdition: Object.fromEntries(
        Object.entries(AGS4_REFERENCE_FILE_NAMES).map(([edition, fileName]) => [
          edition,
          extractAgs4Dictionary(fs.readFileSync(path.join(baseDir, fileName), "utf8"))
        ])
      )
    }
  };
}

function loadReferences(baseDir, options = {}) {
  const preferGenerated = options.preferGenerated !== false;
  const resolvedBaseDir = resolveReferenceBaseDir(baseDir, {
    allowGenerated: preferGenerated,
    requireRawFiles: !preferGenerated
  });
  const cacheKey = `${resolvedBaseDir}|${preferGenerated ? "generated" : "raw"}`;

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const references = (preferGenerated && loadGeneratedReferences(resolvedBaseDir)) || loadRawReferences(resolvedBaseDir);

  cache.set(cacheKey, references);
  return references;
}

module.exports = {
  extractAgs3Keys,
  extractAgs3Schema,
  extractAgs4Dictionary,
  getAgs4References,
  loadReferences,
  normalizeAgs3GroupToken,
  normalizeAgs3HeadingToken,
  normalizeAgs4ReferenceEdition,
  resolveAgs4ReferenceEdition
};
