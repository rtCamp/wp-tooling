<?php
// Correctly typed code that calls a WP function: must pass, and proves the
// WordPress stubs load.

declare( strict_types=1 );

function rtcamp_wp_phpstan_fixture_clean( int $post_id ): string {
	return get_the_title( $post_id );
}
