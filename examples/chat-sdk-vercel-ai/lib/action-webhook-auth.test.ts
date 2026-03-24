import { describe, expect, it } from 'vitest';

import {
  ACTION_WEBHOOK_SECRET_MIN_LENGTH,
  buildActionWebhookUrl,
  generateActionWebhookSecret,
  getActionWebhookSecretConfigurationError,
  getConfiguredActionWebhookSecret,
  resolveActionWebhookSecretForLocalStack,
} from './action-webhook-auth.js';

describe('action-webhook auth helpers', () => {
  it('reports a missing configured secret', () => {
    expect(getActionWebhookSecretConfigurationError({})).toBe(
      'Action webhook secret is not configured. Set ACTION_WEBHOOK_SECRET or start the local stack launcher.',
    );
  });

  it('rejects configured secrets shorter than the minimum length', () => {
    expect(getConfiguredActionWebhookSecret({ ACTION_WEBHOOK_SECRET: 'too-short-secret' })).toBeNull();
    expect(getActionWebhookSecretConfigurationError({ ACTION_WEBHOOK_SECRET: 'too-short-secret' })).toBe(
      `ACTION_WEBHOOK_SECRET must be at least ${ACTION_WEBHOOK_SECRET_MIN_LENGTH} characters long for the local demo.`,
    );
  });

  it('keeps a valid env-provided secret unchanged', () => {
    const envSecret = 'valid-action-secret-0123456789';

    expect(getConfiguredActionWebhookSecret({ ACTION_WEBHOOK_SECRET: `  ${envSecret}  ` })).toBe(envSecret);
    expect(resolveActionWebhookSecretForLocalStack({ ACTION_WEBHOOK_SECRET: envSecret })).toEqual({
      secret: envSecret,
      source: 'env',
    });
  });

  it('generates a fresh local secret when none is configured', () => {
    const first = generateActionWebhookSecret();
    const second = generateActionWebhookSecret();
    const resolved = resolveActionWebhookSecretForLocalStack({});

    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(ACTION_WEBHOOK_SECRET_MIN_LENGTH);
    expect(second.length).toBeGreaterThanOrEqual(ACTION_WEBHOOK_SECRET_MIN_LENGTH);
    expect(resolved.source).toBe('generated');
    expect(resolved.secret.length).toBeGreaterThanOrEqual(ACTION_WEBHOOK_SECRET_MIN_LENGTH);
  });

  it('builds an action webhook url with the secret token', () => {
    expect(buildActionWebhookUrl('http://127.0.0.1:3001/api/action-webhook', 'abc123')).toBe(
      'http://127.0.0.1:3001/api/action-webhook?token=abc123',
    );
  });
});
