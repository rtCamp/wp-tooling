<?php

declare(strict_types=1);

namespace rtCamp\WPPhpstan\Tests;

use PHPUnit\Framework\TestCase;

/**
 * Exercises the shipped baseline the way a consumer does: a project that includes
 * ONLY vendor/rtcamp/wp-phpstan/phpstan.neon.dist must still get the WordPress
 * stubs, because the baseline pulls them in itself. The test recreates that
 * vendor/ layout in a temp dir so the baseline's relative ../../szepeviktor
 * include resolves exactly as it would after a real Composer install.
 */
final class ConfigTest extends TestCase
{
    private const PACKAGE_ROOT = __DIR__ . '/..';
    private const LINKED_DEPS = ['szepeviktor', 'php-stubs'];

    private string $project = '';

    protected function setUp(): void
    {
        $required = [$this->baseline(), $this->phpstanBinary()];
        foreach (self::LINKED_DEPS as $dep) {
            $required[] = self::PACKAGE_ROOT . '/vendor/' . $dep;
        }

        foreach ($required as $path) {
            if (! file_exists($path)) {
                self::markTestSkipped(
                    sprintf('Required path missing: %s. Run `composer install` in the package first.', $path)
                );
            }
        }

        $this->project = $this->makeConsumerProject();
    }

    protected function tearDown(): void
    {
        if ($this->project !== '') {
            $this->removeConsumerProject($this->project);
            $this->project = '';
        }
    }

    public function test_baseline_passes_on_clean_wordpress_code(): void
    {
        [$exitCode, $output] = $this->analyse(__DIR__ . '/fixtures/clean.php');

        self::assertSame(0, $exitCode, "Expected the clean fixture to pass. PHPStan output:\n" . $output);
    }

    public function test_baseline_catches_a_type_error(): void
    {
        [$exitCode, $output] = $this->analyse(__DIR__ . '/fixtures/dirty.php');

        self::assertNotSame(0, $exitCode, "Expected the dirty fixture to fail analysis. PHPStan output:\n" . $output);
        self::assertStringContainsString('should return int but returns string', $output);
    }

    private function makeConsumerProject(): string
    {
        $project = tempnam(sys_get_temp_dir(), 'wp-phpstan-consumer-');
        self::assertNotFalse($project, 'Could not create a temp file for the consumer project.');

        // Turn the temp file into a project directory. Assert each step so a
        // setup failure reports clearly instead of as a stray warning (the
        // suite runs with failOnWarning=true).
        self::assertTrue(unlink($project), "Could not remove temp file: {$project}");
        self::assertTrue(
            mkdir($project . '/vendor/rtcamp/wp-phpstan', 0o777, true),
            "Could not create the temp consumer project dir: {$project}"
        );
        self::assertTrue(
            copy($this->baseline(), $project . '/vendor/rtcamp/wp-phpstan/phpstan.neon.dist'),
            'Could not copy phpstan.neon.dist into the temp consumer project.'
        );

        foreach (self::LINKED_DEPS as $dep) {
            $linked = @symlink($this->realPath(self::PACKAGE_ROOT . '/vendor/' . $dep), $project . '/vendor/' . $dep);
            if (! $linked) {
                $this->removeConsumerProject($project);
                self::markTestSkipped("Could not symlink the {$dep} install into the temp consumer project.");
            }
        }

        return $project;
    }

    private function removeConsumerProject(string $project): void
    {
        // Drop symlinks first so the recursive delete never descends into the
        // real (shared) installs they point at.
        foreach (glob($project . '/vendor/*') ?: [] as $entry) {
            if (is_link($entry)) {
                unlink($entry);
            }
        }

        $items = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($project, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::CHILD_FIRST
        );
        foreach ($items as $item) {
            if ($item->isDir() && ! $item->isLink()) {
                rmdir($item->getPathname());
            } else {
                unlink($item->getPathname());
            }
        }
        rmdir($project);
    }

    /**
     * @return array{0: int, 1: string} Exit code and combined stdout/stderr.
     */
    private function analyse(string $targetFile): array
    {
        $neon = $this->project . '/phpstan.neon';
        file_put_contents(
            $neon,
            sprintf(
                "includes:\n    - vendor/rtcamp/wp-phpstan/phpstan.neon.dist\nparameters:\n    paths:\n        - %s\n",
                $this->realPath($targetFile)
            )
        );

        // WordPress stubs are large; raise the limit above PHP's 128M default so
        // analysis completes instead of crashing the worker.
        $command = sprintf(
            '%s %s analyse --no-progress --no-ansi --error-format=raw --memory-limit=1G --configuration=%s 2>&1',
            escapeshellarg(PHP_BINARY),
            escapeshellarg($this->phpstanBinary()),
            escapeshellarg($neon)
        );

        exec($command, $lines, $exitCode);

        return [$exitCode, implode("\n", $lines)];
    }

    private function realPath(string $path): string
    {
        $real = realpath($path);
        self::assertNotFalse($real, "Could not resolve a real path for: {$path}");

        return $real;
    }

    private function baseline(): string
    {
        return self::PACKAGE_ROOT . '/phpstan.neon.dist';
    }

    private function phpstanBinary(): string
    {
        return self::PACKAGE_ROOT . '/vendor/bin/phpstan';
    }
}
