"use strict";

const AGS3_RULES = {
  maxHeadingsPerGroup: 60,
  maxLineLength: 240,
  mandatoryGroups: ["PROJ", "UNIT", "ABBR"],
  unitExemptGroups: new Set(["ABBR", "CODE", "DICT", "UNIT"]),
  holeIdExemptGroups: new Set(["ABBR", "DICT", "UNIT", "FILE"]),
  codeRequiredWhenGroupsPresent: new Set(["CNMT", "?ICCT"]),
  diagnosticRulesByCheckId: {
    "ags3.ascii.non-ascii": "1",
    "ags3.group.unknown": "5",
    "ags3.heading.unknown": "5",
    "ags3.heading.standard": "5",
    "ags3.key.missing": "6",
    "ags3.key.order": "6A",
    "ags3.key.duplicate": "6B",
    "ags3.parent.missing": "6C",
    "ags3.quote.unquoted": "8",
    "ags3.delimiter.tab": "9",
    "ags3.line.length": "12",
    "ags3.heading.continuation.comma": "13",
    "ags3.heading.continuation.quote": "13",
    "ags3.cont.first-cell": "14",
    "ags3.null.whitespace": "15",
    "ags3.heading.count": "17",
    "ags3.units.missing": "18",
    "ags3.units.columns": "18",
    "ags3.units.first-cell": "18",
    "ags3.units.reference": "18",
    "ags3.units.continuation.comma": "18A",
    "ags3.units.continuation.quote": "18A",
    "ags3.group.unit-missing": "18B",
    "ags3.group.proj-missing": "19",
    "ags3.group.abbr-missing": "20",
    "ags3.group.dict-missing": "21",
    "ags3.group.custom-pattern": "22",
    "ags3.heading.custom-pattern": "23",
    "ags3.group.code-missing": "25"
  }
};

module.exports = {
  AGS3_RULES
};
