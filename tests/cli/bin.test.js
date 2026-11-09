/**
 * The bin script must not exit before stdout and stderr have written
 * everything.
 *
 * Writes to a pipe are asynchronous on POSIX (Linux and macOS), so
 * `process.exit()` straight after a long write cut the output at 64 KiB for a
 * reader that was not ready yet (`wp-tooling list --json | jq`). Pipes are
 * synchronous on Windows, where this cannot happen, so the suite skips it.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BIN = path.join(__dirname, '..', '..', 'bin', 'wp-tooling.js');
const EXIT = path.join(__dirname, '..', '..', 'src', 'cli', 'exit.js');

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

	it('writes all of a long stderr message to a late reader and keeps the code', () => {
		// A failure message longer than a pipe buffer, through the same exit path.
		const script = [
			`const { flushAndExit } = require(${JSON.stringify(EXIT)});`,
			'process.stderr.write("x".repeat(200000));',
			'flushAndExit(3);',
		].join(' ');
		const node = `"${process.execPath}" -e '${script}'`;

		// The reader starts late: every byte arrives, and the code survives.
		const [received, code] = execFileSync(
			'bash',
			['-c', `${node} 2>&1 | (sleep 1; wc -c); echo "\${PIPESTATUS[0]}"`],
			{ encoding: 'utf8' }
		)
			.trim()
			.split(/\s+/)
			.map(Number);
		expect(received).toBe(200000);
		expect(code).toBe(3);
		const status = (cmd) => {
			try {
				execFileSync('bash', ['-c', cmd], { stdio: 'ignore' });
				return 0;
			} catch (err) {
				return err.status;
			}
		};
		// The reader leaves after one byte: EPIPE must not replace the code.
		expect(
			status(
				`${node} 2>&1 | head -c 1 >/dev/null; exit "\${PIPESTATUS[0]}"`
			)
		).toBe(3);
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
