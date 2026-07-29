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
    // INTENTIONAL VERSION SKEW between root and packages — `monorepo-builder
    // validate` will flag this and `merge` will refuse to run. That is by
    // design; see the explanation block below. Treat validate as informational,
    // not a blocking CI step.
    //
    //   Audience               php           phpunit
    //   ---------------------- ------------- -------
    //   composer-packages/*    >=8.2         ^11.5    (consumer floor — rtCamp policy)
    //   root + this file       >=8.4.1       ^12.0    (contributor floor — symfony 8)
    //
    // Why root is forced higher: `symplify/monorepo-builder ^12.7` resolves
    // symfony 8 transitively, which requires PHP >=8.4.1. phpunit ^12 (which
    // also requires PHP >=8.3) is therefore fine at the root and gives us the
    // latest test tooling for monorepo contributors.
    //
    // Why packages stay lower: `rtcamp/wp-phpcs` and `rtcamp/wp-phpstan` are
    // consumed by rtCamp plugin/theme projects whose floor is PHP 8.2. Pinning
    // those packages to phpunit ^11.5 keeps their standalone test suites
    // installable on PHP 8.2 after subtree split.
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
    // (which calls the reusable workflow in rtCamp/wp-shared-workflows).
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
