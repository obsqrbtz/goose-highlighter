import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { cpus, platform, release, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const launch = promisify(execFile);
const browser = process.env.CHROME_BIN || 'google-chrome';
const args = process.argv.slice(2);
const defaults = ['small', 'sparse-with-updates', 'mixed', 'dense'];
const workloads = args.length ? args : defaults;

const available = [...defaults, 'stress', 'large-list', 'large-list-dense'];
if (workloads.some(name => !available.includes(name))) {
    throw new Error(`Choose one or more workloads: ${available.join(', ')}`);
}

async function run(name) {
    const profile = await mkdtemp(join(tmpdir(), 'goose-benchmark-'));
    const controller = new AbortController();
    const { promise: report, resolve: receiveReport, reject: rejectReport } = Promise.withResolvers();
    const server = createServer(async (request, response) => {
        const { pathname } = new URL(request.url, 'http://localhost');
        if (request.method === 'POST' && pathname === '/report') {
            try {
                const chunks = [];
                for await (const chunk of request) chunks.push(chunk);
                const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                response.writeHead(204).end();
                receiveReport(result);
            } catch (error) {
                response.writeHead(400).end();
                rejectReport(error);
            }
            return;
        }

        if (!/^\/(?:tests\/benchmarks\/(?:fixture\.html|highlighting\.mjs)|dist\/(?:[\w-]+\/)*[\w-]+\.js)$/.test(pathname)) {
            response.writeHead(404).end();
            return;
        }
        try {
            const content = await readFile(new URL(`../..${pathname}`, import.meta.url));
            const type = pathname.endsWith('.html') ? 'text/html' : 'text/javascript';
            response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }).end(content);
        } catch {
            response.writeHead(404).end();
        }
    });

    let processExit;
    let timeout;
    try {
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const url = new URL(`http://127.0.0.1:${server.address().port}/tests/benchmarks/fixture.html`);
        url.searchParams.set('workload', name);
        processExit = launch(browser, [
            '--headless', '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
            '--enable-logging=stderr', `--user-data-dir=${profile}`, url.href,
        ], { signal: controller.signal });
        const { report: result, error } = await Promise.race([
            report,
            processExit.then(({ stderr }) => { throw new Error(`Browser exited before reporting results.\n${stderr}`); }),
            new Promise((_, reject) => {
                timeout = setTimeout(() => reject(new Error(`Benchmark "${name}" timed out after 120 seconds`)), 120_000);
            }),
        ]);
        if (error) throw new Error(error);
        return result;
    } finally {
        clearTimeout(timeout);
        controller.abort();
        await processExit?.catch(() => {});
        server.close();
        server.closeAllConnections();
        await rm(profile, { recursive: true, force: true, maxRetries: 3 });
    }
}

const { stdout: version } = await launch(browser, ['--version']);
console.error(`${version.trim()} | Node ${process.version} | ${platform()} ${release()} | ${cpus()[0]?.model}`);
const results = {};
for (const name of workloads) {
    console.error(`Running ${name}…`);
    results[name] = await run(name);
}
console.log(JSON.stringify({
    browser: version.trim(),
    node: process.version,
    os: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model,
    results,
}, null, 2));
