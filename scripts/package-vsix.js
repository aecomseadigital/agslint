"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createVSIX } = require("@vscode/vsce");

async function main() {
  const baseDir = path.resolve(__dirname, "..");
  const pkg = require(path.join(baseDir, "package.json"));
  const distDir = path.join(baseDir, "dist");
  const vsixName = `agslint-${pkg.version}.vsix`;
  const vsixPath = path.join(distDir, vsixName);
  const checksumPath = `${vsixPath}.sha256`;

  fs.mkdirSync(distDir, { recursive: true });

  await createVSIX({
    cwd: baseDir,
    packagePath: vsixPath,
    dependencies: false
  });

  const checksum = crypto
    .createHash("sha256")
    .update(fs.readFileSync(vsixPath))
    .digest("hex");

  fs.writeFileSync(checksumPath, `${checksum}  ${vsixName}\n`, "utf8");

  console.log(`Wrote ${vsixPath}`);
  console.log(`Wrote ${checksumPath}`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
