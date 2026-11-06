/**
 * The bin script must not exit before stdout has written everything.
 *
 * Writes to a pipe are asynchronous on macOS, so `process.exit()` straight
 * after a long write cut the output at 64 KiB for a reader that was not ready
 * yet (`wp-tooling list --json | jq`). Linux writes to pipes synchronously, so
 * there this test passes either way; it guards the macOS case.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BIN = path.join(__dirname, '..', '..', 'bin', 'wp-tooling.js');

const isWindows = 'win32' === process.platform;

(isWindows ? describe.skip : describe)('bin/wp-tooling.js', () => {
	it('writes all of a long report to a pipe whose reader starts late', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-tooling-bin-'));
		try {
			const file = path.join(dir, 'list.json');
			// The full output, written to a file, which is never cut short.
			execFileSync(
				'sh',
				[
					'-c',
					`"${process.execPath}" "${BIN}" list --json > "${file}"`,
				],
				{ stdio: 'ignore' }
			);
			const expected = fs.statSync(file).size;
			// Bigger than a pipe buffer, or the test proves nothing.
			expect(expected).toBeGreaterThan(65536);

			const received = execFileSync(
				'sh',
				[
					'-c',
					`"${process.execPath}" "${BIN}" list --json | (sleep 1; wc -c)`,
				],
				{ encoding: 'utf8' }
			);
			expect(Number(received.trim())).toBe(expected);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it('keeps the exit code of the command', () => {
		let status = 0;
		try {
			execFileSync(process.execPath, [BIN, 'no-such-command'], {
				stdio: 'ignore',
			});
		} catch (err) {
			status = err.status;
		}
		expect(status).toBe(2);
	});
});
