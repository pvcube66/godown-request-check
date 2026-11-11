'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { showToast } from '@/components/toast';
import { addQuickReplyAction, deleteQuickReplyAction } from '../actions';

export default function QuickReplies({ list }: { list: { title: string; text: string }[] }) {
  const router = useRouter();
  const [title, setTitle] = useState(''); const [text, setText] = useState(''); const [err, setErr] = useState(''); const [pending, start] = useTransition();
  const add = () => { setErr(''); start(async () => { const r = await addQuickReplyAction(title, text); if (!r.ok) { setErr(r.message); return; } showToast({ message: r.message }); setTitle(''); setText(''); router.refresh(); }); };
  return (
    <div className="qr-wrap">
      <div className="profile-form">
        <label className="master-field">Title <span className="mut">(what you click)</span><input value={title} maxLength={30} onChange={(e) => setTitle(e.target.value)} placeholder="Thanks" /></label>
        <label className="master-field">Reply<textarea rows={3} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="Thank you, we have noted it." /></label>
        {err && <p className="master-message master-error" role="alert">{err}</p>}
        <div><button className="btn primary-ish" disabled={pending || !title.trim() || !text.trim()} onClick={add}>Save quick reply</button></div>
      </div>
      {list.length === 0 ? <div className="empty">No quick replies yet.</div> : (
        <div className="table-wrap"><table className="order-table"><thead><tr><th>Title</th><th>Reply</th><th /></tr></thead>
          <tbody>{list.map((q) => <tr key={q.title}><td><b>{q.title}</b></td><td className="small">{q.text}</td><td className="num"><button className="btn" disabled={pending} onClick={() => { if (confirm(`Delete “${q.title}”?`)) start(async () => { const r = await deleteQuickReplyAction(q.title); showToast({ message: r.message, ...(r.ok ? {} : { tone: 'bad' as const }) }); router.refresh(); }); }}>Delete</button></td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}
