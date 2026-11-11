'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Loader from '@/components/Loader';
import { showToast } from '@/components/toast';
import { variablesIn } from '@anomaly/core/template-rules';
import { sendAction } from '../send/actions';
import { markReadAction, setChatStatusAction } from './actions';

export interface Msg { id: string; out: boolean; text: string; status: string; at: string; time: string; note: string; by: string }
interface Tpl { name: string; language: string; body: string; hasHeaderVar: boolean }
const tick = (s: string) => (s === 'read' ? <span className="tick read" title="Read">✓✓</span> : s === 'delivered' ? <span className="tick" title="Delivered">✓✓</span> : s === 'sent' ? <span className="tick" title="Sent">✓</span> : s === 'queued' ? <span className="tick" title="Sending">…</span> : null);
const newBatch = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });

export default function ChatThread({ phone, name, status, unread, optedOut, windowEnds, live, msgs, templates }: { phone: string; name: string; status: 'open' | 'closed'; unread: number; optedOut: boolean; windowEnds: string | null; live: boolean; msgs: Msg[]; templates: Tpl[] }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [tpl, setTpl] = useState(templates[0]?.name ?? '');
  const [vals, setVals] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  const batch = useRef(newBatch());

  // Clears "unread" once, then checks for new messages every 8 seconds while the tab is showing.
  useEffect(() => { if (unread > 0) void markReadAction(phone).then(() => router.refresh()); }, [phone, unread, router]);
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, 8000); return () => clearInterval(t); }, [router]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs.length, phone]);

  const t = templates.find((x) => x.name === tpl);
  const slots = t ? variablesIn(t.body).length : 0;
  const body = Array.from({ length: slots }, (_, i) => vals[i] ?? '');
  const inWindow = !!windowEnds;
  const submit = () => {
    setErr('');
    start(async () => {
      const r = await sendAction(inWindow ? { kind: 'text', text, phones: [phone], groups: [], batchId: batch.current } : { kind: 'template', template: { name: t!.name, language: t!.language }, body, header: [], phones: [phone], groups: [], batchId: batch.current }, false);
      if (!r.ok) { setErr(r.message); return; }
      const res = r.summary.results[0];
      if (res?.outcome !== 'sent') { setErr(res?.note || (res ? { opted_out: 'This person opted out and cannot be messaged.', outside_window: 'More than 24 hours since they last wrote. Send a template instead.', not_saved: 'This number is not saved in People.', failed: 'The message was not sent.', would_send: 'Nothing was sent.', sent: '' }[res.outcome] : 'Nothing was sent.')); return; }
      batch.current = newBatch(); setText(''); setVals([]); router.refresh();
    });
  };
  let last = '';
  return (
    <div className="chat-thread">
      <header className="chat-head">
        <div><b>{name || `+${phone}`}</b><div className="mut small">+{phone}{optedOut ? ' · opted out' : ''}</div></div>
        <button className="btn" disabled={pending} onClick={() => start(async () => { const r = await setChatStatusAction(phone, status === 'open' ? 'closed' : 'open'); showToast({ message: r.message, ...(r.ok ? {} : { tone: 'bad' as const }) }); router.refresh(); })}>{status === 'open' ? 'Close chat' : 'Reopen chat'}</button>
      </header>
      <div className="chat-msgs" role="log" aria-live="polite">
        {msgs.length === 0 && <p className="mut small">No messages yet.</p>}
        {msgs.map((m) => { const d = dayOf(m.at); const sep = d !== last; last = d; return (
          <div key={m.id}>
            {sep && <div className="chat-day">{d}</div>}
            <div className={`chat-msg ${m.out ? 'out' : 'in'}`}>
              {m.by && <span className="chat-by">{m.by}</span>}
              <span className="chat-text">{m.text}</span>
              <span className="chat-meta">{m.time} {m.out && tick(m.status)}</span>
              {m.status === 'failed' && <span className="chat-fail">{m.note || 'Not sent'}</span>}
            </div>
          </div>
        ); })}
        <div ref={end} />
      </div>
      {optedOut ? <p className="alert-bar">This person opted out, so they cannot be messaged.</p> : (
        <div className="chat-reply">
          {inWindow ? <p className="mut small">You can reply freely until {new Date(windowEnds!).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })}.</p> : <p className="mut small">More than 24 hours since they last wrote, so WhatsApp only allows an approved template.</p>}
          {!live && <p className="mut small">WhatsApp is not live, so messages cannot be sent yet.</p>}
          {inWindow ? <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a reply" maxLength={4000} aria-label="Reply" /> : templates.length === 0 ? <p className="mut small">No approved templates yet.</p> : (
            <>
              <select value={tpl} onChange={(e) => { setTpl(e.target.value); setVals([]); }} aria-label="Template">{templates.map((x) => <option key={x.name + x.language} value={x.name}>{x.name}</option>)}</select>
              {t && <p className="mut small wa-line">{t.body}</p>}
              {t?.hasHeaderVar && <p className="mut small">This template has a heading blank. Use Send message for it.</p>}
              {body.map((v, i) => <input key={i} className="plain-input" value={v} placeholder={`Blank {{${i + 1}}}`} onChange={(e) => { const n = [...body]; n[i] = e.target.value; setVals(n); }} maxLength={400} />)}
            </>
          )}
          {err && <p className="master-message master-error" role="alert">{err}</p>}
          <button className="btn primary-ish" disabled={pending || !live || (inWindow ? !text.trim() : !t || t.hasHeaderVar || body.some((v) => !v.trim()))} onClick={submit}>{pending ? <Loader size="sm" label="" /> : null}Send</button>
        </div>
      )}
    </div>
  );
}
