/**
 * A store of its own with a navigation key: not the router, not flagged.
 */
import { store } from '@wordpress/interactivity';

const { state } = store( 'acme/menu', {
	state: { navigation: { isOpen: false } },
} );

export const isOpen = () => state.navigation.isOpen;
