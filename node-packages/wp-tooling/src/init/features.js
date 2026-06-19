/**
 * Feature kernel -- generic, feature-agnostic toggle mechanics.
 *
 * A feature is declared as DATA in a scaffold config (key/label + optional
 * declarative `apply` of files/deps/scripts + optional `onEnable`/`onDisable`
 * hooks + optional `detect` probe); the engine never names a specific feature.
 *
 * `.wp-scaffold.json.features` ({ key: bool }) is intent, a fresh `detect` sweep
 * is reality. Reality wins for display; the persisted map is rebuilt from a
 * detect sweep only after a successful apply.
 */

'use strict';

const fs = require( 'fs' );
const path = require( 'path' );
const { writeFeatures } = require( './persist' );
const { resolveWithin } = require( './transform' );

/**
 * Validate a config's feature manifest. Throws on first problem so the caller
 * aborts before touching disk.
 *
 * @param {Object} config - Per-project scaffold config.
 * @return {void}
 */
const validateFeatures = ( config ) => {
	const features = config.features || [];
	const keys = new Set();
	const labels = new Set();

	features.forEach( ( feature ) => {
		if ( ! feature.key || ! /^[a-z][a-z0-9-]*$/.test( feature.key ) ) {
			throw new Error( `Feature key must match /^[a-z][a-z0-9-]*$/, got ${ JSON.stringify( feature.key ) }` );
		}
		if ( keys.has( feature.key ) ) {
			throw new Error( `Duplicate feature key: ${ feature.key }` );
		}
		keys.add( feature.key );

		if ( ! feature.label ) {
			throw new Error( `Feature ${ feature.key } is missing a label` );
		}
		if ( labels.has( feature.label ) ) {
			throw new Error( `Duplicate feature label: ${ feature.label }` );
		}
		labels.add( feature.label );

		( ( feature.apply && feature.apply.files ) || [] ).forEach( ( file ) => {
			[ 'from', 'to' ].forEach( ( side ) => {
				const value = file[ side ];
				if ( ! value || path.isAbsolute( value ) || value.split( /[\\/]/ ).includes( '..' ) ) {
					throw new Error( `Feature ${ feature.key }: file.${ side } must be a relative path without "..", got ${ JSON.stringify( value ) }` );
				}
			} );
		} );

		if ( Boolean( feature.onEnable ) !== Boolean( feature.onDisable ) ) {
			throw new Error( `Feature ${ feature.key }: onEnable and onDisable must both be present or both absent` );
		}
	} );
};

/**
 * Detect the indentation used by a JSON file so rewrites preserve its style.
 *
 * @param {string} raw - Raw file text.
 * @return {string} The indent unit (tab or spaces).
 */
const detectIndent = ( raw ) => {
	const match = raw.match( /\n([ \t]+)\S/ );
	return match ? match[ 1 ] : '\t';
};

/**
 * Build the FeatureApi handed to every hook / probe. All mutating calls record
 * an undo entry in `api._journal` so a feature can be rolled back on failure.
 *
 * @param {string} root     - Project root (absolute).
 * @param {Object} identity - Parsed .wp-scaffold.json.
 * @param {Object} ui       - Merged wp-tooling + local style UI.
 * @return {Object} The FeatureApi.
 */
const makeFeatureApi = ( root, identity, ui ) => {
	const journal = [];
	// Confine every api path to the project root so a feature hook can't read or
	// write outside the project being initialized.
	const join = ( rel ) => resolveWithin( root, rel );

	const api = {
		root,
		identity,
		ui,
		_journal: journal,
		path: join,
		exists: ( rel ) => fs.existsSync( join( rel ) ),
		read: ( rel ) => ( fs.existsSync( join( rel ) ) ? fs.readFileSync( join( rel ), 'utf8' ) : null ),

		write( rel, body ) {
			const abs = join( rel );
			const existed = fs.existsSync( abs );
			const old = existed ? fs.readFileSync( abs ) : null;
			journal.push( {
				undo: () => {
					if ( existed ) {
						fs.writeFileSync( abs, old );
					} else {
						fs.rmSync( abs, { force: true } );
					}
				},
			} );
			fs.mkdirSync( path.dirname( abs ), { recursive: true } );
			fs.writeFileSync( abs, body );
		},

		remove( rel ) {
			const abs = join( rel );
			if ( ! fs.existsSync( abs ) ) {
				return;
			}
			// Refuse directories: a buffer snapshot can't restore a tree on rollback.
			if ( fs.statSync( abs ).isDirectory() ) {
				throw new Error( `remove(): refusing to delete directory "${ rel }"; remove files individually so rollback can restore them.` );
			}
			const old = fs.readFileSync( abs );
			journal.push( {
				undo: () => {
					fs.mkdirSync( path.dirname( abs ), { recursive: true } );
					fs.writeFileSync( abs, old );
				},
			} );
			fs.rmSync( abs, { force: true } );
		},

		editPackageJson( mutator ) {
			const abs = join( 'package.json' );
			const raw = fs.readFileSync( abs, 'utf8' );
			const indent = detectIndent( raw );
			const obj = JSON.parse( raw );
			mutator( obj );
			journal.push( { undo: () => fs.writeFileSync( abs, raw, 'utf8' ) } );
			fs.writeFileSync( abs, `${ JSON.stringify( obj, null, indent ) }\n`, 'utf8' );
		},

		hasDep( name ) {
			const abs = join( 'package.json' );
			if ( ! fs.existsSync( abs ) ) {
				return false;
			}
			const pkg = JSON.parse( fs.readFileSync( abs, 'utf8' ) );
			return Boolean( ( pkg.dependencies && pkg.dependencies[ name ] ) || ( pkg.devDependencies && pkg.devDependencies[ name ] ) );
		},

		writeFlag( key, on ) {
			const abs = join( '.wp-features.json' );
			const oldRaw = fs.existsSync( abs ) ? fs.readFileSync( abs, 'utf8' ) : null;
			const flags = null !== oldRaw ? JSON.parse( oldRaw ) : {};
			flags[ key ] = on;
			journal.push( {
				undo: () => {
					if ( null !== oldRaw ) {
						fs.writeFileSync( abs, oldRaw );
					} else {
						fs.rmSync( abs, { force: true } );
					}
				},
			} );
			fs.writeFileSync( abs, `${ JSON.stringify( flags, null, '\t' ) }\n` );
		},

		// Read a single KEY=value from a dotenv-style file. Returns the trimmed,
		// unquoted value, or null when the file or key is absent.
		readEnv( rel, key ) {
			const abs = join( rel );
			if ( ! fs.existsSync( abs ) ) {
				return null;
			}
			const raw = fs.readFileSync( abs, 'utf8' );
			const match = raw.match( new RegExp( `^[ \\t]*${ key }[ \\t]*=[ \\t]*(.*)$`, 'm' ) );
			return match ? match[ 1 ].trim().replace( /^["']|["']$/g, '' ) : null;
		},

		// Set KEY=value in a dotenv-style file: replace the line if present,
		// append it otherwise, creating the file when missing. Journaled.
		setEnv( rel, key, value ) {
			const raw = this.read( rel ) || '';
			const line = `${ key }=${ value }`;
			const re = new RegExp( `^[ \\t]*${ key }[ \\t]*=.*$`, 'm' );
			let next;
			if ( re.test( raw ) ) {
				next = raw.replace( re, line );
			} else if ( '' === raw ) {
				next = `${ line }\n`;
			} else {
				next = raw.endsWith( '\n' ) ? `${ raw }${ line }\n` : `${ raw }\n${ line }\n`;
			}
			this.write( rel, next );
		},

		// Read a `define( 'NAME', true|false )` boolean from a PHP file. Returns
		// the bool, or null when the file or define is absent. The `^[ \t]*`
		// anchor (with the `m` flag) only matches a define that starts a line, so
		// a commented-out `// define( ... )` is ignored.
		readDefine( rel, name ) {
			const abs = join( rel );
			if ( ! fs.existsSync( abs ) ) {
				return null;
			}
			const raw = fs.readFileSync( abs, 'utf8' );
			const match = raw.match( new RegExp( `^[ \\t]*define\\(\\s*['"]${ name }['"]\\s*,\\s*(true|false)\\s*\\)`, 'im' ) );
			return match ? 'true' === match[ 1 ].toLowerCase() : null;
		},

		// Flip an existing `define( 'NAME', true|false )` to the given boolean in
		// a PHP file. Throws when the define is absent (the entry file ships it).
		// Anchored to line start so commented-out defines are left untouched.
		// Journaled.
		setDefine( rel, name, value ) {
			const raw = this.read( rel );
			if ( null === raw ) {
				throw new Error( `setDefine: ${ rel } not found` );
			}
			const re = new RegExp( `(^[ \\t]*define\\(\\s*['"]${ name }['"]\\s*,\\s*)(?:true|false)(\\s*\\))`, 'im' );
			if ( ! re.test( raw ) ) {
				throw new Error( `setDefine: define( '${ name }', ... ) not found in ${ rel }` );
			}
			this.write( rel, raw.replace( re, `$1${ value ? 'true' : 'false' }$2` ) );
		},
	};

	return api;
};

/**
 * Run `fn` inside the api journal; on throw, replay undo entries in reverse to
 * restore exactly what `fn` mutated, then rethrow.
 *
 * @param {Object}   api - FeatureApi.
 * @param {Function} fn  - Synchronous mutation function.
 * @return {void}
 */
const runJournaled = ( api, fn ) => {
	const start = api._journal.length;
	try {
		fn();
		api._journal.length = start;
	} catch ( err ) {
		for ( let i = api._journal.length - 1; i >= start; i-- ) {
			try {
				api._journal[ i ].undo();
			} catch {
				// Best-effort rollback; surface nothing further.
			}
		}
		api._journal.length = start;
		throw err;
	}
};

/**
 * Set-if-absent merge of a feature's declarative deps/scripts into package.json.
 *
 * @param {Object} pkg     - Parsed package.json (mutated).
 * @param {Object} apply   - feature.apply.
 * @param {Object} ui      - UI for conflict warnings.
 * @return {void}
 */
const mergePackage = ( pkg, apply, ui ) => {
	const section = ( name ) => {
		pkg[ name ] = pkg[ name ] || {};
		return pkg[ name ];
	};
	const addDeps = ( target, src ) => {
		Object.entries( src || {} ).forEach( ( [ name, version ] ) => {
			if ( undefined === target[ name ] ) {
				target[ name ] = version;
			}
		} );
	};

	if ( apply.dependencies ) {
		addDeps( section( 'dependencies' ), apply.dependencies );
	}
	if ( apply.devDependencies ) {
		addDeps( section( 'devDependencies' ), apply.devDependencies );
	}
	if ( apply.scripts ) {
		const scripts = section( 'scripts' );
		Object.entries( apply.scripts ).forEach( ( [ name, cmd ] ) => {
			if ( undefined === scripts[ name ] ) {
				scripts[ name ] = cmd;
			} else if ( scripts[ name ] !== cmd && ui ) {
				ui.warn( `Script "${ name }" already exists; keeping the current value.` );
			}
		} );
	}
};

/**
 * Remove a feature's declarative deps/scripts keys from package.json, keeping any
 * key still owned by another feature that remains enabled (no shared-dep removal).
 *
 * @param {Object} pkg       - Parsed package.json (mutated).
 * @param {Object} apply     - feature.apply.
 * @param {Array}  survivors - Features that stay enabled after this transition.
 * @return {void}
 */
const unmergePackage = ( pkg, apply, survivors = [] ) => {
	const ownedDeps = new Set();
	const ownedScripts = new Set();
	survivors.forEach( ( feature ) => {
		const a = feature.apply || {};
		Object.keys( a.dependencies || {} ).forEach( ( name ) => ownedDeps.add( name ) );
		Object.keys( a.devDependencies || {} ).forEach( ( name ) => ownedDeps.add( name ) );
		Object.keys( a.scripts || {} ).forEach( ( name ) => ownedScripts.add( name ) );
	} );

	const del = ( target, src, owned ) => {
		if ( ! target ) {
			return;
		}
		Object.keys( src || {} ).forEach( ( name ) => {
			if ( ! owned.has( name ) ) {
				delete target[ name ];
			}
		} );
	};
	del( pkg.dependencies, apply.dependencies, ownedDeps );
	del( pkg.devDependencies, apply.devDependencies, ownedDeps );
	del( pkg.scripts, apply.scripts, ownedScripts );
};

/**
 * Whether a feature looks installed on disk.
 *
 * @param {Object} feature - Feature definition.
 * @param {Object} api     - FeatureApi.
 * @return {boolean} True if detected.
 */
const detectFeature = ( feature, api ) => {
	if ( feature.detect ) {
		return Boolean( feature.detect( api ) );
	}
	const apply = feature.apply || {};
	const files = apply.files || [];
	const deps = [
		...Object.keys( apply.dependencies || {} ),
		...Object.keys( apply.devDependencies || {} ),
	];
	if ( 0 === files.length && 0 === deps.length ) {
		return false;
	}
	return files.every( ( file ) => api.exists( file.to ) ) && deps.every( ( dep ) => api.hasDep( dep ) );
};

/**
 * Enable a feature: declarative files + deps + scripts, then onEnable.
 * Journaled, so a throw mid-way rolls back this feature only.
 *
 * @param {Object} feature     - Feature definition.
 * @param {Object} api         - FeatureApi.
 * @param {string} featuresDir - Project-relative dir holding feature assets.
 * @return {void}
 */
const enableFeature = ( feature, api, featuresDir ) => {
	runJournaled( api, () => {
		const apply = feature.apply || {};

		( apply.files || [] ).forEach( ( file ) => {
			const srcAbs = resolveWithin( path.join( api.root, featuresDir ), file.from );
			const body = fs.readFileSync( srcAbs );
			const dstAbs = api.path( file.to );
			// Skip if identical, preserving any user edits to a feature-owned file.
			if ( fs.existsSync( dstAbs ) && fs.readFileSync( dstAbs ).equals( body ) ) {
				return;
			}
			api.write( file.to, body );
		} );

		if ( apply.dependencies || apply.devDependencies || apply.scripts ) {
			api.editPackageJson( ( pkg ) => mergePackage( pkg, apply, api.ui ) );
		}

		if ( feature.onEnable ) {
			feature.onEnable( api );
		}
	} );
};

/**
 * Disable a feature: onDisable, then revert declarative files + deps + scripts.
 * Journaled.
 *
 * @param {Object} feature   - Feature definition.
 * @param {Object} api       - FeatureApi.
 * @param {Array}  survivors - Features that remain enabled (shared keys are kept).
 * @return {void}
 */
const disableFeature = ( feature, api, survivors = [] ) => {
	runJournaled( api, () => {
		if ( feature.onDisable ) {
			feature.onDisable( api );
		}
		const apply = feature.apply || {};
		( apply.files || [] ).forEach( ( file ) => api.remove( file.to ) );
		if ( apply.dependencies || apply.devDependencies || apply.scripts ) {
			api.editPackageJson( ( pkg ) => unmergePackage( pkg, apply, survivors ) );
		}
	} );
};

/**
 * Reconcile persisted intent against detected reality.
 *
 * @param {Object} config    - Per-project scaffold config.
 * @param {Object} persisted - Persisted features map ({ key: bool }).
 * @param {Object} api       - FeatureApi.
 * @return {{rows: Array, unknown: string[]}} Rows + retired keys.
 */
const reconcile = ( config, persisted, api ) => {
	const features = config.features || [];
	const map = persisted || {};

	const rows = features.map( ( feature ) => {
		const detected = detectFeature( feature, api );
		const intent = Boolean( map[ feature.key ] );
		return {
			key: feature.key,
			label: feature.label,
			description: feature.description || '',
			on: detected,
			intent,
			drift: detected !== intent,
			feature,
		};
	} );

	const known = new Set( features.map( ( feature ) => feature.key ) );
	const unknown = Object.keys( map ).filter( ( key ) => ! known.has( key ) );

	return { rows, unknown };
};

/**
 * Compute which features must be enabled / disabled to reach `wantOn`.
 *
 * @param {Array}       rows   - Reconciled rows.
 * @param {Set<string>} wantOn - Desired ENABLED key set.
 * @return {{toEnable: Array, toDisable: Array}} Transition lists.
 */
const computeDiff = ( rows, wantOn ) => ( {
	toEnable: rows.filter( ( row ) => ! row.on && wantOn.has( row.key ) ),
	toDisable: rows.filter( ( row ) => row.on && ! wantOn.has( row.key ) ),
} );

/**
 * Fresh detected map across every declared feature ({ key: bool }).
 *
 * @param {Object} config - Per-project scaffold config.
 * @param {Object} api    - FeatureApi.
 * @return {Object} Detected features map.
 */
const detectMap = ( config, api ) => {
	const map = {};
	( config.features || [] ).forEach( ( feature ) => {
		map[ feature.key ] = detectFeature( feature, api );
	} );
	return map;
};

/**
 * Whether a feature touches package.json (so we know to suggest npm install).
 *
 * @param {Object} feature - Feature definition.
 * @return {boolean} True if it has deps/scripts.
 */
const touchesPackage = ( feature ) => {
	const apply = feature.apply || {};
	return Boolean( apply.dependencies || apply.devDependencies || apply.scripts );
};

/**
 * Drive one enable/disable transition to reach the desired enabled set, then
 * (manage mode) persist the post-apply detected map. Shared by the scaffold
 * flow's initial feature pick and manage-mode toggling.
 *
 * @param {Object} config - Per-project scaffold config.
 * @param {string} root   - Project root.
 * @param {Object} opts   - { mode, wantOn?, flags, api, ui, rows?, unknown? }.
 * @return {Promise<{changed: boolean, failed: string[], finalMap: Object}>}
 */
const toggleFeatures = async ( config, root, opts ) => {
	const { mode, api, ui } = opts;
	const flags = opts.flags || {};
	let { wantOn, rows, unknown } = opts;

	if ( ! rows ) {
		const r = reconcile( config, ( api.identity && api.identity.features ) || {}, api );
		rows = r.rows;
		unknown = r.unknown;
	}

	// Every exit goes through finalize: in manage mode it rewrites the persisted
	// map from a fresh detect sweep, so intent trails disk and drift self-heals.
	const finalize = ( changed, failed ) => {
		const finalMap = detectMap( config, api );
		if ( 'manage' === mode ) {
			writeFeatures( root, finalMap, ui );
		}
		if ( failed && failed.length ) {
			process.exitCode = 1;
			ui.warn( `Some features failed: ${ failed.join( ', ' ) }. Re-run init to retry.` );
		}
		return { changed, failed: failed || [], finalMap };
	};

	// Surface drift + retired features.
	rows.filter( ( r ) => r.drift ).forEach( ( r ) =>
		ui.warn( `${ r.key }: recorded ${ r.intent ? 'enabled' : 'disabled' } but disk says ${ r.on ? 'enabled' : 'disabled' }; using disk state.` )
	);
	( unknown || [] ).forEach( ( key ) => ui.warn( `${ key }: retired feature still recorded; leaving untouched.` ) );

	// Interactive: flip features from their current state via a radio menu (the
	// kit's checkbox can't pre-select), then pick Apply. Picking Apply confirms,
	// so the extra confirm below is skipped.
	let confirmedInteractively = false;
	if ( ! wantOn ) {
		if ( ! rows.length ) {
			ui.info( 'No optional features are declared.' );
			return finalize( false, [] );
		}

		wantOn = new Set( rows.filter( ( r ) => r.on ).map( ( r ) => r.key ) );

		for ( ;; ) {
			ui.table(
				rows.map( ( r ) => [ r.label, `${ wantOn.has( r.key ) ? 'enabled' : 'disabled' }${ r.drift ? '  (drift)' : '' }` ] ),
				{ title: 'Optional features' }
			);
			const choiceFor = ( r ) => `${ wantOn.has( r.key ) ? '[x]' : '[ ]' } ${ r.label }`;
			const byChoice = new Map( rows.map( ( r ) => [ choiceFor( r ), r ] ) );
			const choice = await ui.radio( {
				message: 'Toggle a feature, or apply',
				choices: [ ...rows.map( choiceFor ), 'Apply changes', 'Cancel' ],
			} );

			if ( 'Cancel' === choice ) {
				ui.warn( 'No changes applied.' );
				return finalize( false, [] );
			}
			if ( 'Apply changes' === choice ) {
				break;
			}
			const row = byChoice.get( choice );
			if ( row ) {
				if ( wantOn.has( row.key ) ) {
					wantOn.delete( row.key );
				} else {
					wantOn.add( row.key );
				}
			}
		}
		confirmedInteractively = true;
	}

	const { toEnable, toDisable } = computeDiff( rows, wantOn );
	if ( ! toEnable.length && ! toDisable.length ) {
		ui.success( 'Already up to date.' );
		return finalize( false, [] );
	}

	ui.heading( 'Planned changes' );
	toEnable.forEach( ( r ) => ui.success( `+ enable  ${ r.label }` ) );
	toDisable.forEach( ( r ) => ui.warn( `- disable ${ r.label }` ) );

	if ( ! flags.yes && ! confirmedInteractively ) {
		const ok = await ui.confirm( { message: 'Apply these changes?', defaultValue: true } );
		if ( ! ok ) {
			ui.warn( 'No changes applied.' );
			return finalize( false, [] );
		}
	}

	const featuresDir = config.featuresDir || 'bin/features';
	const survivors = ( config.features || [] ).filter( ( f ) => wantOn.has( f.key ) );
	const failed = [];
	let depsChanged = false;

	// Disable before enable: frees files/deps before any re-add.
	toDisable.forEach( ( r ) => {
		const spin = ui.spinner( `Disabling ${ r.label }...` );
		spin.start();
		try {
			disableFeature( r.feature, api, survivors );
			spin.succeed( `Disabled ${ r.label }` );
			depsChanged = depsChanged || touchesPackage( r.feature );
		} catch ( err ) {
			spin.fail( `Failed to disable ${ r.label }` );
			ui.error( err.message );
			failed.push( r.key );
		}
	} );
	toEnable.forEach( ( r ) => {
		const spin = ui.spinner( `Enabling ${ r.label }...` );
		spin.start();
		try {
			enableFeature( r.feature, api, featuresDir );
			spin.succeed( `Enabled ${ r.label }` );
			depsChanged = depsChanged || touchesPackage( r.feature );
		} catch ( err ) {
			spin.fail( `Failed to enable ${ r.label }` );
			ui.error( err.message );
			failed.push( r.key );
		}
	} );

	if ( depsChanged ) {
		ui.warn( 'Dependencies changed -- run `npm install` to sync.' );
	}
	if ( ! failed.length ) {
		ui.success( 'Features updated.' );
	}

	return finalize( true, failed );
};

module.exports = {
	validateFeatures,
	makeFeatureApi,
	detectFeature,
	enableFeature,
	disableFeature,
	reconcile,
	computeDiff,
	detectMap,
	toggleFeatures,
};
