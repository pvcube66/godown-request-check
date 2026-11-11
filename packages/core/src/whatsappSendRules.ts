/** Browser-safe parts of Send Message (no database code). */
export type SendOutcome = 'would_send' | 'sent' | 'failed' | 'opted_out' | 'not_saved' | 'outside_window';
export const SEND_OUTCOME_TEXT: Record<SendOutcome, string> = { would_send: 'Would be sent', sent: 'Sent', failed: 'Not sent', opted_out: 'Skipped: opted out', not_saved: 'Skipped: not in People', outside_window: 'Skipped: more than 24 hours since they last wrote' };
export interface SendResult { phone: string; name: string; outcome: SendOutcome; text: string; note?: string }
export interface SendSummary { mode: 'off' | 'dry_run' | 'live'; preview: boolean; results: SendResult[]; sent: number; failed: number; skipped: number; stopped: string | null }

