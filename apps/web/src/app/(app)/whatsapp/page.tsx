import { headers } from 'next/headers';
import { ensureWhatsAppSettings, failureText, hostelLabel, planReminders, REMINDER_LINES, SKIP_TEXT, TEMPLATE_BODY, type SkipReason } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { when } from '@/lib/format';
import { masterAdminAccess } from '@/lib/master-auth';
import { STATUS_TEXT } from '@/lib/whatsapp-view';
import ActionButton from './ActionButton';
import SettingsForm from './SettingsForm';
import { refreshTemplateAction, submitTemplateAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'WhatsApp reminders' };

const MODE_TEXT = { off: 'Off', dry_run: 'Preview only (nothing is sent)', live: 'Live (reminders are being sent)' } as const;

export default async function WhatsApp() {
  if (!(await masterAdminAccess()).authorized) return <div className="master-page"><header className="master-header"><h1>WhatsApp reminders</h1></header><section className="master-section master-gate"><h2>Administrators only</h2><p>WhatsApp settings are managed by an administrator.</p></section></div>;
  const c = await getDb();
  const s = await ensureWhatsAppSettings(c);
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'your-site';
  const webhookUrl = `https://${host}/api/whatsapp/webhook`;
  const now = new Date();
  const [plan, recent] = await Promise.all([planReminders(c, s, now), c.whatsappMessages.find({}).sort({ createdAt: -1 }).limit(50).toArray()]);
  const mask = (p: string) => `•••••• ${p.slice(-4)}`;
  const skipCounts = plan.skipped.reduce((m, x) => m.set(x.reason, (m.get(x.reason) ?? 0) + 1), new Map<SkipReason, number>());
  const error = s.lastError;

  return (
    <div className="master-page">
      <header className="master-header"><div><h1>WhatsApp reminders</h1><p>When a delivery has been In-Transit for a few days and the hostel has not acknowledged it on the portal, the hostel gets a WhatsApp reminder from the department’s own WhatsApp number. Reminders stop the moment the order is acknowledged, rejected or cancelled.</p></div></header>

      <section className="master-section" aria-labelledby="wa-status">
        <h2 id="wa-status">Where things stand</h2>
        <ul>
          <li>Mode: <b>{MODE_TEXT[s.mode]}</b></li>
          <li>Reminder wording: <b>{s.templateName}</b> · approval: <b>{s.templateStatus ?? 'not submitted yet'}</b>{s.templateReason ? ` (${s.templateReason})` : ''}{s.templateCheckedAt ? <span className="mut small"> · checked {when(s.templateCheckedAt)}</span> : null}</li>
          <li>Rules: first reminder after <b>{s.firstAfterDays}</b> days in transit, then every <b>{s.everyDays}</b> days, up to <b>{s.maxMessages}</b> reminders, one message per hostel per day, only between <b>{s.windowFrom}:00 and {s.windowTo}:00</b> India time.</li>
        </ul>
        {error && <p className="master-message master-error" role="alert">{error}{s.lastErrorAt ? ` (${when(s.lastErrorAt)})` : ''}</p>}
        {!s.phoneNumberId && <p className="master-note">Setup is not finished: the department’s WhatsApp details have not been added yet, so nothing can be sent. Preview still works.</p>}
      </section>

      <section className="master-section" aria-labelledby="wa-settings">
        <h2 id="wa-settings">Settings</h2>
        <p className="master-note">The access key and app secret are stored encrypted and are never shown again. “Live” stays unavailable until the reminder wording is approved by WhatsApp.</p>
        <SettingsForm phoneNumberId={s.phoneNumberId} wabaId={s.wabaId} hasToken={!!s.accessTokenEnc} hasSecret={!!s.appSecretEnc} mode={s.mode} firstAfterDays={s.firstAfterDays} everyDays={s.everyDays} maxMessages={s.maxMessages} windowFrom={s.windowFrom} windowTo={s.windowTo} />
      </section>

      <section className="master-section" aria-labelledby="wa-template">
        <h2 id="wa-template">Reminder wording</h2>
        <p>This is the message hostels receive. Only the last sentence changes from one reminder to the next.</p>
        <blockquote className="wa-sample">{TEMPLATE_BODY}</blockquote>
        <ol>{REMINDER_LINES.map((l, i) => <li key={i}>Reminder {i + 1}: {l}</li>)}</ol>
        <div className="row-inline">
          <ActionButton action={submitTemplateAction} label="Send wording to WhatsApp for approval" pending="Sending…" />
          <ActionButton action={refreshTemplateAction} label="Check approval" pending="Checking…" />
        </div>
      </section>

      <section className="master-section" aria-labelledby="wa-hook">
        <h2 id="wa-hook">Delivery ticks and replies (one-time setup in Meta)</h2>
        <p>In the Meta developer dashboard, open the WhatsApp product → Configuration → Webhook, and enter:</p>
        <ul>
          <li>Callback URL: <code>{webhookUrl}</code></li>
          <li>Verify token: <code>{s.verifyToken}</code></li>
          <li>Subscribe to <b>messages</b>. Then save the app secret above, so incoming updates can be checked as genuine.</li>
        </ul>
      </section>

      <section className="master-section" aria-labelledby="wa-preview">
        <h2 id="wa-preview">Who would be messaged right now</h2>
        <p className="master-note">{plan.transit} orders are In-Transit. {plan.items.length === 0 ? 'No reminder is due at this moment.' : `${plan.items.length} reminder${plan.items.length === 1 ? ' is' : 's are'} due.`} {[...skipCounts].map(([r, n]) => `${n} skipped: ${SKIP_TEXT[r].toLowerCase()}`).join('; ')}{skipCounts.size ? '.' : ''}</p>
        {plan.items.length > 0 && (
          <div className="table-wrap"><table className="order-table">
            <thead><tr><th>Order</th><th>Hostel</th><th>District</th><th>Phone</th><th>Reminder</th><th>Message</th></tr></thead>
            <tbody>{plan.items.map((i) => <tr key={i.requestId}><td>{i.requestId}</td><td>{hostelLabel(i.hostelName)}<div className="mut small">{i.hostelCode}</div></td><td>{i.districtName}</td><td>{mask(i.phone)}</td><td>#{i.reminderNo}</td><td className="small">{i.text}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>

      <section className="master-section" aria-labelledby="wa-recent">
        <h2 id="wa-recent">Latest messages</h2>
        {recent.length === 0 ? <p className="master-empty">Nothing has been sent yet.</p> : (
          <div className="table-wrap"><table className="order-table">
            <thead><tr><th>When</th><th>Order</th><th>Hostel</th><th>Phone</th><th>What</th><th>Result</th></tr></thead>
            <tbody>{recent.map((m) => { const f = failureText(m); return (
              <tr key={String(m._id)}><td>{when(m.createdAt)}</td><td>{m.requestId ?? '—'}</td><td>{hostelLabel(m.hostelName)}</td><td>•••••• {m.phoneLast4}</td>
                <td>{m.direction === 'in' ? <>Reply: “{m.text}”</> : <>Reminder #{m.reminderNo}</>}</td>
                <td><b>{STATUS_TEXT[m.status] ?? m.status}</b>{f && <div className="small bad-text">{f.title}. {f.action}</div>}</td></tr>); })}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
