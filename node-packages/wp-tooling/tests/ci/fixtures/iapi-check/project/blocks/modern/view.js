/**
 * Current store: reads the router's public state.navigating. The deprecated
 * state.navigation and data-wp-watch--id syntax are only mentioned in comments.
 */
// Was: data-wp-on--click--track and !actions.isOpen.
import { store } from '@wordpress/interactivity';

const { state: router } = store( 'core/router' );

const { state } = store( 'acme/modern', {
	state: {
		get isLoading() {
			return router.navigating;
		},
	},
} );

export const menu = state.navigationMenu;
