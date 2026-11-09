'use client';
import { useEffect, useState } from 'react';
import type { ToastDetail } from './toast';
import { Icon } from './Icons';

export default function Toaster() {
  const [t, setT] = useState<(ToastDetail & { id: number }) | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const on = (e: Event) => {
      const d = (e as CustomEvent<ToastDetail>).detail;
      setT({ ...d, id: Date.now() });
      clearTimeout(timer); timer = setTimeout(() => setT(null), 7000);
    };
    window.addEventListener('app-toast', on);
    return () => { window.removeEventListener('app-toast', on); clearTimeout(timer); };
  }, []);
  if (!t) return null;
  return (
    <div className={`toast ${t.tone ?? 'ok'}`} role="status" aria-live="polite" key={t.id}>
      <Icon name={t.tone === 'bad' ? 'alert' : 'check'} size={20} />
      <span>{t.message}</span>
      {t.undo && <button onClick={async () => { await t.undo!(); setT(null); }}>Undo</button>}
      <button className="x" aria-label="Close" onClick={() => setT(null)}><Icon name="x" size={16} /></button>
    </div>
  );
}
