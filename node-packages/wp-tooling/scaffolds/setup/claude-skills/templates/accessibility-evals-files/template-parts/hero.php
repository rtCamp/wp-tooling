<?php
/**
 * Hero banner template part.
 *
 * @package Acme_Theme
 */

$hero_image = get_theme_mod( 'hero_image', '/wp-content/uploads/2024/hero.jpg' );
?>
<div class="hero-banner">
	<img class="hero-banner__image" src="<?php echo esc_url( $hero_image ); ?>">
</div>
