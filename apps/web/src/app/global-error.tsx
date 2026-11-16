'use client';

/** The last safety net: if even the page frame fails, show a plain message instead of a blank screen. Own page, so it cannot depend on the site's styles. */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'system-ui, sans-serif', background: '#0a0a0a', color: '#ededed', textAlign: 'center', padding: 24 }}>
        <div style={{ maxWidth: 420 }}>
          <h1 style={{ fontSize: 22, margin: '0 0 10px' }}>The site hit a problem</h1>
          <p style={{ color: '#a1a1a1', margin: '0 0 20px' }}>Your data is safe. Please try again, and tell an administrator if it keeps happening.</p>
          <button type="button" onClick={() => retry()} style={{ background: '#ededed', color: '#0a0a0a', border: 0, borderRadius: 8, padding: '10px 18px', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
