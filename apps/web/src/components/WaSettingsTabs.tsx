import Link from 'next/link';

export const SETTINGS_TABS = [['templates', 'Templates', '/whatsapp/templates'], ['profile', 'Business profile', '/whatsapp/settings/profile'], ['quick', 'Quick replies', '/whatsapp/settings/quick-replies'], ['reminders', 'Reminders', '/whatsapp'], ['connection', 'Connection', '/whatsapp/connect']] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number][0];

/** The tab strip at the top of every WhatsApp settings page. */
export default function WaSettingsTabs({ active }: { active: SettingsTab }) {
  return <nav className="seg order-seg wa-tabs" aria-label="WhatsApp settings">{SETTINGS_TABS.map(([k, l, h]) => <Link key={k} href={h} className={k === active ? 'on' : ''} aria-current={k === active ? 'page' : undefined}>{l}</Link>)}</nav>;
}
