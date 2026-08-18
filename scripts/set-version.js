const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || "")) {
  throw new Error("Provide a three-part semantic version such as 1.1.2");
}

for (const filename of ["app-manifest.json", "package.json", "package-lock.json"]) {
  const target = path.join(root, filename);
  const document = JSON.parse(fs.readFileSync(target, "utf8").replace(/^\uFEFF/, ""));
  document.version = version;
  if (filename === "package-lock.json" && document.packages?.[""]) {
    document.packages[""].version = version;
  }
  fs.writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

