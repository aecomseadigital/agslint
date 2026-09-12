# AGSLint

## 0.2.1

### Patch Changes

- Exclude `.pytest_cache/` from the packaged VSIX.

  The directory is untracked and self-ignoring in git, so it never showed up in a
  diff, but `.vscodeignore` did not list it and `vsce` packaged its four files into
  every build.

## 0.2.0

### Minor Changes

- Add AGS3 CORE_REM data-consistency checks under a new `AGS3-DATA-*` code space.

  These are not AGS format rules — the standard does not constrain what a remark
  may contain — so they are reported separately from `AGS3-RULE-*` conformance:

  - `AGS3-DATA-1` a coreloss / cavity / wash boring range lies outside the core run it is recorded against
  - `AGS3-DATA-2` the void a remark describes disagrees with `CORE_PREC`, reported as a warning when it exceeds what the recovery allows and as information when it falls short (a remark need not enumerate every loss in a run)
  - `AGS3-DATA-3` a depth pair is written high-low
  - `AGS3-DATA-4` a marker is present but no depth range can be read from it

  Depth pairs written as bare integers with no unit are ignored, because
  descriptions list joint dip angles that way (`J1 0-30 J2 30-60`) and reading
  those as depths would claim tens of metres of void on a one-metre run. Wash
  boring is exempt from the recovery arithmetic, since a washbored interval is not
  cored and `CORE_PREC` says nothing about it.

  Ported from AGS Extractor 4.2.4.

## 0.1.4

### Release Notes

- Local release build bumped from `0.1.3` to `0.1.4`. Update this entry before publishing externally if needed.

## 0.1.3

### Patch Changes

- Adjust AGS4 Rule 8 severity and quick fixes, and add AGS3 continuation and unit guidance to the diagnostics documentation.

## 0.1.2

### Patch Changes

- Added bundled AGS4 standard dictionaries for 4.0.3, 4.0.4, 4.1, 4.1.1, and 4.2, selected the matching AGS4 schema from `TRAN_AGS`, and reduced extension startup cost by switching runtime reference loading to generated JSON with cached, debounced linting.

## 0.1.1

### Patch Changes

- Ported editor-safe AGS4 checks from the AGS Python checker, introduced rule-number diagnostics, and aligned AGS3/AGS4 quick fixes and tests with the refactored lint pipeline.

## 0.1.0

### Patch Changes

- Initial private release of the AGSLint VS Code extension with AGS3 and AGS4 linting, diagnostics, quick fixes, and syntax support.
