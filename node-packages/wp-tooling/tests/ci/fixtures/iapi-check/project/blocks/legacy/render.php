<?php
/**
 * Legacy markup: every directive below breaks in WordPress 7.2.
 */
$unique = wp_unique_id( 'p-' );
?>
<div
	data-wp-interactive="acme/legacy"
	data-wp-ignore
	data-wp-watch--logger="callbacks.log"
	data-wp-init--setup="callbacks.setup"
	data-wp-run--effect="callbacks.effect"
	data-wp-on--click--plugin-a="actions.track"
	data-wp-bind--hidden="!actions.isOpen"
	data-wp-class--active="acme/legacy::!callbacks.isActive"
>
	<button <?php echo 'data-wp-on--click--' . esc_attr( $unique ); ?>="actions.toggle"></button>
</div>
