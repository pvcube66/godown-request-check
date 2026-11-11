import Link from 'next/link';
import { ensureWhatsAppSettings, EMPTY_PROFILE, fetchBusinessProfile, getMetaFailureCopy, isConnected, WhatsAppApiError } from '@anomaly/core';
import { getDb } from '@/lib/db';
import { masterAdminAccess } from '@/lib/master-auth';
import WaSettingsTabs from '@/components/WaSettingsTabs';
import ProfileForm from './ProfileForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Business profile' };

export default async function Profile() {
  if (!(await masterAdminAccess()).authorized) return <div className="master-page"><header className="master-header"><h1>Business profile</h1></header><section className="master-section master-gate"><h2>Administrators only</h2><p>The profile is managed by an administrator.</p></section></div>;
  const s = await ensureWhatsAppSettings(await getDb());
  let profile = EMPTY_PROFILE, problem = '';
  if (isConnected(s)) { try { profile = await fetchBusinessProfile(s); } catch (e) { problem = e instanceof WhatsAppApiError ? `${getMetaFailureCopy(e.message).title}. ${getMetaFailureCopy(e.message).action}` : 'Could not read the profile from WhatsApp.'; } }
  return (
    <>
      <section className="hero"><h1>WhatsApp settings</h1><p className="lede">What people see when they open your WhatsApp business profile.</p></section>
      <WaSettingsTabs active="profile" />
      {!isConnected(s) ? <p className="alert-bar" role="status">WhatsApp is not connected yet. <Link href="/whatsapp/connect">Connect WhatsApp</Link></p> : problem ? <p className="alert-bar" role="alert">{problem}</p> : <ProfileForm initial={profile} />}
    </>
  );
}
