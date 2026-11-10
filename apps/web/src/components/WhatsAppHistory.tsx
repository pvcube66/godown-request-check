import { failureText, type WhatsAppMessageDoc } from '@anomaly/core';
import { when } from '@/lib/format';
import { TICK_TEXT } from '@/lib/whatsapp-view';

/** Reminders sent about an order or hostel (which reminder number, when, delivery ticks) and any replies. Phone numbers are not shown in full. */
export default function WhatsAppHistory({ messages }: { messages: WhatsAppMessageDoc[] }) {
  if (messages.length === 0) return <p className="mut small">No WhatsApp reminder has been sent for this yet.</p>;
  return (
    <ul className="wa-history">
      {messages.map((m, i) => {
        const f = failureText(m);
        return (
          <li key={m.messageId ?? i}>
            <div>{m.direction === 'in' ? <b>Reply from the hostel</b> : <b>Reminder {m.reminderNo}</b>} <span className="mut small">· {when(m.createdAt)} · •••••• {m.phoneLast4}{m.direction === 'out' ? ` · ${TICK_TEXT[m.status] ?? m.status}` : ''}</span></div>
            {m.direction === 'in' && <p>“{m.text}”</p>}
            {f && <p className="small bad-text">{f.title}. {f.action}</p>}
          </li>
        );
      })}
    </ul>
  );
}
