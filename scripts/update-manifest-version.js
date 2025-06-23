const fs = require("fs");

const version = process.argv[2];
if (!version) {
    console.error("❌ No version passed");
    process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf-8"));
manifest.version = version;
fs.writeFileSync("manifest.json", JSON.stringify(manifest, null, 2));

console.log(`✅ Updated manifest.json to version ${version}`);