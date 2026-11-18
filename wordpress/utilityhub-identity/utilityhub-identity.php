<?php
/**
 * Plugin Name: UtilityHub Identity
 * Description: Issues short-lived signed identity tokens for the UtilityHub service.
 * Version: 1.0.0
 * Requires at least: 6.4
 * Requires PHP: 8.1
 */

if (!defined('ABSPATH')) {
    exit;
}

function utilityhub_identity_base64url($value)
{
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

function utilityhub_identity_secret()
{
    return defined('UTILITYHUB_IDENTITY_SECRET')
        ? (string) UTILITYHUB_IDENTITY_SECRET
        : '';
}

function utilityhub_identity_audience()
{
    return defined('UTILITYHUB_IDENTITY_AUDIENCE')
        ? (string) UTILITYHUB_IDENTITY_AUDIENCE
        : 'utilityhub';
}

function utilityhub_identity_token()
{
    $secret = utilityhub_identity_secret();
    if (strlen($secret) < 32) {
        return new WP_Error(
            'utilityhub_identity_not_configured',
            'UtilityHub identity is not configured.',
            array('status' => 503)
        );
    }

    $user_id = get_current_user_id();
    if ($user_id < 1) {
        return new WP_Error(
            'utilityhub_identity_unauthenticated',
            'Sign in to continue.',
            array('status' => 401)
        );
    }

    $now = time();
    $max_age = defined('UTILITYHUB_IDENTITY_MAX_AGE')
        ? max(30, min(3600, (int) UTILITYHUB_IDENTITY_MAX_AGE))
        : 300;

    $segments = array(
        utilityhub_identity_base64url(
            wp_json_encode(array('alg' => 'HS256', 'typ' => 'JWT'))
        ),
        utilityhub_identity_base64url(
            wp_json_encode(array(
                'iss' => home_url(),
                'sub' => (string) $user_id,
                'aud' => utilityhub_identity_audience(),
                'iat' => $now,
                'exp' => $now + $max_age,
                'jti' => wp_generate_uuid4(),
            ))
        ),
    );

    $signature = hash_hmac('sha256', implode('.', $segments), $secret, true);

    return array(
        'token' => implode('.', $segments) . '.' . utilityhub_identity_base64url($signature),
        'expiresAt' => gmdate('c', $now + $max_age),
    );
}

function utilityhub_identity_register_routes()
{
    register_rest_route(
        'utilityhub/v1',
        '/identity',
        array(
            'methods' => 'GET',
            'callback' => function () {
                $token = utilityhub_identity_token();
                if (is_wp_error($token)) {
                    return $token;
                }
                return new WP_REST_Response($token, 200);
            },
            'permission_callback' => function () {
                return is_user_logged_in();
            },
        )
    );
}

add_action('rest_api_init', 'utilityhub_identity_register_routes');
