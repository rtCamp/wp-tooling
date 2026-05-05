/**
 * Well-known error types for the TTY UI kit.
 */
'use strict';

/**
 * Thrown when the user cancels an interactive prompt with Ctrl+C.
 * Callers should catch this and decide whether to exit and with what code.
 */
class CancelledError extends Error {
	constructor() {
		super( 'Prompt cancelled by user.' );
		this.name = 'CancelledError';
	}
}

module.exports = { CancelledError };
