<?php
/**
 * Server-side XHProf profile of a front-end render path, for `wp eval-file`.
 *
 * Usage:
 *     npm run profile:server -- [<path>] [<top>]
 *     # or directly:
 *     wp eval-file server-profile.php [<path>] [<top>] [--url=<host>]
 *
 * Profiles the WordPress render path for <path> (default "/") with
 * rtCamp\WPDevTools\Support\XHProfProfiler and prints the top-<top>
 * (default 15) functions by wall time as JSON: { "fn": {ct,wt,cpu,mu,pmu} }.
 * Prints [] when no xhprof/tideways_xhprof backend is loaded, or when
 * rtcamp/wp-dev-tools is not installed (`composer require --dev
 * rtcamp/wp-dev-tools`). A route diagnostic goes to STDERR so a
 * mis-resolved path — or a missing profiler — is visible next to the data.
 * A CLI render approximates but does not equal a web-server request
 * (routing/superglobals and opcache warmth differ).
 *
 * Hardening: redirect_canonical() ends the request with exit(), and exit()
 * bypasses finally — so canonical redirects are unhooked up front, profiling
 * uses start()/stop() rather than profile(), and a shutdown handler drains
 * the output buffer and emits the JSON if some other exit() still terminates
 * the render early.
 *
 * NOTE: no declare(strict_types) here — `wp eval-file` runs the file through
 * eval(), where a declare() is no longer the first statement of the script.
 */

if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) {
	exit( 'Run via: wp eval-file server-profile.php [<path>] [<top>]' . PHP_EOL );
}

$server_profile_path    = isset( $args[0] ) ? (string) $args[0] : '/';
$server_profile_top     = isset( $args[1] ) ? max( 1, (int) $args[1] ) : 15;
$server_profile_backend = function_exists( 'xhprof_enable' )
	? 'xhprof'
	: ( function_exists( 'tideways_xhprof_enable' ) ? 'tideways' : 'none' );

if ( ! class_exists( \rtCamp\WPDevTools\Support\XHProfProfiler::class ) ) {
	echo wp_json_encode( array() ) . PHP_EOL;
	fwrite(
		STDERR,
		sprintf(
			'[server-profile] path=%s backend=%s profiler=missing — install rtcamp/wp-dev-tools (composer require --dev rtcamp/wp-dev-tools)%s',
			$server_profile_path,
			$server_profile_backend,
			PHP_EOL
		)
	);
	exit( 0 );
}

$server_profile_profiler = new \rtCamp\WPDevTools\Support\XHProfProfiler();

// A canonical redirect would exit() before stop() runs or the JSON is echoed.
remove_action( 'template_redirect', 'redirect_canonical' );

// Fallback emitter: if the render exit()s anyway, still stop the session and print
// JSON. Open buffers are discarded first — shutdown output would otherwise flush
// behind them and partial render HTML would corrupt the JSON on stdout.
register_shutdown_function(
	static function () use ( $server_profile_profiler, $server_profile_top ): void {
		if ( ! $server_profile_profiler->is_running() ) {
			return;
		}

		while ( ob_get_level() > 0 ) {
			ob_end_clean();
		}

		echo wp_json_encode( $server_profile_profiler->stop( $server_profile_top, 'server-profile' ) ) . PHP_EOL;
	}
);

// Simulate the front-end request inside this CLI process. Query-string args must land
// in $_GET too: WP::parse_request() reads query vars from $_GET, not REQUEST_URI —
// without this, "/?p=123"-style paths silently profile the homepage.
$_SERVER['REQUEST_URI'] = $server_profile_path;
parse_str( (string) wp_parse_url( $server_profile_path, PHP_URL_QUERY ), $_GET );
$_REQUEST = array_merge( $_REQUEST, $_GET );

$server_profile_profiler->start();

// wp()/template-loader.php may open their own nested buffers; unwind to
// the level recorded here rather than assuming only one was opened.
$server_profile_ob_level = ob_get_level();
ob_start();
wp();
if ( ! defined( 'WP_USE_THEMES' ) ) {
	define( 'WP_USE_THEMES', true );
}
require ABSPATH . WPINC . '/template-loader.php';
while ( ob_get_level() > $server_profile_ob_level ) {
	ob_end_clean();
}

echo wp_json_encode( $server_profile_profiler->stop( $server_profile_top, 'server-profile' ) ) . PHP_EOL;

// Route diagnostic (STDERR): makes a silently mis-routed path -- or a missing
// profiling backend -- visible next to the JSON.
$server_profile_query = $GLOBALS['wp_query'];

$server_profile_route_type = static function ( \WP_Query $query ): string {
	if ( $query->is_singular() ) {
		return $query->is_page() ? 'page' : 'singular';
	}
	if ( $query->is_home() ) {
		return 'home';
	}
	if ( $query->is_archive() ) {
		return 'archive';
	}
	if ( $query->is_404() ) {
		return '404';
	}
	return 'other';
};

fwrite(
	STDERR,
	sprintf(
		'[server-profile] path=%s backend=%s resolved=%s object_id=%d%s',
		$server_profile_path,
		$server_profile_backend,
		$server_profile_route_type( $server_profile_query ),
		(int) get_queried_object_id(),
		PHP_EOL
	)
);
