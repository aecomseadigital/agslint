# AGSLint Diagnostic Reference

This file lists the diagnostics currently implemented in code.

Note:

- `error` and `warning` are explicitly set in the linter.
- Some parser/tokenizer diagnostics currently have no explicit severity and therefore surface as `information` in the VS Code extension.

## Common

### Error

| Code | Meaning |
|---|---|
| `AGS-QUOTE` | A value is not wrapped in double quotes. |
| `AGS-DELIM` | A tab character is used as a delimiter. |

### Warning

| Code | Meaning |
|---|---|
| `AGS-EMPTY` | A quoted value contains only whitespace and should usually be `""`. |

### Information

| Code | Meaning |
|---|---|
| `AGS-CSV` | Low-level CSV/tokenization issue such as an unterminated quoted field or missing comma. |

## AGS3

### Error

| Code | Meaning |
|---|---|
| `AGS3-ASCII` | File contains non-ASCII characters. |
| `AGS3-HEADINGS` | AGS3 group is missing a heading row. |
| `AGS3-HEADING-COUNT` | AGS3 group has more than 60 headings. |
| `AGS3-UNITS` | Missing or malformed AGS3 `<UNITS>` row. |
| `AGS3-COLUMNS` | AGS3 `<UNITS>` row or data row does not match the heading column count. The message includes both the heading count and the row count. |
| `AGS3-KEY` | Required AGS3 key field is missing from the heading row. |
| `AGS3-CONT` | AGS3 continuation row does not begin with `<CONT>`. |
| `AGS3-HEADING-CONT` | AGS3 heading continuation is malformed and appears to split within a heading instead of between complete heading values. |
| `AGS3-MISSING-GROUP` | Required AGS3 file-level group is missing. |
| `AGS3-KEY-ORDER` | Expected first key field order is not followed, such as `PROJ_ID` or `HOLE_ID`. |
| `AGS3-DICT` | Custom AGS3 groups/headings are used without a `DICT` group. |
| `AGS3-CODE` | `CNMT` or `?ICCT` data is present without a `CODE` group. |
| `AGS3-LENGTH` | AGS3 line exceeds the 240-character limit. |
| `AGS3-UNITS-CONT` | AGS3 `<UNITS>` continuation is malformed and appears to split within a unit instead of between complete unit values. |

### Warning

| Code | Meaning |
|---|---|
| `AGS3-GROUP` | Unknown AGS3 group code. |
| `AGS3-CUSTOM-GROUP` | Custom AGS3 group name does not match the allowed `?NAME` pattern. |
| `AGS3-HEADING` | Heading is not defined for the AGS3 group in the reference data. |
| `AGS3-CUSTOM-HEADING` | Custom AGS3 heading does not match the allowed `?NAME` pattern. |
| `AGS3-KEY-DUP` | Duplicate AGS3 key combination exists within a group. |
| `AGS3-UNIT-VALUE` | Unit does not match the AGS3 reference unit for the heading. |
| `AGS3-RECOMMENDED-GROUP` | Expected AGS3 supporting group, currently `ABBR`, is missing. |
| `AGS3-PARENT` | Parent-group key reference could not be resolved. |

### Information

| Code | Meaning |
|---|---|
| `AGS3-STRUCTURE` | AGS3 content was encountered before a valid AGS3 group line. |
| `AGS3-HEADING-STANDARD` | A file heading matches a standard AGS 3.1 heading only after normalizing the `?` prefix. The message shows the standard heading form. |

## AGS4

### Error

| Code | Meaning |
|---|---|
| `AGS4-GROUP` | AGS4 `GROUP` row shape is invalid. |
| `AGS4-HEADINGS` | AGS4 group is missing a `HEADING` row. |
| `AGS4-REQUIRED` | A heading marked as `REQUIRED` in AGS4 `DICT_STAT` is missing from the group's `HEADING` row. |
| `AGS4-TYPE` | AGS4 group is missing a `TYPE` row or a `TYPE` value does not match the reference definition. |
| `AGS4-COLUMNS` | AGS4 `UNIT`, `TYPE`, or `DATA` row column count does not match the `HEADING` row. |

### Warning

| Code | Meaning |
|---|---|
| `AGS4-GROUP` | AGS4 group code is unknown in the reference data. |
| `AGS4-HEADING` | Heading is not defined for the AGS4 group in the reference data. |
| `AGS4-UNIT` | Unit does not match the AGS4 reference unit for the heading. |

### Information

| Code | Meaning |
|---|---|
| `AGS4-STRUCTURE` | AGS4 content was encountered before a valid AGS4 `GROUP` row. |

## Source Files

- [src/linter/linter.js](/c:/Users/ZhongY2/source/repos/agslint/src/linter/linter.js)
- [src/parser/ags3Parser.js](/c:/Users/ZhongY2/source/repos/agslint/src/parser/ags3Parser.js)
- [src/parser/ags4Parser.js](/c:/Users/ZhongY2/source/repos/agslint/src/parser/ags4Parser.js)
- [src/utils/lineParser.js](/c:/Users/ZhongY2/source/repos/agslint/src/utils/lineParser.js)
