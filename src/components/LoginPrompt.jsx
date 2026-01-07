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
    e.stopPropagation();
    
    // Prevent multiple submissions
    if (isLoading) {
      console.log('[LoginPrompt] Code submission already in progress, ignoring...');
      return;
    }
    
    setError('');
    
    if (!code || code.length !== 6) {
      setError('Please enter the 6-digit code');
      return;
    }

    setIsLoading(true);
    try {
      // Step 1: Verify login code with Memberstack
      const result = await verifyLoginCode(email, code);
      if (result.success) {
        setMessage('Code verified! Checking login status...');
        
        // Step 2: Refresh session and verify Memberstack login status
        try {
          await refreshSession();
          console.log('[LoginPrompt] Session refreshed after passwordless login');
        } catch (refreshError) {
          console.warn('[LoginPrompt] Session refresh failed:', refreshError);
        }
        
        // Step 3: Check Memberstack login status - verify user is actually logged in
        let userEmail = null;
        let member = null;
        let loginVerified = false;
        
        // Try multiple times with delays (session might not be immediately available)
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            if (attempt > 0) {
              // Wait before retrying (100ms, 200ms, 300ms, 400ms)
              await new Promise(resolve => setTimeout(resolve, attempt * 100));
            }
            
            member = await checkMemberstackSession();
            if (member) {
              userEmail = getUserEmail(member);
              console.log(`[LoginPrompt] Attempt ${attempt + 1}: Member found, email:`, userEmail);
              if (userEmail) {
                loginVerified = true;
                break; // Success - exit retry loop
              }
            }
          } catch (memberError) {
            console.warn(`[LoginPrompt] Attempt ${attempt + 1} failed:`, memberError);
          }
        }
        
        // Step 4: If Memberstack login verified, use the email from Memberstack
        // Otherwise fallback to form email
        if (!loginVerified || !userEmail) {
          console.warn('[LoginPrompt] Memberstack login not verified, using form email as fallback');
          userEmail = email.toLowerCase().trim();
        }
        
        console.log('[LoginPrompt] Login verified, userEmail:', userEmail);
        
        // Step 5: If login is successful, use the email from Memberstack to fetch data from server
        // This ensures we display content from the server using the authenticated user's email
        if (userEmail) {
          setMessage('Loading your dashboard...');
          
          try {
            // Fetch both dashboard and licenses data in parallel immediately using the email from Memberstack
            // The email is used to query the backend API which returns user-specific data
            console.log('[LoginPrompt] Fetching dashboard data from server using email:', userEmail);
            
            const [dashboardData, licensesData] = await Promise.all([
              queryClient.prefetchQuery({
                queryKey: queryKeys.dashboard(userEmail),
                queryFn: async () => {
                  console.log('[LoginPrompt] Fetching dashboard from API...');
                  const data = await getDashboard(userEmail);
                  console.log('[LoginPrompt] ✅ Dashboard data received:', {
                    hasSites: !!data.sites,
                    sitesCount: data.sites ? Object.keys(data.sites).length : 0,
                    hasSubscriptions: !!data.subscriptions
                  });
                  return data;
                },
                staleTime: 300000, // 5 minutes
                retry: 2,
              }),
              queryClient.prefetchQuery({
                queryKey: queryKeys.licenses(userEmail),
                queryFn: async () => {
                  console.log('[LoginPrompt] Fetching licenses from API...');
                  const data = await getLicenses(userEmail);
                  console.log('[LoginPrompt] ✅ Licenses data received:', {
                    hasLicenses: !!data.licenses,
                    licensesCount: data.licenses ? data.licenses.length : 0
                  });
                  return data;
                },
                staleTime: 300000, // 5 minutes
                retry: 2,
              })
            ]);
            
            // Step 6: Verify data was fetched and cached
            const cachedDashboard = queryClient.getQueryData(queryKeys.dashboard(userEmail));
            const cachedLicenses = queryClient.getQueryData(queryKeys.licenses(userEmail));
            
            if (cachedDashboard && cachedLicenses) {
              console.log('[LoginPrompt] ✅ All data loaded and cached, showing dashboard');
              setIsLoading(false);
              
              // Step 7: Dispatch login event to show dashboard (data is already loaded)
              window.dispatchEvent(new CustomEvent('memberstack:login'));
            } else {
              throw new Error('Data was not properly cached after fetch');
            }
          } catch (fetchError) {
            console.error('[LoginPrompt] ❌ Error fetching data:', fetchError);
            setError(fetchError.message || 'Failed to load dashboard data. Please try again.');
            setIsLoading(false);
            return; // Don't show dashboard if data fetch failed
          }
        } else {
          // Fallback: show error instead of reloading (reload causes refresh loop)
          console.warn('[LoginPrompt] No user email after login verification');
          setError('Unable to retrieve user email. Please try logging in again.');
          setIsLoading(false);
          // Don't reload - just show error and let user retry
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
                *Please use the same email you used for your Stripe purchase to access the dashboard.
              </p>
              
              {error && <div className="login-error">{error}</div>}
              
              <button 
                type="submit"
                className="login-button"
                disabled={isLoading}
              >
                {isLoading ? 'Sending...' : 'Send verification code.'}
              </button>
              
              {(
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
                onChange={(e) => {
                  const newCode = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setCode(newCode);
                }}
                onPaste={(e) => {
                  // Handle paste - extract numeric code
                  const pastedText = (e.clipboardData || window.clipboardData).getData('text');
                  const numericCode = pastedText.replace(/\D/g, '').slice(0, 6);
                  setCode(numericCode);
                  // Prevent default to avoid double handling
                  e.preventDefault();
                  
                  // Auto-submit after paste if we have 6 digits (but only once)
                  if (numericCode.length === 6 && !isLoading) {
                    // Use a ref or flag to prevent multiple submissions
                    setTimeout(() => {
                      if (!isLoading && numericCode.length === 6) {
                        const form = e.target.closest('form');
                        if (form) {
                          // Create a proper submit event
                          const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
                          form.dispatchEvent(submitEvent);
                        }
                      }
                    }, 200);
                  }
                }}
                onKeyDown={(e) => {
                  // Auto-submit on Enter key
                  if (e.key === 'Enter' && code.length === 6 && !isLoading) {
                    e.preventDefault();
                    const form = e.target.closest('form');
                    if (form) {
                      const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
                      form.dispatchEvent(submitEvent);
                    }
                  }
                }}
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

