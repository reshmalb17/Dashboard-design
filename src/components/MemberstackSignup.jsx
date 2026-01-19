import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  sendSignupPasswordlessEmail,
  verifySignupCode,
  refreshSession,
  getUserEmail,
  checkMemberstackSession
} from '../services/memberstack';

import './LoginPrompt.css';
import consentLogo from '../assets/consent-logo.svg';

export default function SignupPrompt({ setLoginScreen }) {
  const queryClient = useQueryClient();

  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState('email'); // email | code
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [rateLimitCooldown, setRateLimitCooldown] = useState(0);

  /* ---------------- SEND SIGNUP CODE ---------------- */
  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (rateLimitCooldown > 0) {
      setError(`Please wait ${rateLimitCooldown}s before retrying`);
      return;
    }

    if (!email || !email.includes('@')) {
      setError('Please enter a valid email');
      return;
    }

    setIsLoading(true);

    try {
      const result = await sendSignupPasswordlessEmail(email);

      if (result.success) {
        setStep('code');
        setMessage('Verification code sent to your email');
        setRateLimitCooldown(60);

        const interval = setInterval(() => {
          setRateLimitCooldown((prev) => {
            if (prev <= 1) {
              clearInterval(interval);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        setError(result.error || 'Failed to send signup code');
      }
    } catch (err) {
      setError('Failed to send signup code');
    } finally {
      setIsLoading(false);
    }
  };

  /* ---------------- VERIFY SIGNUP CODE ---------------- */
  const handleCodeSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!code || code.length !== 6) {
      setError('Enter 6-digit code');
      return;
    }

    setIsLoading(true);

    try {
      const result = await verifySignupCode(email, code);

      if (!result.success) {
        setError(result.error || 'Invalid verification code');
        setIsLoading(false);
        return;
      }

      // Ensure session is available
      try {
        await refreshSession();
      } catch {}

      let member = null;
      let verifiedEmail = null;

      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, i * 100));
        member = await checkMemberstackSession();
        if (member) {
          verifiedEmail = getUserEmail(member);
          if (verifiedEmail) break;
        }
      }

      // Signup + login successful
      window.dispatchEvent(new CustomEvent('memberstack:signup'));
    } catch (err) {
      setError('Verification failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-prompt-container">
      <div className="login-logo">
        <img src={consentLogo} className='logo-image' alt="Logo" />
      </div>

      <div className="login-prompt">
        <h2 className="login-title">Sign Up</h2>

        {step === 'email' ? (
          <form onSubmit={handleEmailSubmit} className="login-form">
            <div className="input-wrapper">
                <input
                  type="email"
                  id="email-input"
                  placeholder=" "
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={`login-input ${email ? 'has-value' : ''}`}
                  disabled={isLoading}
                  required
                />
                <label htmlFor="email-input" className="input-label">Email ID</label>
                <svg className="input-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M3 4.5L6 7.5L9 4.5" stroke="#666" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>

            {error && <div className="login-error">{error}</div>}
            {message && <div className="login-message">{message}</div>}
<p className="login-instruction">
                *Please use the same email you used for your Stripe purchase to access the dashboard.
              </p>
            <button type="submit" disabled={isLoading} className="login-button">
              {isLoading ? 'Sending…' : 'Send verification code'}
            </button>
 {(
                <p className="login-inbox-message">Please check your Email Inbox</p>
              )}
            <div style={{ marginTop: '16px', textAlign: 'center' }}>
  <span style={{ fontSize: '14px' }}>
    Already have an account?{' '}
    <button
      type="button"
      onClick={() => setLoginScreen(true)}
      className="login-link-button"
      style={{ padding: 0 }}
    >
      Log in
    </button>
  </span>
</div>

          </form>
        ) : (
          <>
            <p className="code-instruction">
              Enter the 6-digit code sent to <strong>{email}</strong>
            </p>

            <form onSubmit={handleCodeSubmit} className="login-form">
              <div className="input-wrapper">
                <input
                  type="text"
                  placeholder=" "
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                  }
                  maxLength={6}
                  disabled={isLoading}
                  autoFocus
                  required
                  className={`login-input code-input ${code ? 'has-value' : ''}`}
                />
                <label className="input-label">Verification Code</label>
              </div>

              {error && <div className="login-error">{error}</div>}
              {message && <div className="login-message">{message}</div>}

              <button type="submit" disabled={isLoading} className="login-button">
                {isLoading ? 'Verifying…' : 'Verify & Sign Up'}
              </button>

              <div className="code-actions">
                <button
                  type="button"
                  className="login-link-button"
                  onClick={() => {
                    setStep('email');
                    setCode('');
                    setError('');
                    setMessage('');
                  }}
                >
                  Back
                </button>

                <button
                  type="button"
                  className="login-link-button"
                  onClick={handleEmailSubmit}
                  disabled={rateLimitCooldown > 0}
                >
                  {rateLimitCooldown > 0
                    ? `Resend (${rateLimitCooldown}s)`
                    : 'Resend Code'}
                </button>
              </div>

              
            </form>
          </>
        )}
      </div>
    </div>
  );
}
