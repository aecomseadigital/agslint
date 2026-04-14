# AGSLint

AGSLint is the world's first open-sourced VS Code extension for linting and validating AGS3 and AGS4 `.ags` files for geotechnical engineers. This repo currently targets local and private extension use, with AGS reference data stored in the repo and editor diagnostics provided directly by the extension.

## Tribute

This project is built with clear respect for the <a href='https://gitlab.com/ags-data-format-wg/ags-python-library'>AGS Python Library</a> maintained by the <a href='https://www.ags.org.uk/group/data-management/'>AGS Data Format Working Group</a>. Their work on reading, writing, and checking AGS files, together with the surrounding documentation and standards guidance, has materially improved the AGS tooling ecosystem and helped establish a stronger foundation for projects like this one.

References:

- AGS Python Library README: https://gitlab.com/ags-data-format-wg/ags-python-library/-/blob/main/README.md
- AGS Python Library documentation: https://ags-data-format-wg.gitlab.io/ags-python-library/

## Current Capabilities

- Registers the `ags` language and `.ags` file extension in VS Code
- Provides AGS syntax highlighting through the bundled TextMate grammar
- Detects AGS3 versus AGS4 content and resolves bundled AGS4 dictionary editions from `TRAN_AGS`
- Reports diagnostics for structural, schema, and formatting issues against the matching AGS schema edition
- Provides quick fixes for selected lint findings
- Adds these command palette commands:
  - `AGSLint: Run Lint on File`
  - `AGSLint: Show AGS Version`

## Repo Layout

- `src/` contains the extension entrypoint, linter, parsers, references, and tests
- `ref/` contains raw AGS reference files used as source data, including bundled AGS4 standard dictionaries for 4.0.3, 4.0.4, 4.1, 4.1.1, and 4.2
- `generated/` contains optional derived JSON outputs produced from the reference data
- `syntaxes/` contains the TextMate grammar for AGS syntax highlighting
- `scripts/` contains helper scripts for reference generation and file linting
- `.changeset/` contains pending release notes and Changesets configuration
- `.github/workflows/` contains CI and release automation

## Local Development

Install dependencies:

```bash
npm ci
```

Run the test suite:

```bash
npm test
```

Rebuild the generated reference JSON:

```bash
npm run build-references
```

Create a changeset for a pull request that changes shipped behavior or release output:

```bash
npm run changeset
```

Build a private VSIX artifact and checksum:

```bash
npm run package:vsix
```

Create a local release build with an automatic version bump:

```bash
npm run release:local
```

This defaults to a patch bump. You can also use `npm run release:local -- minor`, `npm run release:local -- major`, or `npm run release:local -- 0.2.0`.

Run the release verification flow locally:

```bash
npm run release:verify
```

To run the extension in VS Code, open this repo in VS Code and start the existing `Run AGSLint Extension` launch configuration from `.vscode/launch.json`.

## Packaging And Releases

This repo now packages AGSLint as a private `.vsix` and uses Changesets to manage version bumps and changelog updates.

- VSIX packaging is handled by `@vscode/vsce`
- packaged artifacts are written to `dist/`
- release notes are tracked through `.changeset/*.md`
- `CHANGELOG.md` is the release history source of truth
- GitHub is set up for automated release PRs and tagged releases from `main`
- local fallback release steps are documented in [RELEASING.md](./RELEASING.md)

## Diagnostics

Implemented diagnostics are documented in [DIAGNOSTICS.md](./DIAGNOSTICS.md).

## Status And Limitations

- The extension is intentionally packaged for private VSIX distribution, not Marketplace publishing
- Plain VSIX distribution does not provide VS Code Marketplace-style in-product auto-update
- Reference data is sourced from files committed under `ref/`
- `generated/` is rebuildable helper output, not the primary runtime source of truth
- Packaging and changelog automation assume the configured CI platform is available for workflow execution
