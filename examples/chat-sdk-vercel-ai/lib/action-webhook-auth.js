import { randomBytes } from 'node:crypto';
import process from 'node:process';
import { URL } from 'node:url';

export const ACTION_WEBHOOK_SECRET_MIN_LENGTH = 24;

/**
 * Returns a trimmed, valid action-webhook secret from the provided env bag.
 * Invalid or missing secrets return null so callers can decide whether to
 * reject the request or generate a local runtime-only secret.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | null}
 */
export function getConfiguredActionWebhookSecret(env = process.env) {
  const secret = env.ACTION_WEBHOOK_SECRET?.trim();
  if (!secret || secret.length < ACTION_WEBHOOK_SECRET_MIN_LENGTH) {
    return null;
  }

  return secret;
}

/**
 * Describes why the action-webhook secret is unusable.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | null}
 */
export function getActionWebhookSecretConfigurationError(env = process.env) {
  const secret = env.ACTION_WEBHOOK_SECRET?.trim();

  if (!secret) {
    return 'Action webhook secret is not configured. Set ACTION_WEBHOOK_SECRET or start the local stack launcher.';
  }

  if (secret.length < ACTION_WEBHOOK_SECRET_MIN_LENGTH) {
    return `ACTION_WEBHOOK_SECRET must be at least ${ACTION_WEBHOOK_SECRET_MIN_LENGTH} characters long for the local demo.`;
  }

  return null;
}

/**
 * Generates a URL-safe local secret suitable for a throwaway dev/demo run.
 *
 * @returns {string}
 */
export function generateActionWebhookSecret() {
  return randomBytes(24).toString('base64url');
}

/**
 * Resolves the local stack action-webhook secret: use a valid env secret when
 * provided, otherwise generate a fresh one for this launcher process.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ secret: string; source: 'env' | 'generated' }}
 */
export function resolveActionWebhookSecretForLocalStack(env = process.env) {
  const configuredSecret = getConfiguredActionWebhookSecret(env);
  if (configuredSecret) {
    return { secret: configuredSecret, source: 'env' };
  }

  return {
    secret: generateActionWebhookSecret(),
    source: 'generated',
  };
}

/**
 * Adds the action-webhook token to a base URL.
 *
 * @param {string} baseUrl
 * @param {string} secret
 * @returns {string}
 */
export function buildActionWebhookUrl(baseUrl, secret) {
  const url = new URL(baseUrl);
  url.searchParams.set('token', secret);
  return url.toString();
}
