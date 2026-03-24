export const runtime = 'nodejs';

import { timingSafeEqual } from 'node:crypto';

import {
  applyActionWebhookEffects,
  type ActionWebhookPayload,
} from '@/lib/action-webhook';
import {
  getActionWebhookSecretConfigurationError,
  getConfiguredActionWebhookSecret,
} from '@/lib/action-webhook-auth.js';

function isAuthorizedActionWebhookRequest(req: Request): boolean {
  const providedToken = new URL(req.url).searchParams.get('token');
  if (!providedToken) {
    return false;
  }

  const expectedToken = getConfiguredActionWebhookSecret(process.env);
  if (!expectedToken) {
    return false;
  }

  const provided = Buffer.from(providedToken);
  const expected = Buffer.from(expectedToken);

  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export async function POST(req: Request) {
  const configurationError = getActionWebhookSecretConfigurationError(process.env);
  if (configurationError) {
    console.error(`[chat-sdk-vercel-ai] ${configurationError}`);
    return Response.json({
      ok: false,
      error: configurationError,
    }, { status: 503 });
  }

  if (!isAuthorizedActionWebhookRequest(req)) {
    console.warn('[chat-sdk-vercel-ai] rejected unauthorized action webhook request');
    return Response.json({
      ok: false,
      error: 'Unauthorized action webhook request.',
    }, { status: 401 });
  }

  const payload = await req.json() as ActionWebhookPayload;

  console.log('[chat-sdk-vercel-ai] card action webhook received:', JSON.stringify(payload));

  const result = await applyActionWebhookEffects(payload);

  return Response.json({
    ...result,
    receivedAt: new Date().toISOString(),
  });
}
