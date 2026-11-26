<?php
/**
 * Title: Hero
 * Slug: acme/hero
 */

$attributes = array(
	'data-wp-interactive'  => 'acme/hero',
	'data-wp-watch--hero'  => 'callbacks.sync',
	'data-wp-bind--hidden' => '!callbacks.isHidden',
);
$processor->set_attribute( sprintf( 'data-wp-init--%s', $slug ), 'callbacks.init' );
