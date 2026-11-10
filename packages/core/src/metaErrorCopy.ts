/** Plain-English explanations for WhatsApp (Meta) error codes, for non-technical staff.
 *  Adapted from the team's TELECRM CRM (`utils/metaErrorCopy.js`): same codes and wording, rewritten for this system
 *  (there is no "Retry Failed" button here; reminders go out again on their own schedule). The raw code is kept for support. */

export interface FailureCopy { code: string; title: string; action: string; retryAfter: string | null }
type Entry = Omit<FailureCopy, 'code'>;

const META_COPY: Record<string, Entry> = {
  '131047': { title: 'WhatsApp restriction: the person has not messaged you in the last 24 hours', action: 'Only approved templates can be sent to this person. Check that the reminder template is approved.', retryAfter: null },
  '131026': { title: 'WhatsApp could not deliver to this number', action: 'The number may be switched off, invalid, or the person blocked business messages. Check the hostel’s phone number under Master data.', retryAfter: null },
  '132000': { title: 'WhatsApp did not accept the message format', action: 'The message does not match the approved template. Check the template, then the next reminder will go out on schedule.', retryAfter: null },
  '132001': { title: 'WhatsApp could not find this template', action: 'The template is missing or was removed on WhatsApp. Check it in WhatsApp settings.', retryAfter: null },
  '132012': { title: 'WhatsApp did not accept the message details', action: 'Names or values in the message do not fit the approved template. Check the template wording.', retryAfter: null },
  '131052': { title: 'WhatsApp did not accept this template for this kind of message', action: 'The template content does not fit its approved type. Check the template in WhatsApp settings.', retryAfter: null },
  '131048': { title: 'WhatsApp slowed these messages down: too many at once', action: 'Wait about 30 minutes. Reminders resume on their own.', retryAfter: '30 min' },
  '131056': { title: 'WhatsApp paused this number: too many messages', action: 'Wait about 1 hour. Reminders resume on their own.', retryAfter: '1 hour' },
  '80007': { title: 'WhatsApp limited how fast this number can send', action: 'Wait about 30 minutes. Reminders resume on their own.', retryAfter: '30 min' },
  '131020': { title: 'WhatsApp limited bulk sending from this number', action: 'Wait about 30 minutes. Reminders resume on their own.', retryAfter: '30 min' },
  '131041': { title: 'WhatsApp limited bulk sending from this number', action: 'Wait about 30 minutes. Reminders resume on their own.', retryAfter: '30 min' },
  '131059': { title: 'WhatsApp limited bulk sending from this number', action: 'Wait about 30 minutes. Reminders resume on their own.', retryAfter: '30 min' },
  '131049': { title: 'WhatsApp skipped this message to protect the person from spam', action: 'Nothing is wrong with the setup. The next reminder will try again.', retryAfter: null },
  '131031': { title: 'WhatsApp restricted this business number', action: 'Check your WhatsApp account quality in Meta Business Manager and fix any warning.', retryAfter: null },
  '131042': { title: 'WhatsApp paused this number: account payment or verification pending', action: 'Complete payment and verification in your Meta business account.', retryAfter: null },
  '133010': { title: 'Your WhatsApp business setup is incomplete', action: 'Finish the setup at business.facebook.com.', retryAfter: null },
  '190': { title: 'WhatsApp connection expired: the access key needs to be replaced', action: 'An administrator must paste a new access key in WhatsApp settings. Reminders are paused until then.', retryAfter: null },
};

const FALLBACK: Entry = { title: 'WhatsApp did not deliver this message', action: 'The next reminder will try again. If it keeps failing, contact support with the code shown.', retryAfter: null };
const STALE: FailureCopy = { code: '', title: 'WhatsApp never confirmed delivery to this number', action: 'The number may be unreachable.', retryAfter: null };

/** "131047: text" -> "131047". Text with no code (e.g. "Stale: ...") gives "". */
export function parseMetaCode(message: string | null | undefined): string {
  const raw = String(message ?? '').trim();
  if (!raw) return '';
  const idx = raw.indexOf(':');
  const head = (idx > 0 ? raw.slice(0, idx) : raw).trim();
  return head.match(/(\d{3,7})/)?.[1] ?? '';
}

export function getMetaFailureCopy(message: string | null | undefined): FailureCopy {
  const raw = String(message ?? '').trim();
  if (!raw) return { code: '', ...FALLBACK };
  if (/^stale:/i.test(raw)) return { ...STALE };
  const code = parseMetaCode(raw);
  if (!code) return { code: '', ...FALLBACK };
  return { code, ...(META_COPY[code] ?? FALLBACK) };
}
