import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { openLoginModal, sendLoginCode, verifyLoginCode, refreshSession, getUserEmail, checkMemberstackSession } from '../services/memberstack';
import { getDashboard, getLicenses } from '../services/api';
import { queryKeys } from '../hooks/useDashboardQueries';
import './LoginPrompt.css';

// Import consent logo and background lines from assets folder
import consentLogo from '../assets/consent-logo.svg';
import backgroundLines from '../assets/background-lines.svg';

export default function LoginPrompt() {
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState('email'); // 'email' or 'code'
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [rateLimitCooldown, setRateLimitCooldown] = useState(0); // Rate limiting

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    
    // Rate limiting check
    if (rateLimitCooldown > 0) {
      setError(`Please wait ${rateLimitCooldown} seconds before requesting another code.`);
      return;
    }
    
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }

    setIsLoading(true);
    try {
      const result = await sendLoginCode(email);
      if (result.success) {
        setMessage('Login code sent to your email! Please check your inbox. The code will expire in 10 minutes.');
        setStep('code');
        // Rate limiting: 60 second cooldown
        setRateLimitCooldown(60);
        const cooldownInterval = setInterval(() => {
          setRateLimitCooldown(prev => {
            if (prev <= 1) {
              clearInterval(cooldownInterval);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        // Check if it's a rate limit error
        if (result.error && result.error.toLowerCase().includes('rate limit')) {
          setRateLimitCooldown(60);
          setError('Too many requests. Please wait 60 seconds before trying again.');
        } else {
          setError(result.error || 'Failed to send login code. Please try again.');
        }
      }
    } catch (error) {
      console.error('Error sending login code:', error);
      setError('Failed to send login code. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCodeSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (!code || code.length !== 6) {
      setError('Please enter the 6-digit code');
      return;
    }

    setIsLoading(true);
    try {
      const result = await verifyLoginCode(email, code);
      if (result.success) {
        setMessage('Code verified! Loading your dashboard...');
        
        // Refresh session after successful login
        try {
          await refreshSession();
          console.log('[LoginPrompt] Session refreshed after passwordless login');
        } catch (refreshError) {
          console.warn('[LoginPrompt] Session refresh failed:', refreshError);
          // Continue anyway - session might still be valid
        }
        
        // Get user email immediately after login
        // Wait a bit for session to be established (Memberstack needs time to set cookies)
        let userEmail = null;
        let member = null;
        
        // Try multiple times with delays (session might not be immediately available)
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            if (attempt > 0) {
              // Wait before retrying (100ms, 300ms, 500ms)
              await new Promise(resolve => setTimeout(resolve, attempt * 200));
            }
            
            member = await checkMemberstackSession();
            if (member) {
              userEmail = getUserEmail(member);
              console.log(`[LoginPrompt] Attempt ${attempt + 1}: Member found, email:`, userEmail);
              if (userEmail) {
                break; // Success - exit retry loop
              }
            }
          } catch (memberError) {
            console.warn(`[LoginPrompt] Attempt ${attempt + 1} failed:`, memberError);
          }
        }
        
        // Fallback to form email if we still don't have it
        if (!userEmail) {
          console.warn('[LoginPrompt] Could not get member email, using form email as fallback');
          userEmail = email.toLowerCase().trim();
        }
        
        console.log('[LoginPrompt] Final userEmail for prefetch:', userEmail);
        
        // Prefetch dashboard data immediately (before showing dashboard)
        if (userEmail) {
          console.log('[LoginPrompt] Prefetching dashboard data for:', userEmail);
          setMessage('Loading your data...');
          
          try {
            // Prefetch both dashboard and licenses data in parallel
            await Promise.all([
              queryClient.prefetchQuery({
                queryKey: queryKeys.dashboard(userEmail),
                queryFn: () => getDashboard(userEmail),
                staleTime: 300000, // 5 minutes
              }),
              queryClient.prefetchQuery({
                queryKey: queryKeys.licenses(userEmail),
                queryFn: () => getLicenses(userEmail),
                staleTime: 300000, // 5 minutes
              })
            ]);
            
            console.log('[LoginPrompt] ✅ Dashboard data prefetched successfully');
            setMessage('Dashboard ready! Redirecting...');
            
            // Dispatch login event to trigger UI update (instead of page reload)
            window.dispatchEvent(new CustomEvent('memberstack:login'));
            
            // Small delay to show success message, then let React update naturally
            setTimeout(() => {
              // The auth state change will trigger dashboard to show
              // No need to reload page - React will re-render with new auth state
            }, 500);
          } catch (prefetchError) {
            console.error('[LoginPrompt] Error prefetching data:', prefetchError);
            // Continue anyway - data will load when dashboard shows
            setMessage('Login successful! Loading dashboard...');
            window.dispatchEvent(new CustomEvent('memberstack:login'));
          }
        } else {
          // Fallback: reload page if we can't get email
          console.warn('[LoginPrompt] No user email, reloading page');
          setTimeout(() => {
            window.location.reload();
          }, 1000);
        }
      } else {
        setError(result.error || 'Invalid code. Please try again.');
      }
    } catch (error) {
      console.error('Error verifying code:', error);
      setError('Failed to verify code. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };


  const handleOpenModal = async () => {
    setIsLoading(true);
    try {
      await openLoginModal();
    } catch (error) {
      console.error('Error opening login modal:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-prompt-container">
      {/* Background Lines - positioned absolutely to cover full container */}
      <div className="background-lines">
        {/* <img src={backgroundLines} alt="" className="background-lines-image" /> */}
      </div>
      
      {/* ConsentBit Logo - centered at top */}
      <div className="login-logo">
        <img src={consentLogo} alt="ConsentBit" className="logo-image" />
      </div>
      
      <div className="login-prompt">
        {/* Log In Title */}
        <h2 className="login-title">Log In</h2>
        
        {step === 'email' ? (
          <>
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
              
              <p className="login-instruction">
                *Please use the exact mail as the webflow native app/framer native app
              </p>
              
              {error && <div className="login-error">{error}</div>}
              
              <button 
                type="submit"
                className="login-button"
                disabled={isLoading}
              >
                {isLoading ? 'Sending...' : 'Send Magic Link'}
              </button>
              
              {message && (
                <p className="login-inbox-message">Please check your Email Inbox</p>
              )}
            </form>
          </>
        ) : (
        <>
          <p className="code-instruction">Enter the 6-digit code sent to <strong>{email}</strong></p>
          <form onSubmit={handleCodeSubmit} className="login-form">
            <div className="input-wrapper">
              <input
                type="text"
                id="code-input"
                placeholder=" "
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className={`login-input code-input ${code ? 'has-value' : ''}`}
                disabled={isLoading}
                maxLength={6}
                required
                autoFocus
              />
              <label htmlFor="code-input" className="input-label">Enter 6-digit code</label>
            </div>
            {error && <div className="login-error">{error}</div>}
            {message && <div className="login-message">{message}</div>}
            <button 
              type="submit"
              className="login-button"
              disabled={isLoading}
            >
              {isLoading ? 'Verifying...' : 'Verify Code'}
            </button>
            <div className="code-actions">
              <button
                type="button"
                onClick={() => {
                  setStep('email');
                  setCode('');
                  setError('');
                  setMessage('');
                }}
                className="login-link-button"
              >
                Back to Email
              </button>
              <button
                type="button"
                onClick={handleEmailSubmit}
                className="login-link-button"
                disabled={rateLimitCooldown > 0}
              >
                {rateLimitCooldown > 0 ? `Resend (${rateLimitCooldown}s)` : 'Resend Code'}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
    </div>
  );
}

