<?php
// Reads a property off a possibly-null WP_Post. Only level 8 reports it, so this
// proves the baseline's level. Do not "fix" it.

declare( strict_types=1 );

function rtcamp_wp_phpstan_fixture_nullable( int $post_id ): string {
	return get_post( $post_id )->post_title;
}
