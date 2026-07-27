import { Provider } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { isAiModerationEnabled } from './ai-moderation.env';

export const ANTHROPIC_CLIENT = 'ANTHROPIC_CLIENT';

// Null when the feature is disabled (no ANTHROPIC_API_KEY configured) —
// AiModerationService checks for null rather than the provider throwing at
// boot, since this feature is optional (unlike MailModule's transporter,
// which the app depends on unconditionally).
export const anthropicClientProvider: Provider = {
  provide: ANTHROPIC_CLIENT,
  useFactory: (): Anthropic | null => {
    if (!isAiModerationEnabled()) return null;
    return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  },
};
