const fs = require("fs");
const path = require("path");

module.exports = async ({ nextRelease }) => {
    const manifestPath = path.resolve(__dirname, "../manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    manifest.version = nextRelease.version;

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`✅ Updated manifest.json to version ${nextRelease.version}`);
};