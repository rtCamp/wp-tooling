export function Menu( { id }: { id: string } ) {
	return (
		<nav
			data-wp-interactive="acme/menu"
			data-wp-on-document--keydown--escape="actions.close"
			data-wp-bind--hidden={ '!acme/menu::actions.isOpen' }
			{ ...{ [ `data-wp-watch--${ id }` ]: 'callbacks.sync' } }
		/>
	);
}
