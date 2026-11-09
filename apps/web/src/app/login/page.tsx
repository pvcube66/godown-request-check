import LoginForm from './LoginForm';

export const metadata = { title: 'Sign in · Godown Request Check' };

export default function Login() {
  return (
    <div className="login">
      <section className="login-side" aria-hidden="true">
        <p className="brand">Godown Request Check</p>
        <h1>Spot requests that are much bigger than usual.</h1>
        <div className="demo">
          <p className="demo-title">Idli Ravva</p>
          <div className="bars">
            <div className="bar-row"><span>Usually</span><div className="track"><i className="b-usual" style={{ width: '10%' }} /></div><b>30</b></div>
            <div className="bar-row"><span>This time</span><div className="track"><i className="b-high" style={{ width: '100%' }} /></div><b>300</b></div>
          </div>
          <p className="demo-note">This request is about 10 times more than usual.</p>
        </div>
      </section>
      <section className="login-main">
        <div className="login-card">
          <h2>Welcome back</h2>
          <p className="lead">Enter your password to see which godown requests need checking.</p>
          <LoginForm />
        </div>
      </section>
    </div>
  );
}
