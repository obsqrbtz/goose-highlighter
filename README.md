# <img src="img/logo.png" alt="Goose Highlighter Logo" width="32" style="vertical-align: middle;"> Goose Highlighter

Goose Highlighter is a browser extension that allows you to highlight words on any webpage.

## Features

- **Multiple Highlight Lists:** Organize words into separate lists.
- **Custom Colors:** Set background and foreground for each list or individual word.
- **Bulk Add:** Paste multiple words at once.
- **Enable/Disable:** Toggle highlighting globally, per list, or per word.
- **Page Navigation:** View all highlights on the current page and jump to any occurrence with a single click.
- **Site Exceptions:** Add specific websites to an exceptions list to disable highlighting there.
- **Import/Export:** Backup or share your highlight lists and exceptions as JSON files.

## Install

### From Chrome Web Store (Recommended)
- Go to [Chrome Web Store page](https://chromewebstore.google.com/detail/goose-highlighter/kdoehicejfnccbmecpkfjlbljpfogoep) and choose `Add to chrome`.

### Manual Installation

#### Option 1: Install from CRX File (Releases)
1. **Download:** Get the latest `.crx` file from the [Releases section](https://github.com/obsqrbtz/goose-highlighter/releases)
2. **Install in Chrome:**
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top-right corner)
   - Drag and drop the `.crx` file onto the extensions page
   - Click "Add extension" when prompted

#### Option 2: Install from ZIP File (Releases)
1. **Download:** Get the latest `.zip` file from the [Releases section](https://github.com/obsqrbtz/goose-highlighter/releases)
2. **Extract:** Unzip the downloaded file to a folder of your choice
3. **Load in Chrome:**
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top-right corner)
   - Click "Load unpacked" button
   - Select the extracted folder containing the extension files

#### Option 3: Build from Source
1. **Prerequisites:** Node.js 20+ and npm
2. **Clone the repository:**
   ```bash
   git clone https://github.com/obsqrbtz/goose-highlighter.git
   cd goose-highlighter
   ```
3. **Install dependencies:**
   ```bash
   npm install
   ```
4. **Build the extension:**
   ```bash
   npm run build
   ```
5. **Load in Chrome:**
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top-right corner)
   - Click "Load unpacked" button
   - Select the entire `goose-highlighter` folder (not the `dist` folder)

