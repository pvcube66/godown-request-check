'use client';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Icon } from '@/components/Icons';
import Loader from '@/components/Loader';
import { showToast } from '@/components/toast';
import { deleteTemplateAction, syncTemplatesAction } from './actions';

export function SyncButton() {
  const [pending, start] = useTransition();
  return (
    <button className="btn" disabled={pending} onClick={() => start(async () => { const r = await syncTemplatesAction(); showToast({ message: r.message, ...(r.ok ? {} : { tone: 'bad' as const }) }); })}>
      {pending ? <Loader size="sm" label="" /> : <Icon name="undo" size={16} />}Sync with WhatsApp
    </button>
  );
}

export function RowActions({ name, language, isDraft }: { name: string; language: string; isDraft: boolean }) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const del = () => start(async () => { const r = await deleteTemplateAction(name, language); showToast({ message: r.message, ...(r.ok ? {} : { tone: 'bad' as const }) }); setOpen(false); });
  return (
    <span className="row-actions">
      <Link className="btn" href={`/whatsapp/templates/new?from=${encodeURIComponent(name)}&lang=${encodeURIComponent(language)}${isDraft ? '&draft=1' : ''}`}>{isDraft ? 'Edit' : 'Duplicate'}</Link>
      {open ? (
        <span className="confirm"><button className="btn problem" disabled={pending} onClick={del}>{pending ? <Loader size="sm" label="" /> : null}Delete for good</button><button className="btn" onClick={() => setOpen(false)}>Keep</button></span>
      ) : <button className="btn" onClick={() => setOpen(true)}>Delete</button>}
    </span>
  );
}
