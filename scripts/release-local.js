"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const baseDir = path.resolve(__dirname, "..");
const pkgPath = path.join(baseDir, "package.json");
const lockPath = path.join(baseDir, "package-lock.json");
const changelogPath = path.join(baseDir, "CHANGELOG.md");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function parseSemver(version) {
  const match = String(version).trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Invalid semver version "${version}".`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function formatSemver(version) {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function resolveNextVersion(currentVersion, bumpSpec) {
  if (/^\d+\.\d+\.\d+$/.test(bumpSpec)) {
    return bumpSpec;
  }

  const current = parseSemver(currentVersion);
  if (bumpSpec === "patch") {
    return formatSemver({ major: current.major, minor: current.minor, patch: current.patch + 1 });
  }

  if (bumpSpec === "minor") {
    return formatSemver({ major: current.major, minor: current.minor + 1, patch: 0 });
  }

  if (bumpSpec === "major") {
    return formatSemver({ major: current.major + 1, minor: 0, patch: 0 });
  }

  throw new Error(`Unsupported bump "${bumpSpec}". Use patch, minor, major, or an explicit x.y.z version.`);
}

function updateVersions(nextVersion) {
  const pkg = readJson(pkgPath);
  pkg.version = nextVersion;
  writeJson(pkgPath, pkg);

  const lock = readJson(lockPath);
  lock.version = nextVersion;
  if (lock.packages && lock.packages[""]) {
    lock.packages[""].version = nextVersion;
  }
  writeJson(lockPath, lock);
}

function ensureChangelogEntry(nextVersion, currentVersion) {
  const changelog = fs.readFileSync(changelogPath, "utf8");
  const heading = `## ${nextVersion}`;
  if (changelog.includes(heading)) {
    return;
  }

  const lines = [
    "# AGSLint",
    "",
    heading,
    "",
    "### Release Notes",
    "",
    `- Local release build bumped from \`${currentVersion}\` to \`${nextVersion}\`. Update this entry before publishing externally if needed.`,
    ""
  ];

  const withoutTitle = changelog.replace(/^#\s+AGSLint\s*\r?\n\r?\n?/, "");
  fs.writeFileSync(changelogPath, `${lines.join("\n")}${withoutTitle}`, "utf8");
}

function run(command, args) {
  const executable = process.platform === "win32" ? `${command}.cmd` : command;
  const escapedArgs = args.map((arg) => /[\s"]/u.test(arg) ? `"${String(arg).replace(/"/g, '\\"')}"` : arg);
  execSync([executable, ...escapedArgs].join(" "), {
    cwd: baseDir,
    stdio: "inherit"
  });
}

function main() {
  const args = process.argv.slice(2);
  const skipTests = args.includes("--skip-tests");
  const filteredArgs = args.filter((arg) => arg !== "--skip-tests");
  const bumpSpec = filteredArgs[0] || "patch";
  const pkg = readJson(pkgPath);
  const currentVersion = pkg.version;
  const nextVersion = resolveNextVersion(currentVersion, bumpSpec);

  if (currentVersion === nextVersion) {
    console.log(`Version already at ${nextVersion}.`);
  } else {
    updateVersions(nextVersion);
    ensureChangelogEntry(nextVersion, currentVersion);
    console.log(`Updated version: ${currentVersion} -> ${nextVersion}`);
  }

  if (!skipTests) {
    run("npm", ["test"]);
  }

  run("npm", ["run", "package:vsix"]);

  console.log(`Built dist/agslint-${nextVersion}.vsix`);
}

main();
