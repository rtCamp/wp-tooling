<?php
// Declares a typed class constant, which needs PHP 8.3. The baseline's 8.2 floor
// must reject it, even when PHPStan itself runs on 8.3 or later. Do not "fix" it.

declare( strict_types=1 );

final class Rtcamp_Wp_Phpstan_Fixture_Typed_Constant {
	public const string NAME = 'fixture';
}
