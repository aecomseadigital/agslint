# Releasing AGSLint

AGSLint ships as a private `.vsix` package and uses Changesets to manage version bumps and changelog updates.

## Contributor Flow

1. Make your code change.
2. Run `npm run changeset`.
3. Commit the generated `.changeset/*.md` file with the rest of your work.
4. Merge the pull request normally.

## Automated Flow On GitHub

1. Pushes to `main` with unreleased changesets trigger the release workflow.
2. `changesets/action` opens or updates a `Version Packages` pull request.
3. Merge that release PR.
4. The next push to `main` sees that:
   - the version in `package.json` is not tagged yet
   - there are no pending `.changeset/*.md` files left to consume
5. The workflow runs `npm ci`, `npm test`, packages `dist/agslint-<version>.vsix`, writes a SHA-256 checksum, tags `v<version>`, and creates a GitHub Release with both artifacts attached.

## Runner Labels

The workflows default to `ubuntu-latest`, which works on GitHub-hosted runners. On other CI platforms, set a repository or organization variable named `CI_RUNNER` to the actual runner label exposed by that platform.

Examples:

- `ubuntu-latest` for GitHub-hosted Linux
- `self-hosted` for a generic self-hosted runner
- a custom internal label such as `linux`, `ubuntu-22.04`, or whatever your runner is registered with

If `CI_RUNNER` is not set, the workflows fall back to `ubuntu-latest`.

## Local Fallback Flow

If GitHub Actions is unavailable, use this sequence locally from `main`:

```bash
npm ci
npm run release:version
git add package.json CHANGELOG.md .changeset
git commit -m "Version AGSLint"
npm run release:verify
git tag v<version>
```

The packaged artifact will be written to `dist/agslint-<version>.vsix` and the checksum to `dist/agslint-<version>.vsix.sha256`.

## Installation And Rollout

- Manual install: `code --install-extension dist/agslint-<version>.vsix --force`
- Managed rollout: distribute the latest VSIX and checksum through your internal software deployment tooling, then reinstall with `--force` on managed machines

Plain VSIX distribution does not provide Marketplace-style automatic updates inside VS Code. The automation here reduces maintainer work and makes managed rollout predictable; it does not make client updates self-service.
