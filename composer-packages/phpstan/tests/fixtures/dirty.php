<?php
// Deliberate type error the baseline must catch. Do not "fix" it.

declare( strict_types=1 );

function rtcamp_wp_phpstan_fixture_dirty(): int {
	return 'definitely not an int';
}
