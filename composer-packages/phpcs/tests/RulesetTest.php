<?php

declare(strict_types=1);

namespace rtCamp\WPPhpcs\Tests;

use PHPUnit\Framework\TestCase;

/**
 * Smoke tests for the rtCampWP and rtCampWP-Basic standards.
 *
 * These shell out to the phpcs binary rather than the sniff API, so they
 * exercise the standards exactly as a consumer would and stay decoupled from
 * PHPCS internals.
 */
final class RulesetTest extends TestCase
{
	/** Package root — the directory that holds rtCampWP/ and rtCampWP-Basic/. */
	private static function packageDir(): string
	{
		return dirname(__DIR__);
	}

	/** Resolve the phpcs binary: monorepo root vendor, or the package's own. */
	private static function phpcsBin(): string
	{
		$candidates = [
			self::packageDir() . '/../../vendor/bin/phpcs', // monorepo root
			self::packageDir() . '/vendor/bin/phpcs',       // standalone split repo
		];

		foreach ($candidates as $bin) {
			if (is_file($bin)) {
				return $bin;
			}
		}

		self::markTestSkipped('phpcs binary not found; run `composer install` first.');
	}

	/**
	 * The installer-configured installed_paths (for the external standards) with
	 * this package's directory appended, so rtCampWP / rtCampWP-Basic resolve too.
	 *
	 * In a real consumer the Composer installer registers this package
	 * automatically; in the monorepo it is `replace`d, so we add it here.
	 */
	private static function installedPaths(): string
	{
		$paths  = [];
		$show   = shell_exec(escapeshellarg(self::phpcsBin()) . ' --config-show 2>/dev/null');

		if (is_string($show) && preg_match('/installed_paths:\s*(.+)/', $show, $matches)) {
			$paths[] = trim($matches[1]);
		}

		$paths[] = self::packageDir();

		return implode(',', array_filter($paths));
	}

	/**
	 * Run phpcs with the given arguments.
	 *
	 * @param array<int, string> $args
	 * @return array{0: int, 1: string} Exit code and combined output.
	 */
	private static function runPhpcs(array $args): array
	{
		$cmd = escapeshellarg(self::phpcsBin())
			. ' --runtime-set installed_paths ' . escapeshellarg(self::installedPaths())
			// The shared standard leaves testVersion to the consumer; supply it here
			// (as a consumer would) so PHPCompatibilityWP does not abort.
			. ' --runtime-set testVersion 8.2-'
			// Show sniff codes (-s) and keep them on one line so assertions are not
			// defeated by wrapping.
			. ' -s --report-width=200'
			. ' ' . implode(' ', array_map('escapeshellarg', $args))
			. ' 2>&1';

		exec($cmd, $lines, $code);

		return [$code, implode("\n", $lines)];
	}

	public function test_both_standards_are_registered(): void
	{
		[, $output] = self::runPhpcs(['-i']);

		$this->assertStringContainsString('rtCampWP-Basic', $output);
		$this->assertStringContainsString('rtCampWP', $output);
	}

	public function test_clean_fixture_passes_basic(): void
	{
		[$code, $output] = self::runPhpcs([
			'--standard=rtCampWP-Basic',
			self::packageDir() . '/tests/fixtures/class-clean-basic.php',
		]);

		$this->assertSame(0, $code, "Expected the clean fixture to pass rtCampWP-Basic:\n" . $output);
	}

	public function test_violations_fixture_trips_full_strict(): void
	{
		[$code, $output] = self::runPhpcs([
			'--standard=rtCampWP',
			self::packageDir() . '/tests/fixtures/violations.php',
		]);

		$this->assertNotSame(0, $code, 'Expected the violations fixture to fail rtCampWP.');
		$this->assertStringContainsString('DeclareStrictTypes', $output);
		$this->assertStringContainsString('MissingAnyTypeHint', $output);
		$this->assertStringContainsString('DisallowLongArraySyntax', $output);
	}
}
