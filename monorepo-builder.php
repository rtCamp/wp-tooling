<?php

declare(strict_types=1);

use Symplify\MonorepoBuilder\Config\MBConfig;
use Symplify\MonorepoBuilder\Release\ReleaseWorker\AddTagToChangelogReleaseWorker;
use Symplify\MonorepoBuilder\Release\ReleaseWorker\PushNextDevReleaseWorker;
use Symplify\MonorepoBuilder\Release\ReleaseWorker\PushTagReleaseWorker;
use Symplify\MonorepoBuilder\Release\ReleaseWorker\SetCurrentMutualDependenciesReleaseWorker;
use Symplify\MonorepoBuilder\Release\ReleaseWorker\SetNextMutualDependenciesReleaseWorker;
use Symplify\MonorepoBuilder\Release\ReleaseWorker\TagVersionReleaseWorker;
use Symplify\MonorepoBuilder\Release\ReleaseWorker\UpdateBranchAliasReleaseWorker;
use Symplify\MonorepoBuilder\Release\ReleaseWorker\UpdateReplaceReleaseWorker;

return static function (MBConfig $mbConfig): void {
    // Composer packages live under composer-packages/ (kept separate from the
    // npm workspaces under node-packages/ so each ecosystem has its own root).
    $mbConfig->packageDirectories([__DIR__ . '/composer-packages']);

    $mbConfig->packageAliasFormat('<major>.<minor>-dev');

    // Shared dev tooling merged into the root composer.json on `merge`.
    //
    // phpunit is ^12 (matching the rtCamp plugin-test scaffold), not WP-core's
    // ^9.6: these are phpcs/phpstan *config standards* — they never bootstrap
    // the WordPress test library, so they are not bound to WP-core's phpunit
    // pin. ^9.6 pins sebastian/diff ^4, which conflicts with monorepo-builder
    // 12.7's sebastian/diff ^6|^7|^8; ^12 needs sebastian/diff ^7, satisfying
    // both. (The PHP floor is already >=8.4 here anyway, since monorepo-builder
    // 12.7 resolves to Symfony 8.)
    $mbConfig->dataToAppend([
        'require-dev' => [
            'phpunit/phpunit' => '^12.0',
            'phpstan/phpstan' => '^2.0',
            'szepeviktor/phpstan-wordpress' => '^2.0',
            'squizlabs/php_codesniffer' => '^3.10',
        ],
    ]);

    // Lockstep release pipeline. Tags are pushed here; the actual subtree
    // split to satellite repos is driven by .github/workflows/release-php.yml
    // (which calls the reusable workflow in rtCamp/wp-shared-workflow).
    $mbConfig->workers([
        // Pin every package to depend on the same version of its siblings.
        SetCurrentMutualDependenciesReleaseWorker::class,

        // Refresh the "replace" section in the root composer.json.
        UpdateReplaceReleaseWorker::class,

        // Add a changelog entry for the new tag (if a CHANGELOG is maintained).
        AddTagToChangelogReleaseWorker::class,

        // Create the git tag locally.
        TagVersionReleaseWorker::class,

        // Push the tag — this is what triggers the split workflow.
        PushTagReleaseWorker::class,

        // Bump mutual dependencies to the next dev version (e.g. ^1.1@dev).
        SetNextMutualDependenciesReleaseWorker::class,

        // Update the branch alias.
        UpdateBranchAliasReleaseWorker::class,

        // Push the dev-bump commit.
        PushNextDevReleaseWorker::class,
    ]);
};
