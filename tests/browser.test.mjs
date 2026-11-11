import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

const launch = promisify(execFile);

const server = createServer(async (request, response) => {
    const { pathname } = new URL(request.url, 'http://localhost');
    if (!/^\/(?:tests\/(?:fixture\.html|highlighting\.mjs)|popup\/popup\.(?:html|css)|shared\/[\w-]+\.css|dist\/(?:[\w-]+\/)*[\w-]+\.js)$/.test(pathname)) {
        response.writeHead(404).end();
        return;
    }
    try {
        const content = await readFile(new URL(`..${pathname}`, import.meta.url));
        const type = pathname.endsWith('.html') ? 'text/html' : pathname.endsWith('.css') ? 'text/css' : 'text/javascript';
        response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }).end(content);
    } catch {
        response.writeHead(404).end();
    }
});

test.before(async () => {
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
});

test.after(() => {
    server.close();
});

async function runBrowserCases(group = '', timeout = 15_000) {
    const profile = await mkdtemp(join(tmpdir(), 'goose-browser-test-'));
    const url = new URL(`http://127.0.0.1:${server.address().port}/tests/fixture.html`);
    url.search = group;

    try {
        const { stdout, stderr } = await launch(process.env.CHROME_BIN || 'google-chrome', [
            '--headless',
            '--disable-background-networking',
            '--no-first-run',
            '--no-default-browser-check',
            '--enable-logging=stderr',
            '--virtual-time-budget=4000',
            `--user-data-dir=${profile}`,
            '--dump-dom',
            url.href,
        ], { signal: AbortSignal.timeout(timeout) });

        const report = stdout.match(/<pre id="test-results">([A-Za-z0-9+/=]+)<\/pre>/);
        assert.ok(report, `Browser did not report results.\n${stderr}`);
        const cases = JSON.parse(Buffer.from(report[1], 'base64').toString('utf8'));
        assert.ok(cases.length > 0, 'Browser reported no tests');
        return cases;
    } catch (error) {
        if (error.name === 'AbortError') {
            assert.fail(`The browser suite timed out after ${timeout} ms`);
        }
        if (error.code === 'ENOENT') {
            assert.fail('Chrome executable not found. Set CHROME_BIN to a Chromium-based browser executable.');
        }
        throw error;
    } finally {
        await rm(profile, { recursive: true, force: true, maxRetries: 3 });
    }
}

test('browser highlighting and wordlist import', async context => {
    for (const { name, error } of await runBrowserCases()) {
        await context.test(name, () => {
            if (error) assert.fail(error);
        });
    }
});

test('an empty stored entry does not stall highlighting valid entries', async () => {
    const [result] = await runBrowserCases('empty-entry', 8_000);
    if (result.error) assert.fail(result.error);
});
