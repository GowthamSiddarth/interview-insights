import { Provider } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { isAiModerationEnabled } from './ai-moderation.env';

export const ANTHROPIC_CLIENT = 'ANTHROPIC_CLIENT';

// Own copy of api/src/ai-moderation/anthropic-client.provider.ts (GitHub
// issue #340, D81 — the LLM only gets called from this service now). Null
// when the feature is disabled (no ANTHROPIC_API_KEY configured) —
// AnalysisService checks for null rather than the provider throwing at
// boot, since this feature is optional.
export const anthropicClientProvider: Provider = {
  provide: ANTHROPIC_CLIENT,
  useFactory: (): Anthropic | null => {
    if (!isAiModerationEnabled()) return null;
    return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  },
};
