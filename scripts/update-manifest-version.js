const fs = require('fs');

const version = process.argv[2];
if (!version) {
    console.log('No version passed, skipping manifest update');
    process.exit(0);
}

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf-8'));
manifest.version = version;
fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2));

console.log(`Updated manifest.json to version ${version}`);