import { headers } from 'next/headers';
import { ensureWhatsAppSettings, isConnected } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { masterAdminAccess } from '@/lib/master-auth';
import ConnectWizard from './ConnectWizard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Connect WhatsApp' };

export default async function ConnectWhatsApp() {
  if (!(await masterAdminAccess()).authorized) return <div className="master-page"><header className="master-header"><h1>Connect WhatsApp</h1></header><section className="master-section master-gate"><h2>Administrators only</h2><p>WhatsApp is connected by an administrator.</p></section></div>;
  const s = await ensureWhatsAppSettings(await getDb());
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'your-site';
  return (
    <>
      <section className="hero"><h1>Connect WhatsApp</h1></section>
      <ConnectWizard appId={s.appId} configId={s.configId} hasSecret={!!s.appSecretEnc} connected={isConnected(s)} webhookUrl={`https://${host}/api/whatsapp/webhook`} verifyToken={s.verifyToken} initialDisplay={s.displayPhone ?? ''} />
    </>
  );
}
