export const STATUS_TEXT: Record<string, string> = { queued: 'Sending…', sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Failed', received: 'Reply' };
/** Ticks as words, so the meaning does not depend on small icons. */
export const TICK_TEXT: Record<string, string> = { sent: 'Sent ✓', delivered: 'Delivered ✓✓', read: 'Read ✓✓', failed: 'Failed', queued: 'Sending…', received: 'Reply' };
