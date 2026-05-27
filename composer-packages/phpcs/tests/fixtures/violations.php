<?php

// Deliberately non-compliant fixture: trips rtCampWP's strict layer.
// Missing declare(strict_types=1), untyped parameter, no return type, and
// long array syntax — exercises DeclareStrictTypes, MissingAnyTypeHint and
// DisallowLongArraySyntax, among other sniffs.

function example_function( $value ) {
	$data = array( 1, 2, 3 );
	return $data[ $value ];
}
