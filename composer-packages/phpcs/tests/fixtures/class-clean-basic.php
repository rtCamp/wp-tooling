<?php
/**
 * Clean fixture for the RTCampWP-Basic standard.
 *
 * @package RTCampWP\Tests
 */

namespace RTCampWP\Tests\Fixtures;

/**
 * Sample class that passes RTCampWP-Basic with no violations.
 */
class Clean_Basic {

	/**
	 * Greeting prefix.
	 *
	 * @var string
	 */
	private $prefix = 'Hello, ';

	/**
	 * Build a greeting for the given name.
	 *
	 * @param string $name Name to greet.
	 * @return string The greeting.
	 */
	public function greet( $name ) {
		return $this->prefix . $name;
	}
}
