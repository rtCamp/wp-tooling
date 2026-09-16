/**
 * In-place project transform: file collection, content search-replace, file
 * renaming, and version stamping — plus the constant lists that drive them.
 *
 * All replacement is literal (no regex source from user input beyond escaped
 * tokens), binary-safe, and skips ignored paths.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

/**
 * Require a nonempty relative path without parent traversal.
 *
 * @param {string} value Configured path.
 * @return {void}
 */
const validateRelativePath = (value) => {
	if (
		'string' !== typeof value ||
		!value ||
		path.isAbsolute(value) ||
		value.split(/[\\/]/).includes('..')
	) {
		throw new Error(
			`Expected a relative path without "..", received ${JSON.stringify(value)}`
		);
	}
};

/**
 * Resolve a project-relative path and assert it stays inside `root`, so a config
 * value can never reach outside the project being initialized (e.g. a stray
 * `../` in an examples glob or cleanup target). Throws on any escape.
 *
 * @param {string} root - Project root (the containment boundary).
 * @param {string} rel  - Untrusted relative (or absolute) path from a config.
 * @return {string} The resolved absolute path, guaranteed within root.
 */
const resolveWithin = (root, rel) => {
	const base = path.resolve(root);
	const abs = path.resolve(base, rel);
	if (abs !== base && !abs.startsWith(base + path.sep)) {
		throw new Error(`Refusing path outside the project root: ${rel}`);
	}
	if (!fs.existsSync(base)) {
		return abs;
	}
	const realBase = fs.realpathSync(base);
	let ancestor = abs;
	while (!fs.existsSync(ancestor)) {
		if (
			fs.lstatSync(ancestor, { throwIfNoEntry: false })?.isSymbolicLink()
		) {
			throw new Error(`Refusing unresolved symlink: ${rel}`);
		}
		ancestor = path.dirname(ancestor);
	}
	const realAncestor = fs.realpathSync(ancestor);
	if (
		realAncestor !== realBase &&
		!realAncestor.startsWith(realBase + path.sep)
	) {
		throw new Error(`Refusing path outside the project root: ${rel}`);
	}
	return abs;
};

/**
 * File extensions treated as binary and never opened for search-replace.
 */
const BINARY_EXTENSIONS = [
	'.png',
	'.jpg',
	'.jpeg',
	'.gif',
	'.webp',
	'.ico',
	'.bmp',
	'.avif',
	'.woff',
	'.woff2',
	'.ttf',
	'.otf',
	'.eot',
	'.map',
	'.pdf',
	'.zip',
	'.gz',
	'.tar',
	'.mp4',
	'.webm',
	'.mov',
	'.mp3',
	'.wav',
];

/**
 * Directory / file names skipped while walking a project for replacement.
 *
 * `bin` is skipped so the per-project scaffold config (which embeds the search
 * tokens verbatim) is never corrupted; `build`/lock files avoid generated noise.
 * `.claude` is skipped because it holds generic, reusable AI skills whose prose
 * uses the placeholder name ("Project Name", "project name") as example text -
 * renaming those to the real project name corrupts the instructions (e.g.
 * "Never assume a project name" would become "Never assume a <project>").
 */
const DEFAULT_IGNORE = [
	'.git',
	'node_modules',
	'vendor',
	'bin',
	'build',
	'.claude',
	'package-lock.json',
	'composer.lock',
];

/**
 * PHP reserved keywords that cannot be used as a namespace segment or identifier.
 */
const PHP_RESERVED_WORDS = [
	'abstract',
	'and',
	'array',
	'as',
	'bool',
	'break',
	'callable',
	'case',
	'catch',
	'class',
	'clone',
	'const',
	'continue',
	'declare',
	'default',
	'do',
	'echo',
	'else',
	'elseif',
	'empty',
	'enddeclare',
	'endfor',
	'endforeach',
	'endif',
	'endswitch',
	'endwhile',
	'enum',
	'eval',
	'exit',
	'extends',
	'false',
	'final',
	'finally',
	'float',
	'fn',
	'for',
	'foreach',
	'function',
	'global',
	'goto',
	'if',
	'implements',
	'include',
	'instanceof',
	'insteadof',
	'int',
	'interface',
	'isset',
	'iterable',
	'list',
	'match',
	'mixed',
	'namespace',
	'never',
	'new',
	'null',
	'object',
	'or',
	'parent',
	'print',
	'private',
	'protected',
	'public',
	'readonly',
	'require',
	'return',
	'self',
	'static',
	'string',
	'switch',
	'throw',
	'trait',
	'true',
	'try',
	'unset',
	'use',
	'var',
	'void',
	'while',
	'xor',
	'yield',
];

/**
 * Recursively collect every file under `dir`, skipping ignored names.
 *
 * @param {string}   dir      - Directory to walk.
 * @param {string[]} [ignore] - Directory / file names to skip.
 * @return {string[]} Absolute file paths.
 */
const collectFiles = (dir, ignore = DEFAULT_IGNORE) => {
	const entries = fs.readdirSync(dir, { withFileTypes: true });

	let files = [];
	entries.forEach((entry) => {
		if (ignore.includes(entry.name)) {
			return;
		}
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files = files.concat(collectFiles(full, ignore));
		} else if (entry.isFile()) {
			files.push(full);
		}
	});
	return files;
};

/**
 * Whether a file should be treated as binary (skip content replacement).
 *
 * @param {string} filePath - File path (for the extension check).
 * @param {Buffer} buffer   - File contents.
 * @return {boolean} True if binary.
 */
const isBinary = (filePath, buffer) => {
	if (BINARY_EXTENSIONS.includes(path.extname(filePath).toLowerCase())) {
		return true;
	}
	return buffer.includes(0);
};

/**
 * Escape a literal string for use inside a RegExp.
 *
 * @param {string} value - Literal.
 * @return {string} Escaped.
 */
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Apply every replacement pair to a string in a SINGLE pass.
 *
 * Each source token is matched at most once and substituted text is never
 * re-scanned, so a new token that contains an old one (e.g. renaming `Aryan` to
 * `AryanX`) can't cascade. Pairs are assumed de-duplicated and longest-source-
 * first, so the alternation prefers the most specific token at each position.
 *
 * @param {string}                  text         - Input string.
 * @param {Array<[string, string]>} replacements - Ordered [ from, to ] pairs.
 * @return {string} Replaced string.
 */
const applyReplacements = (text, replacements) => {
	if (!replacements.length) {
		return text;
	}
	const map = new Map(replacements);
	const pattern = replacements.map(([from]) => escapeRegExp(from)).join('|');
	return text.replace(new RegExp(pattern, 'g'), (match) => map.get(match));
};

/**
 * Run synchronous file edits with rollback on failure. Only written contents
 * and completed renames are journaled; this is not a process-crash recovery log.
 * Reverse order restores paths before earlier writes at those paths are undone.
 *
 * @param {Function} apply Callback receiving journaled writeFile and renameFile.
 * @return {*} Callback result.
 */
const withFileRollback = (apply) => {
	const undo = [];
	const writeFile = (file, content, options) => {
		const existed = fs.existsSync(file);
		const original = existed ? fs.readFileSync(file) : null;
		// Register before writing: a failed write may have truncated the file.
		undo.push(() => {
			if (existed) {
				fs.writeFileSync(file, original);
			} else {
				fs.rmSync(file, { force: true });
			}
		});
		fs.writeFileSync(file, content, options);
	};
	const renameFile = (from, to) => {
		fs.renameSync(from, to);
		undo.push(() => fs.renameSync(to, from));
	};
	try {
		return apply({ writeFile, renameFile });
	} catch (error) {
		const rollbackErrors = [];
		for (const restore of undo.reverse()) {
			try {
				restore();
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError);
			}
		}
		if (rollbackErrors.length) {
			throw new AggregateError(
				[error, ...rollbackErrors],
				`${error.message}; rollback failed: ${rollbackErrors.map((failure) => failure.message).join('; ')}. Inspect the project before retrying.`
			);
		}
		throw error;
	}
};

/**
 * Replace token content across files in place.
 *
 * @param {string[]}                files        - Absolute file paths.
 * @param {Array<[string, string]>} replacements - Ordered [ from, to ] pairs.
 * @param {Function}                [writeFile]  Synchronous writer (journaled during identity edits).
 * @return {number} Count of files changed.
 */
const replaceInFiles = (files, replacements, writeFile = fs.writeFileSync) => {
	let changed = 0;
	files.forEach((filePath) => {
		try {
			const buffer = fs.readFileSync(filePath);
			if (isBinary(filePath, buffer)) {
				return;
			}
			const original = buffer.toString('utf8');
			const updated = applyReplacements(original, replacements);
			if (updated !== original) {
				writeFile(filePath, updated, 'utf8');
				changed++;
			}
		} catch (err) {
			throw new Error(`Could not replace ${filePath}: ${err.message}`, {
				cause: err,
			});
		}
	});
	return changed;
};

/**
 * Check every rename destination before any content or path changes.
 *
 * @param {string[]} files        Source file paths.
 * @param {Array}    replacements Literal replacement pairs.
 * @return {Array} Validated source/destination pairs.
 */
const planRenames = (files, replacements) => {
	const renames = files
		.map((from) => ({
			from,
			to: path.join(
				path.dirname(from),
				applyReplacements(path.basename(from), replacements)
			),
		}))
		.filter(({ from, to }) => from !== to);
	const sources = new Set(
		renames.map(({ from }) => fs.realpathSync.native(from))
	);
	const destinations = new Set();
	const caseSensitive = new Map();
	for (const { from, to } of renames) {
		const dir = path.dirname(to);
		if (!caseSensitive.has(dir)) {
			// Probe the actual directory's filesystem, not the host OS default.
			const probe = fs.mkdtempSync(path.join(dir, '.wp-init-case-'));
			try {
				fs.writeFileSync(path.join(probe, 'probe'), '');
				caseSensitive.set(
					dir,
					!fs.existsSync(path.join(probe, 'PROBE'))
				);
			} finally {
				fs.rmSync(probe, { recursive: true, force: true });
			}
		}
		const key = caseSensitive.get(dir) ? to : to.toLowerCase();
		const existing = fs.lstatSync(to, { throwIfNoEntry: false });
		const vacated =
			existing &&
			!existing.isSymbolicLink() &&
			sources.has(fs.realpathSync.native(to));
		if (destinations.has(key) || (existing && !vacated)) {
			throw new Error(
				`Rename collision: expected an unused destination for ${from}, received ${to}`
			);
		}
		destinations.add(key);
	}
	return renames;
};

/**
 * Execute a validated plan, staging sources so chains and swaps cannot overwrite.
 *
 * @param {Array}    renames    Validated source/destination pairs.
 * @param {Function} renameFile Journaled synchronous rename.
 * @return {number} Number of logical renames.
 */
const executeRenames = (renames, renameFile) => {
	const staged = renames.map((entry) => ({
		...entry,
		temp: path.join(
			path.dirname(entry.from),
			`.wp-init-rename-${randomUUID()}`
		),
	}));
	for (const { from, temp } of staged) {
		renameFile(from, temp);
	}
	for (const { temp, to } of staged) {
		renameFile(temp, to);
	}
	return renames.length;
};

/**
 * Plan and atomically apply a batch of file renames on synchronous failure.
 *
 * @param {string[]} files        Source paths.
 * @param {Array}    replacements Literal replacement pairs.
 * @return {number} Number of renamed files.
 */
const renameFiles = (files, replacements) => {
	const plan = planRenames(files, replacements);
	return withFileRollback(({ renameFile }) =>
		executeRenames(plan, renameFile)
	);
};

/**
 * Write `version` into each configured file.
 *
 * Edits are regex on raw text so each file's formatting survives (no full JSON
 * re-serialise).
 *
 * Supported kinds:
 *   - `json`        : the top-level `"version": "..."` value.
 *   - `css-header`  : a `Version:` line in a stylesheet header comment.
 *   - `php-header`  : a ` * Version:` line in a plugin header docblock.
 *
 * @param {string}                              root         - Project root.
 * @param {Array<{path: string, kind: string}>} versionFiles - Targets.
 * @param {string}                              version      - Version to apply.
 * @param {Object}                              ui           - `@rtcamp/wp-tooling/ui`.
 * @param {Function}                            [writeFile]  Synchronous writer (journaled during identity edits).
 * @return {void}
 */
const applyVersion = (
	root,
	versionFiles,
	version,
	ui,
	writeFile = fs.writeFileSync
) => {
	if (!version || !Array.isArray(versionFiles)) {
		return;
	}

	versionFiles.forEach((spec) => {
		const filePath = resolveWithin(root, spec.path);
		if (!fs.existsSync(filePath)) {
			return;
		}

		try {
			let content = fs.readFileSync(filePath, 'utf8');

			if ('json' === spec.kind) {
				content = content.replace(
					/("version"\s*:\s*")[^"]*(")/,
					`$1${version}$2`
				);
			} else {
				// css-header / php-header: first "Version:" line value.
				content = content.replace(
					/^(\s*\*?\s*Version:\s*).*$/m,
					`$1${version}`
				);
			}

			writeFile(filePath, content, 'utf8');
			ui.info(`version ${version} -> ${spec.path}`);
		} catch (err) {
			throw new Error(
				`Could not set version in ${spec.path}: ${err.message}`,
				{ cause: err }
			);
		}
	});
};

module.exports = {
	withFileRollback,
	validateRelativePath,
	planRenames,
	executeRenames,
	resolveWithin,
	collectFiles,
	applyReplacements,
	replaceInFiles,
	renameFiles,
	applyVersion,
	BINARY_EXTENSIONS,
	DEFAULT_IGNORE,
	PHP_RESERVED_WORDS,
};
