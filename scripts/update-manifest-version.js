const fs = require("fs");
const path = "./manifest.json";

const version = process.env.npm_package_version;
if (!version) {
    console.error("Version not found in npm_package_version.");
    process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path, "utf8"));
manifest.version = version;
fs.writeFileSync(path, JSON.stringify(manifest, null, 2));

console.log(`Updated manifest.json to version ${version}`);