# Changesets

This repo uses [Changesets](https://github.com/changesets/changesets) to manage version bumps and changelog entries.

For any pull request that changes shipped behavior, packaging, or release output:

1. Run `npm run changeset`
2. Select the `agslint` package
3. Choose the semver bump level
4. Write a short human-readable summary

The generated markdown file in `.changeset/` should be committed with the pull request. The release workflow consumes those files when it prepares the version PR.
