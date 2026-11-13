'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/Icons';
import Loader from '@/components/Loader';
import { showToast } from '@/components/toast';
import { connectCodeAction, connectManualAction, disconnectAction, fixWebhookAction, saveMetaAppAction, statusAction, type StatusData } from './actions';

declare global { interface Window { FB?: { init: (o: object) => void; login: (cb: (r: { authResponse?: { code?: string } }) => void, o: object) => void }; fbAsyncInit?: () => void } }

const STEPS = ['Welcome', 'Requirements', 'Connect', 'Verify', 'Done'] as const;
const FEATURES = [
  { icon: 'chat', title: 'Automatic reminders', text: 'Hostels get a WhatsApp reminder when a delivery is not acknowledged.' },
  { icon: 'check', title: 'Delivery ticks', text: 'See sent, delivered and read on every order.' },
  { icon: 'flag', title: 'Replies and opt-out', text: 'Replies are kept; a hostel can reply STOP.' },
  { icon: 'shield', title: 'Plain-English errors', text: 'If WhatsApp refuses a message, you see why.' },
] as const;

export interface WizardProps {
  appManaged: boolean;       // the Meta app is set once on the server: customers only press the button
  appId: string; configId: string; hasSecret: boolean;
  connected: boolean; webhookUrl: string; verifyToken: string; initialDisplay: string;
}

export default function ConnectWizard(p: WizardProps) {
  const [step, setStep] = useState(p.connected ? 3 : 0);
  const [tab, setTab] = useState<'signup' | 'token'>(p.configId && p.appId ? 'signup' : 'token');
  const [app, setApp] = useState({ appId: p.appId, appSecret: '', configId: p.configId });
  const [hasSecret, setHasSecret] = useState(p.hasSecret);
  const [savedApp, setSavedApp] = useState({ appId: p.appId, configId: p.configId });
  const [manual, setManual] = useState({ token: '', phoneNumberId: '' });
  const [status, setStatus] = useState<StatusData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [sdk, setSdk] = useState(false);
  const [, start] = useTransition();
  const loaded = useRef(false);

  const run = (what: string, fn: () => Promise<void>) => { setError(''); setBusy(what); start(async () => { try { await fn(); } finally { setBusy(null); } }); };

  const loadStatus = (advance = false) => run('status', async () => {
    const r = await statusAction();
    if (!r.ok || !r.data) { setError(r.message || 'Could not load the connection status.'); return; }
    setStatus(r.data);
    if (advance) setStep(r.data.connected ? 3 : 1);
  });
  useEffect(() => { if (p.connected && !loaded.current) { loaded.current = true; loadStatus(); } }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // Facebook SDK for the one-click signup (only when a Meta app and configuration are saved)
  useEffect(() => {
    if (step !== 2 || !savedApp.appId || !savedApp.configId || window.FB) { if (window.FB) setSdk(true); return; }
    window.fbAsyncInit = () => { window.FB?.init({ appId: savedApp.appId, autoLogAppEvents: true, xfbml: true, version: 'v24.0' }); setSdk(true); };
    if (!document.getElementById('facebook-jssdk')) {
      const js = document.createElement('script');
      js.id = 'facebook-jssdk'; js.src = 'https://connect.facebook.net/en_US/sdk.js'; js.async = true;
      document.body.appendChild(js);
    }
  }, [step, savedApp.appId, savedApp.configId]);

  const saveApp = () => run('app', async () => {
    const r = await saveMetaAppAction(app.appId, app.appSecret, app.configId);
    if (!r.ok) { setError(r.message); return; }
    setSavedApp({ appId: app.appId.trim(), configId: app.configId.trim() });
    if (app.appSecret.trim()) setHasSecret(true);
    setApp((a) => ({ ...a, appSecret: '' }));
    showToast({ message: 'Meta app saved.' });
  });

  const launchSignup = () => {
    if (!window.FB) { setError('Facebook is still loading. Try again in a moment.'); return; }
    window.FB.login((resp) => {
      const code = resp.authResponse?.code;
      if (!code) { setError('Sign-up was cancelled.'); return; }
      run('signup', async () => {
        const r = await connectCodeAction(code);
        if (!r.ok) { setError(r.message); return; }
        showToast({ message: r.message }); setStep(3); await loadStatusNow();
      });
    }, { config_id: savedApp.configId, response_type: 'code', override_default_response_type: true, extras: { setup: { featureType: 'whatsapp_business_app_onboarding' } }, scope: 'whatsapp_business_management,whatsapp_business_messaging,business_management' });
  };
  const loadStatusNow = async () => { const r = await statusAction(); if (r.ok && r.data) setStatus(r.data); };

  const connectManual = () => run('manual', async () => {
    const r = await connectManualAction(manual.token, manual.phoneNumberId);
    if (!r.ok) { setError(r.message); return; }
    showToast({ message: r.message }); setManual({ token: '', phoneNumberId: '' }); setStep(3); await loadStatusNow();
  });
  const fix = () => run('fix', async () => { const r = await fixWebhookAction(); if (!r.ok) setError(r.message); else showToast({ message: r.message }); await loadStatusNow(); });
  const leave = () => { if (!confirm('Disconnect WhatsApp? Reminders go back to preview only.')) return; run('off', async () => { const r = await disconnectAction(); if (!r.ok) { setError(r.message); return; } setStatus(null); setStep(0); showToast({ message: r.message }); }); };
  const copy = (t: string) => { navigator.clipboard?.writeText(t); showToast({ message: 'Copied' }); };

  const checks = status?.checks;
  const canFinish = !!checks?.tokenValid && !!checks?.webhookSubscribed;

  return (
    <div className="wiz">
      <ol className="wiz-steps" aria-label="Setup steps">
        {STEPS.map((s, i) => <li key={s} className={i === step ? 'now' : i < step ? 'done' : ''}><span>{i < step ? <Icon name="check" size={13} /> : i + 1}</span>{s}</li>)}
      </ol>

      {error && <p className="master-message master-error" role="alert">{error}</p>}

      {step === 0 && (
        <section className="wiz-card center">
          <h2>Send reminders on WhatsApp</h2>
          <p className="lede">Connect the department’s WhatsApp number to the official Meta Cloud API. It takes about two minutes.</p>
          <div className="wiz-features">{FEATURES.map((f) => <div key={f.title}><Icon name={f.icon} size={20} /><b>{f.title}</b><span>{f.text}</span></div>)}</div>
          <button className="btn primary-ish" onClick={() => setStep(1)}>Get started <Icon name="arrow" size={16} /></button>
        </section>
      )}

      {step === 1 && (
        <section className="wiz-card">
          <h3><Icon name="shield" size={18} /> Before you start, make sure you have</h3>
          <ul className="wiz-list">
            <li>A Meta (Facebook) Business account where you are an administrator.</li>
            <li>A phone number that can receive an OTP call or SMS and is <b>not</b> already used on the normal WhatsApp app.</li>
            <li>The business details Meta may ask for (name, address).</li>
          </ul>
          <p className="mut small">Only the permissions needed to send messages are requested.</p>
          <div className="wiz-nav"><button className="btn" onClick={() => setStep(0)}><Icon name="back" size={15} />Back</button><button className="btn primary-ish" onClick={() => setStep(2)}>Continue <Icon name="arrow" size={16} /></button></div>
        </section>
      )}

      {step === 2 && (
        <section className="wiz-card">
          <h3><Icon name="plug" size={18} /> Connect</h3>
          {!p.appManaged && <details className="quiet" open={!savedApp.appId || !hasSecret}>
            <summary>Your Meta app {savedApp.appId && hasSecret ? '(saved)' : '(needed first)'}</summary>
            <div className="master-fields">
              <label className="master-field">App ID<input value={app.appId} onChange={(e) => setApp({ ...app, appId: e.target.value })} inputMode="numeric" maxLength={30} /></label>
              <label className="master-field">App secret {hasSecret && <span className="mut">(saved; leave blank to keep)</span>}<input type="password" autoComplete="new-password" value={app.appSecret} onChange={(e) => setApp({ ...app, appSecret: e.target.value })} maxLength={200} /></label>
              <label className="master-field">Embedded Signup configuration ID <span className="mut">(only for one-click signup)</span><input value={app.configId} onChange={(e) => setApp({ ...app, configId: e.target.value })} inputMode="numeric" maxLength={30} /></label>
            </div>
            <button className="btn" disabled={busy === 'app'} onClick={saveApp}>{busy === 'app' ? <Loader size="sm" label="" /> : null}Save Meta app</button>
          </details>}

          <div className="seg wiz-tabs" role="tablist">
            <a role="tab" aria-selected={tab === 'signup'} className={tab === 'signup' ? 'on' : ''} onClick={() => setTab('signup')}>One-click signup (recommended)</a>
            <a role="tab" aria-selected={tab === 'token'} className={tab === 'token' ? 'on' : ''} onClick={() => setTab('token')}>Use an access token</a>
          </div>

          {tab === 'signup' ? (
            <div className="wiz-pane center">
              <h4>Connect with Facebook</h4>
              <p className="mut">A secure Meta window creates or links your WhatsApp Business account for you.</p>
              <button className="btn primary-ish" disabled={!sdk || !hasSecret || !savedApp.configId || busy === 'signup'} onClick={launchSignup}>{busy === 'signup' ? <Loader size="sm" label="" /> : <Icon name="chat" size={16} />}Continue with Facebook</button>
              {!p.appManaged && (!hasSecret || !savedApp.appId || !savedApp.configId) && <p className="mut small">Save the App ID, App secret and configuration ID above first.</p>}
              {savedApp.appId && savedApp.configId && !sdk && <p className="mut small">Loading Facebook…</p>}
            </div>
          ) : (
            <div className="wiz-pane">
              <p className="mut">Already have a permanent access token (system user)? Paste it. We check it with Meta before saving.</p>
              <label className="master-field">Permanent access token<input type="password" autoComplete="new-password" value={manual.token} onChange={(e) => setManual({ ...manual, token: e.target.value })} maxLength={1000} /></label>
              <label className="master-field">Phone number ID (from the Meta dashboard)<input value={manual.phoneNumberId} onChange={(e) => setManual({ ...manual, phoneNumberId: e.target.value })} inputMode="numeric" maxLength={30} /></label>
              <button className="btn primary-ish" disabled={busy === 'manual' || !hasSecret || !manual.token || !manual.phoneNumberId} onClick={connectManual}>{busy === 'manual' ? <Loader size="sm" label="" /> : null}Check and connect</button>
              {!hasSecret && <p className="mut small">Save the Meta app above first (needed to check the token).</p>}
            </div>
          )}
          <div className="wiz-nav"><button className="btn" onClick={() => setStep(1)}><Icon name="back" size={15} />Back</button></div>
        </section>
      )}

      {step === 3 && (
        <section className="wiz-card">
          <div className="wiz-head"><h3><Icon name="shield" size={18} /> Verify the connection</h3><button className="btn" disabled={busy === 'status'} onClick={() => loadStatus()}>{busy === 'status' ? <Loader size="sm" label="" /> : null}Check again</button></div>
          {!status ? <div className="wiz-pane center"><Loader label="Checking with Meta…" /></div> : !status.connected || !status.variables ? (
            <div className="wiz-pane center"><p>Not connected yet.</p><button className="btn" onClick={() => setStep(2)}>Go to Connect</button></div>
          ) : (
            <>
              <dl className="wiz-vars">
                {([['Number', `${status.variables.displayPhone}${status.variables.verifiedName ? ` · ${status.variables.verifiedName}` : ''}`], ['WhatsApp business account ID', status.variables.wabaId], ['Phone number ID', status.variables.phoneNumberId]] as const).map(([k, v]) => (
                  <div key={k}><dt>{k}</dt><dd>{v}<button className="icon-btn" aria-label={`Copy ${k}`} onClick={() => copy(v)}><Icon name="copy" size={14} /></button></dd></div>
                ))}
                <div><dt>Webhook address (set once in Meta → WhatsApp → Configuration)</dt><dd className="mono">{p.webhookUrl}<button className="icon-btn" aria-label="Copy webhook address" onClick={() => copy(p.webhookUrl)}><Icon name="copy" size={14} /></button></dd></div>
                <div><dt>Verify token</dt><dd className="mono">{p.verifyToken}<button className="icon-btn" aria-label="Copy verify token" onClick={() => copy(p.verifyToken)}><Icon name="copy" size={14} /></button></dd></div>
              </dl>
              <div className="wiz-checks">
                <div className={`check-row ${checks?.tokenValid ? 'ok' : 'bad'}`}><Icon name={checks?.tokenValid ? 'check' : 'alert'} size={18} /><div><b>Access token is valid</b>{!checks?.tokenValid && <p>Create a new token or connect again with Facebook.</p>}</div></div>
                <div className={`check-row ${checks?.webhookSubscribed ? 'ok' : 'bad'}`}><Icon name={checks?.webhookSubscribed ? 'check' : 'alert'} size={18} /><div><b>Delivery ticks and replies are switched on</b>{!checks?.webhookSubscribed && <button className="btn" disabled={busy === 'fix'} onClick={fix}>{busy === 'fix' ? <Loader size="sm" label="" /> : null}Fix automatically</button>}</div></div>
                <div className={`check-row ${checks?.templateApproved ? 'ok' : 'warn'}`}><Icon name={checks?.templateApproved ? 'check' : 'info'} size={18} /><div><b>Reminder wording approved by WhatsApp</b>{!checks?.templateApproved && <p>Not yet. Submit it on the <Link href="/whatsapp">Reminders</Link> page. Live sending needs this.</p>}</div></div>
              </div>
              <div className="wiz-nav">
                <button className="btn" onClick={() => setStep(2)}><Icon name="back" size={15} />Back</button>
                <span><button className="btn" onClick={leave}>Disconnect</button> <button className="btn primary-ish" disabled={!canFinish} onClick={() => setStep(4)}>Finish setup <Icon name="arrow" size={16} /></button></span>
              </div>
            </>
          )}
        </section>
      )}

      {step === 4 && (
        <section className="wiz-card center">
          <div className="wiz-done"><Icon name="check" size={40} /></div>
          <h2>WhatsApp is connected</h2>
          <p className="lede">{status?.variables?.displayPhone || p.initialDisplay} is ready. Reminders start in preview mode, so nothing is sent until you switch them on.</p>
          <div className="wiz-nav center"><Link className="btn primary-ish" href="/whatsapp">Open reminders</Link><button className="btn" onClick={() => setStep(3)}>Back to checks</button></div>
        </section>
      )}
    </div>
  );
}
