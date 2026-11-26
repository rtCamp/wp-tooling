/**
 * Legacy store: reads the router's deprecated navigation state.
 */
import { store } from '@wordpress/interactivity';

const { state } = store( 'core/router' );

store( 'acme/legacy', {
	callbacks: {
		isLoading() {
			return state.navigation.hasStarted && ! state.navigation.hasFinished;
		},
	},
} );
