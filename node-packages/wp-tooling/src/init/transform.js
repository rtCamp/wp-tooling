/**
 * In-place project transform: file collection, content search-replace, file
 * renaming, and version stamping — plus the constant lists that drive them.
 *
 * All replacement is literal (no regex source from user input beyond escaped
 * tokens), binary-safe, and skips ignored paths.
 */

'use strict';

const fs = require( 'fs' );
const path = require( 'path' );

/**
 * Resolve a project-relative path and assert it stays inside `root`, so a config
 * value can never reach outside the project being initialized (e.g. a stray
 * `../` in an examples glob or cleanup target). Throws on any escape.
 *
 * @param {string} root - Project root (the containment boundary).
 * @param {string} rel  - Untrusted relative (or absolute) path from a config.
 * @return {string} The resolved absolute path, guaranteed within root.
 */
const resolveWithin = ( root, rel ) => {
	const base = path.resolve( root );
	const abs = path.resolve( base, rel );
	if ( abs !== base && ! abs.startsWith( base + path.sep ) ) {
		throw new Error( `Refusing path outside the project root: ${ rel }` );
	}
	return abs;
};

/**
 * File extensions treated as binary and never opened for search-replace.
 */
const BINARY_EXTENSIONS = [
	'.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.avif',
	'.woff', '.woff2', '.ttf', '.otf', '.eot',
	'.map', '.pdf', '.zip', '.gz', '.tar', '.mp4', '.webm', '.mov', '.mp3', '.wav',
];

/**
 * Directory / file names skipped while walking a project for replacement.
 *
 * `bin` is skipped so the per-project scaffold config (which embeds the search
 * tokens verbatim) is never corrupted; `build`/lock files avoid generated noise.
 */
const DEFAULT_IGNORE = [
	'.git',
	'node_modules',
	'vendor',
	'bin',
	'build',
	'package-lock.json',
	'composer.lock',
];

/**
 * PHP reserved keywords that cannot be used as a namespace segment or identifier.
 */
const PHP_RESERVED_WORDS = [
	'abstract', 'and', 'array', 'as', 'bool', 'break', 'callable', 'case', 'catch',
	'class', 'clone', 'const', 'continue', 'declare', 'default', 'do', 'echo', 'else',
	'elseif', 'empty', 'enddeclare', 'endfor', 'endforeach', 'endif', 'endswitch',
	'endwhile', 'enum', 'eval', 'exit', 'extends', 'false', 'final', 'finally', 'float',
	'fn', 'for', 'foreach', 'function', 'global', 'goto', 'if', 'implements', 'include',
	'instanceof', 'insteadof', 'int', 'interface', 'isset', 'iterable', 'list', 'match',
	'mixed', 'namespace', 'never', 'new', 'null', 'object', 'or', 'parent', 'print',
	'private', 'protected', 'public', 'readonly', 'require', 'return', 'self', 'static',
	'string', 'switch', 'throw', 'trait', 'true', 'try', 'unset', 'use', 'var', 'void',
	'while', 'xor', 'yield',
];

/**
 * Recursively collect every file under `dir`, skipping ignored names.
 *
 * @param {string}   dir      - Directory to walk.
 * @param {string[]} [ignore] - Directory / file names to skip.
 * @return {string[]} Absolute file paths.
 */
const collectFiles = ( dir, ignore = DEFAULT_IGNORE ) => {
	let entries;
	try {
		entries = fs.readdirSync( dir, { withFileTypes: true } );
	} catch {
		return [];
	}

	let files = [];
	entries.forEach( ( entry ) => {
		if ( ignore.includes( entry.name ) ) {
			return;
		}
		const full = path.join( dir, entry.name );
		if ( entry.isDirectory() ) {
			files = files.concat( collectFiles( full, ignore ) );
		} else if ( entry.isFile() ) {
			files.push( full );
		}
	} );
	return files;
};

/**
 * Whether a file should be treated as binary (skip content replacement).
 *
 * @param {string} filePath - File path (for the extension check).
 * @param {Buffer} buffer   - File contents.
 * @return {boolean} True if binary.
 */
const isBinary = ( filePath, buffer ) => {
	if ( BINARY_EXTENSIONS.includes( path.extname( filePath ).toLowerCase() ) ) {
		return true;
	}
	return buffer.includes( 0 );
};

/**
 * Escape a literal string for use inside a RegExp.
 *
 * @param {string} value - Literal.
 * @return {string} Escaped.
 */
const escapeRegExp = ( value ) => value.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );

/**
 * Apply every replacement pair to a string in a SINGLE pass.
 *
 * Each source token is matched at most once and substituted text is never
 * re-scanned, so a new token that contains an old one (e.g. renaming `Aryan` to
 * `AryanX`) can't cascade. Pairs are assumed de-duplicated and longest-source-
 * first, so the alternation prefers the most specific token at each position.
 *
 * @param {string}                   text         - Input string.
 * @param {Array<[string, string]>}  replacements - Ordered [ from, to ] pairs.
 * @return {string} Replaced string.
 */
const applyReplacements = ( text, replacements ) => {
	if ( ! replacements.length ) {
		return text;
	}
	const map = new Map( replacements );
	const pattern = replacements.map( ( [ from ] ) => escapeRegExp( from ) ).join( '|' );
	return text.replace( new RegExp( pattern, 'g' ), ( match ) => map.get( match ) );
};

/**
 * Replace token content across files in place.
 *
 * @param {string[]}                 files        - Absolute file paths.
 * @param {Array<[string, string]>}  replacements - Ordered [ from, to ] pairs.
 * @param {Object}                   ui           - `@rtcamp/wp-tooling/ui`.
 * @return {number} Count of files changed.
 */
const replaceInFiles = ( files, replacements, ui ) => {
	let changed = 0;
	files.forEach( ( filePath ) => {
		try {
			const buffer = fs.readFileSync( filePath );
			if ( isBinary( filePath, buffer ) ) {
				return;
			}
			const original = buffer.toString( 'utf8' );
			const updated = applyReplacements( original, replacements );
			if ( updated !== original ) {
				fs.writeFileSync( filePath, updated, 'utf8' );
				changed++;
			}
		} catch ( err ) {
			ui.warn( `Skipped ${ path.basename( filePath ) }: ${ err.message }` );
		}
	} );
	return changed;
};

/**
 * Rename files whose basename contains any token.
 *
 * @param {string[]}                 files        - Absolute file paths.
 * @param {Array<[string, string]>}  replacements - Ordered [ from, to ] pairs.
 * @param {Object}                   ui           - `@rtcamp/wp-tooling/ui`.
 * @return {number} Count of files renamed.
 */
const renameFiles = ( files, replacements, ui ) => {
	let renamed = 0;
	files.forEach( ( filePath ) => {
		const base = path.basename( filePath );
		const newBase = applyReplacements( base, replacements );
		if ( newBase === base ) {
			return;
		}
		try {
			fs.renameSync( filePath, path.join( path.dirname( filePath ), newBase ) );
			ui.info( `${ base } -> ${ newBase }` );
			renamed++;
		} catch ( err ) {
			ui.warn( `Could not rename ${ base }: ${ err.message }` );
		}
	} );
	return renamed;
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
 * @param {string} root                                  - Project root.
 * @param {Array<{path: string, kind: string}>} versionFiles - Targets.
 * @param {string} version                               - Version to apply.
 * @param {Object} ui                                    - `@rtcamp/wp-tooling/ui`.
 * @return {void}
 */
const applyVersion = ( root, versionFiles, version, ui ) => {
	if ( ! version || ! Array.isArray( versionFiles ) ) {
		return;
	}

	versionFiles.forEach( ( spec ) => {
		let filePath;
		try {
			filePath = resolveWithin( root, spec.path );
		} catch ( err ) {
			ui.warn( err.message );
			return;
		}
		if ( ! fs.existsSync( filePath ) ) {
			return;
		}

		try {
			let content = fs.readFileSync( filePath, 'utf8' );

			if ( 'json' === spec.kind ) {
				content = content.replace( /("version"\s*:\s*")[^"]*(")/, `$1${ version }$2` );
			} else {
				// css-header / php-header: first "Version:" line value.
				content = content.replace( /^(\s*\*?\s*Version:\s*).*$/m, `$1${ version }` );
			}

			fs.writeFileSync( filePath, content, 'utf8' );
			ui.info( `version ${ version } -> ${ spec.path }` );
		} catch ( err ) {
			ui.warn( `Could not set version in ${ spec.path }: ${ err.message }` );
		}
	} );
};

module.exports = {
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
