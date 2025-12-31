/**
 * Memberstack SDK integration service
 * Handles Memberstack authentication and session management
 */

// Dynamic import Memberstack DOM to prevent blocking page load
import('@memberstack/dom').then(m => {
  window.__memberstackDOM = m.default || m;
}).catch(error => {
  console.error('[Memberstack] Failed to import SDK:', error);
  window.__memberstackDOM = null;
});

// Get Memberstack DOM (from window or import)
function getMemberstackDOM() {
  if (window.__memberstackDOM) {
    return window.__memberstackDOM;
  }
  // Try to import synchronously as fallback (shouldn't happen)
  return null;
}

// Using existing server - same as consentbit-dashboard-1
const API_BASE = import.meta.env.VITE_API_BASE || 'https://consentbit-dashboard-test.web-8fb.workers.dev';

// Memberstack public key (from App ID: app_clz9z3q4t00fl0sos3fhy0wft)
// The public key format is typically: pk_sb_xxxxx
// For now, we'll use the App ID format and let Memberstack handle it
const MEMBERSTACK_PUBLIC_KEY = import.meta.env.VITE_MEMBERSTACK_PUBLIC_KEY || 'pk_sb_241f0857ee78032a21c3';

// Initialize Memberstack SDK instance
let memberstackInstance = null;

// Initialize Memberstack SDK (non-blocking)
function initMemberstack() {
  if (!memberstackInstance) {
    try {
      const dom = getMemberstackDOM();
      console.log('[Memberstack] DOM module:', dom);
      if (dom && dom.init) {
        memberstackInstance = dom.init({
          publicKey: MEMBERSTACK_PUBLIC_KEY,
          useCookies: true,                // Enable cookie persistence
          setCookieOnRootDomain: true,     // Optional: set cookies on root domain
          sessionDurationDays: 30,         // How long sessions last
        });
        console.log('[Memberstack] SDK initialized programmatically');
        console.log('[Memberstack] Initialized instance:', memberstackInstance);
        console.log('[Memberstack] Instance methods:', memberstackInstance ? Object.keys(memberstackInstance) : 'null');
      } else {
        // SDK not loaded yet, will retry
        console.warn('[Memberstack] SDK not available yet, will retry. DOM:', dom);
      }
    } catch (error) {
      console.error('[Memberstack] Failed to initialize SDK:', error);
      // Don't throw - allow app to continue
    }
  }
  return memberstackInstance;
}

// Get Memberstack SDK instance
function getMemberstackSDK() {
  // First, try to initialize if not already done
  if (!memberstackInstance) {
    initMemberstack();
  }
  
  // Return the initialized instance
  if (memberstackInstance) {
    return memberstackInstance;
  }
  
  // Fallback: Check window for SDK (in case script tag is also present)
  if (window.$memberstackReady === true) {
    if (window.memberstack) return window.memberstack;
    if (window.$memberstack) return window.$memberstack;
    if (window.Memberstack) return window.Memberstack;
    if (window.$memberstackDom && window.$memberstackDom.memberstack) return window.$memberstackDom.memberstack;
    if (window.$memberstackDom) return window.$memberstackDom;
  }
  
  // Also check without the ready flag
  if (window.memberstack) return window.memberstack;
  if (window.$memberstack) return window.$memberstack;
  if (window.Memberstack) return window.Memberstack;
  if (window.$memberstackDom && window.$memberstackDom.memberstack) return window.$memberstackDom.memberstack;
  if (window.$memberstackDom) return window.$memberstackDom;
  
  return null;
}

// Wait for Memberstack SDK to be ready (optimized for fast loading)
export async function waitForSDK() {
  // Wait for dynamic import to complete
  let importAttempts = 0;
  while (!window.__memberstackDOM && importAttempts < 10) {
    await new Promise(resolve => setTimeout(resolve, 100));
    importAttempts++;
  }
  
  // Initialize SDK
  const memberstack = initMemberstack();
  
  if (memberstack) {
    // If SDK has required methods, return immediately (don't wait for onReady)
    if (memberstack.getCurrentMember || memberstack.member || memberstack.loginWithEmail) {
      // Try to wait for onReady with a short timeout, but don't block
      if (memberstack.onReady && typeof memberstack.onReady.then === 'function') {
        // Race between onReady and a short timeout
        try {
          await Promise.race([
            memberstack.onReady,
            new Promise(resolve => setTimeout(resolve, 1000)) // 1 second max wait
          ]);
        } catch (error) {
          console.warn('[Memberstack] onReady promise rejected:', error);
        }
      }
      return memberstack;
    }
  }
  
  // Fallback: Quick polling (reduced attempts)
  let pollAttempts = 0;
  const maxAttempts = 10; // Reduced from 20
  const interval = 100; // Reduced from 200ms
  
  while (pollAttempts < maxAttempts) {
    const sdk = getMemberstackSDK();
    
    if (sdk) {
      if (sdk.getCurrentMember || sdk.member || sdk.loginWithEmail) {
        return sdk;
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, interval));
    pollAttempts++;
  }
  
  // Final check
  return getMemberstackSDK();
}

// Check if user is logged in via Memberstack
export async function checkMemberstackSession() {
  try {
    const memberstack = await waitForSDK();
    
    if (!memberstack) {
      console.warn('[Memberstack] SDK not loaded');
      return null;
    }
    
    // Wait for SDK to be ready with timeout (don't wait indefinitely)
    if (memberstack.onReady && typeof memberstack.onReady.then === 'function') {
      try {
        await Promise.race([
          memberstack.onReady,
          new Promise(resolve => setTimeout(resolve, 2000)) // 2 second timeout
        ]);
      } catch (error) {
        console.warn('[Memberstack] onReady error:', error);
        // Continue anyway - SDK might still work
      }
    }
    
    // Get current member - try multiple methods
    let member = null;
    
    // Method 1: memberstack.getCurrentMember (npm package method)
    if (memberstack.getCurrentMember && typeof memberstack.getCurrentMember === 'function') {
      try {
        const memberResult = await memberstack.getCurrentMember();
        console.log('[Memberstack] getCurrentMember result:', {
          hasData: !!memberResult,
          hasDataData: !!(memberResult?.data),
          keys: memberResult ? Object.keys(memberResult) : [],
          fullResult: memberResult
        });
        member = memberResult;
      } catch (error) {
        console.warn('[Memberstack] Error with getCurrentMember:', error);
      }
    }
    
    // Method 2: memberstack.member (alternative npm package method)
    if ((!member || !member.id) && memberstack.member) {
      try {
        if (typeof memberstack.member === 'function') {
          member = await memberstack.member();
        } else {
          member = memberstack.member;
        }
      } catch (error) {
        console.warn('[Memberstack] Error with member:', error);
      }
    }
    
    // Method 3: window.memberstack.getCurrentMember (fallback for script tag)
    if ((!member || !member.id) && window.memberstack && window.memberstack.getCurrentMember) {
      try {
        member = await window.memberstack.getCurrentMember();
      } catch (error) {
        console.warn('[Memberstack] Error with window.memberstack:', error);
      }
    }
    
    // Handle Memberstack v2 SDK response structure: {data: {...}}
    if (member && member.data) {
      console.log('[Memberstack] Unwrapping member.data structure');
      member = member.data;
    }
    
    // Log member structure for debugging
    if (member) {
      console.log('[Memberstack] Member structure:', {
        hasId: !!(member.id || member._id),
        hasEmail: !!(member.email || member._email || member.data?.email || member.data?.auth?.email),
        keys: Object.keys(member),
        email: member.email || member._email || member.data?.email || member.data?.auth?.email || 'NOT FOUND',
        fullMember: member
      });
    } else {
      console.log('[Memberstack] No member found in session');
    }
    
    // Accept member if we have ID or email
    if (member && (member.id || member._id || member.email || member._email || member.data?.email || member.data?.auth?.email)) {
      return member;
    }
    
    return null;
  } catch (error) {
    console.error('[Memberstack] Error checking session:', error);
    return null;
  }
}

// Get user email from Memberstack member (normalized like reference dashboard)
export function getUserEmail(member) {
  if (!member) return null;
  
  // Try multiple possible email fields (matching reference dashboard)
  const email = member.data?.auth?.email || 
                member.data?.email || 
                member.email || 
                member._email || 
                null;
  
  // Normalize email (lowercase and trim) - matching reference dashboard
  if (email) {
    return email.toLowerCase().trim();
  }
  
  return null;
}

// Login with email and password (from Memberstack docs)
export async function loginWithEmailPassword(email, password) {
  try {
    const memberstack = await waitForSDK();
    
    if (!memberstack) {
      console.error('[Memberstack] SDK not available for email/password login');
      return { success: false, error: 'SDK not available' };
    }
    
    // Method: loginMemberEmailPassword (correct Memberstack method)
    if (memberstack.loginMemberEmailPassword && typeof memberstack.loginMemberEmailPassword === 'function') {
      console.log('[Memberstack] Using loginMemberEmailPassword method');
      try {
        const response = await memberstack.loginMemberEmailPassword({ email, password });
        console.log('[Memberstack] loginMemberEmailPassword response:', response);
        if (response && response.data) {
          return { success: true, data: response.data };
        } else if (response && response.errors) {
          return { success: false, error: response.errors[0]?.message || 'Login failed' };
        }
        return { success: true };
      } catch (error) {
        console.error('[Memberstack] loginMemberEmailPassword error:', error);
        return { success: false, error: error.message || 'Login failed' };
      }
    }
    
    console.warn('[Memberstack] loginMemberEmailPassword method not available');
    return { success: false, error: 'Login method not available' };
  } catch (error) {
    console.error('[Memberstack] Error logging in with email/password:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

// Signup with email and password (from Memberstack docs)
export async function signupWithEmailPassword(email, password) {
  try {
    const memberstack = await waitForSDK();
    
    if (!memberstack) {
      console.error('[Memberstack] SDK not available for email/password signup');
      return { success: false, error: 'SDK not available' };
    }
    
    // Method: signupMemberEmailPassword (correct Memberstack method)
    if (memberstack.signupMemberEmailPassword && typeof memberstack.signupMemberEmailPassword === 'function') {
      console.log('[Memberstack] Using signupMemberEmailPassword method');
      try {
        const response = await memberstack.signupMemberEmailPassword({ email, password });
        console.log('[Memberstack] signupMemberEmailPassword response:', response);
        if (response && response.data) {
          return { success: true, data: response.data };
        } else if (response && response.errors) {
          return { success: false, error: response.errors[0]?.message || 'Signup failed' };
        }
        return { success: true };
      } catch (error) {
        console.error('[Memberstack] signupMemberEmailPassword error:', error);
        return { success: false, error: error.message || 'Signup failed' };
      }
    }
    
    console.warn('[Memberstack] signupMemberEmailPassword method not available');
    return { success: false, error: 'Signup method not available' };
  } catch (error) {
    console.error('[Memberstack] Error signing up with email/password:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

// Send login code to email (passwordless authentication)
export async function sendLoginCode(email) {
  try {
    const memberstack = await waitForSDK();
    
    if (!memberstack) {
      console.error('[Memberstack] SDK not available for sending login code');
      return { success: false, error: 'SDK not available' };
    }
    
    // Debug: Log all available methods
    console.log('[Memberstack] Available methods:', Object.keys(memberstack));
    console.log('[Memberstack] SDK instance:', memberstack);
    
    // Method 1: Try sendMemberLoginPasswordlessEmail first (for existing members)
    let loginError = null;
    let loginErrorCode = null;
    
    if (memberstack.sendMemberLoginPasswordlessEmail && typeof memberstack.sendMemberLoginPasswordlessEmail === 'function') {
      console.log('[Memberstack] Trying sendMemberLoginPasswordlessEmail method (for existing members)');
      try {
        const response = await memberstack.sendMemberLoginPasswordlessEmail({ email });
        console.log('[Memberstack] sendMemberLoginPasswordlessEmail full response:', JSON.stringify(response, null, 2));
        
        if (response && response.data) {
          return { success: true, data: response.data };
        } else if (response && response.errors && response.errors.length > 0) {
          const errorMessage = response.errors[0]?.message || response.errors[0] || 'Failed to send code';
          const errorCode = response.errors[0]?.code || '';
          console.log('[Memberstack] Login method error:', errorMessage, 'Code:', errorCode);
          
          // Store error but continue to try signup if member not found
          if (errorMessage.toLowerCase().includes('not found') || 
              errorMessage.toLowerCase().includes('does not exist') ||
              errorCode === 'MEMBER_NOT_FOUND' ||
              errorCode === 'passwordless-email-not-found') {
            loginError = errorMessage;
            loginErrorCode = errorCode;
            console.log('[Memberstack] Member not found for passwordless login, will try signup method...');
          } else {
            return { success: false, error: errorMessage };
          }
        } else {
          // No errors, assume success
          return { success: true };
        }
      } catch (error) {
        console.error('[Memberstack] sendMemberLoginPasswordlessEmail exception:', error);
        // Extract error message and code - handle different error structures
        const errorMessage = error.message || (error.errors && error.errors[0]?.message) || error.toString() || 'Failed to send code';
        const errorCode = error.code || (error.errors && error.errors[0]?.code) || '';
        console.log('[Memberstack] Exception details:', {
          message: error.message,
          code: error.code,
          errors: error.errors,
          fullError: error,
          stack: error.stack,
          response: error.response
        });
        
        // If member not found, try signup method
        // Check for passwordless-email-not-found which means member exists but not configured for passwordless
        if (errorMessage.toLowerCase().includes('not found') || 
            errorMessage.toLowerCase().includes('does not exist') ||
            errorCode === 'MEMBER_NOT_FOUND' ||
            errorCode === 'passwordless-email-not-found') {
          loginError = errorMessage;
          loginErrorCode = errorCode;
          console.log('[Memberstack] Member not found for passwordless (code:', errorCode, '), will try signup method...');
        } else {
          // For other errors, still try signup as fallback
          loginError = errorMessage;
          loginErrorCode = errorCode;
          console.log('[Memberstack] Other error occurred, will try signup as fallback...');
        }
      }
    }
    
    // Method 1b: Try sendMemberSignupPasswordlessEmail (for new members or if login failed with "not found")
    // This method can work for existing members too - it will send a code if the member exists
    if (memberstack.sendMemberSignupPasswordlessEmail && typeof memberstack.sendMemberSignupPasswordlessEmail === 'function') {
      console.log('[Memberstack] Trying sendMemberSignupPasswordlessEmail method (works for both new and existing members)');
      try {
        const response = await memberstack.sendMemberSignupPasswordlessEmail({ email });
        console.log('[Memberstack] sendMemberSignupPasswordlessEmail full response:', JSON.stringify(response, null, 2));
        
        // Check response structure more carefully
        console.log('[Memberstack] Signup method response type:', typeof response);
        console.log('[Memberstack] Signup method response keys:', response ? Object.keys(response) : 'null');
        
        if (response && response.data) {
          console.log('[Memberstack] Successfully sent passwordless code via signup method');
          console.log('[Memberstack] Response data:', response.data);
          return { success: true, data: response.data };
        } else if (response && response.errors && response.errors.length > 0) {
          const errorMessage = response.errors[0]?.message || response.errors[0] || 'Failed to send code';
          const errorCode = response.errors[0]?.code || '';
          console.log('[Memberstack] Signup method error:', errorMessage, 'Code:', errorCode);
          
          // If both login and signup failed, return the most specific error
          if (loginError) {
            return { 
              success: false, 
              error: `The email exists in your dashboard but is not set up for passwordless login. Please use email/password login or contact support. Original error: ${loginError}` 
            };
          }
          return { success: false, error: errorMessage };
        } else if (response === null || response === undefined) {
          // Null/undefined response might still mean success in some cases
          console.log('[Memberstack] Signup method returned null/undefined - assuming success');
          return { success: true };
        } else if (response === true || response === false) {
          // Boolean response
          console.log('[Memberstack] Signup method returned boolean:', response);
          return { success: response };
        } else {
          // Any other response structure - log it and assume success if no errors
          console.log('[Memberstack] Signup method succeeded (unexpected response structure):', response);
          return { success: true };
        }
      } catch (error) {
        console.error('[Memberstack] sendMemberSignupPasswordlessEmail exception:', error);
        const errorMessage = error.message || error.toString() || 'Failed to send code';
        const errorCode = error.code || '';
        console.log('[Memberstack] Signup exception details:', {
          message: error.message,
          code: error.code,
          stack: error.stack
        });
        
        // If both methods failed, return combined error
        if (loginError) {
          return { 
            success: false, 
            error: `Unable to send login code. The email exists but may not be configured for passwordless authentication. Please check Memberstack settings or use an alternative login method.` 
          };
        }
        return { success: false, error: errorMessage };
      }
    } else if (loginError) {
      // Login failed with "not found" but no signup method available
      console.warn('[Memberstack] Login failed and signup method not available');
      return { 
        success: false, 
        error: `The email is not set up for passwordless login. Error: ${loginError}. Please configure passwordless authentication in Memberstack or use an alternative login method.` 
      };
    }
    
    // Method 2: Check if methods are nested in different structure
    if (memberstack.auth && typeof memberstack.auth === 'object') {
      if (memberstack.auth.loginWithEmail && typeof memberstack.auth.loginWithEmail === 'function') {
        console.log('[Memberstack] Using auth.loginWithEmail method');
        try {
          const response = await memberstack.auth.loginWithEmail({ email });
          return { success: true, data: response };
        } catch (error) {
          console.error('[Memberstack] auth.loginWithEmail error:', error);
          return { success: false, error: error.message };
        }
      }
    }
    
    // Method 3: passwordless methods
    if (memberstack.passwordless && typeof memberstack.passwordless === 'object') {
      if (memberstack.passwordless.sendCode && typeof memberstack.passwordless.sendCode === 'function') {
        console.log('[Memberstack] Using passwordless.sendCode method');
        try {
          await memberstack.passwordless.sendCode({ email });
          return { success: true };
        } catch (error) {
          console.error('[Memberstack] passwordless.sendCode error:', error);
          return { success: false, error: error.message };
        }
      }
    }
    
    // Method 4: sendMagicLink
    if (memberstack.sendMagicLink && typeof memberstack.sendMagicLink === 'function') {
      console.log('[Memberstack] Using sendMagicLink method (fallback)');
      try {
        await memberstack.sendMagicLink({ email });
        return { success: true };
      } catch (error) {
        console.error('[Memberstack] sendMagicLink error:', error);
        return { success: false, error: error.message };
      }
    }
    
    // Method 5: Try direct API call if SDK methods don't work
    console.warn('[Memberstack] No SDK method found. Trying direct API call...');
    try {
      const response = await fetch('https://api.memberstack.com/v1/auth/passwordless', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': MEMBERSTACK_PUBLIC_KEY
        },
        body: JSON.stringify({ email })
      });
      
      if (response.ok) {
        return { success: true };
      } else {
        const errorData = await response.json().catch(() => ({}));
        return { success: false, error: errorData.message || 'Failed to send code' };
      }
    } catch (apiError) {
      console.error('[Memberstack] Direct API call error:', apiError);
    }
    
    console.warn('[Memberstack] No method found to send login code. Available methods:', Object.keys(memberstack));
    return { success: false, error: 'Login method not available. Please check console for available methods.' };
  } catch (error) {
    console.error('[Memberstack] Error sending login code:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

// Verify login code
export async function verifyLoginCode(email, code) {
  try {
    const memberstack = await waitForSDK();
    
    if (!memberstack) {
      console.error('[Memberstack] SDK not available for verifying code');
      return { success: false, error: 'SDK not available' };
    }
    
    // Method 1: loginMemberPasswordless (correct Memberstack method)
    if (memberstack.loginMemberPasswordless && typeof memberstack.loginMemberPasswordless === 'function') {
      console.log('[Memberstack] Using loginMemberPasswordless method');
      try {
        const response = await memberstack.loginMemberPasswordless({ email, passwordlessToken: code });
        console.log('[Memberstack] loginMemberPasswordless response:', response);
        if (response && response.data) {
          return { success: true, data: response.data };
        } else if (response && response.errors) {
          return { success: false, error: response.errors[0]?.message || 'Invalid code' };
        }
        return { success: true };
      } catch (error) {
        console.error('[Memberstack] loginMemberPasswordless error:', error);
        return { success: false, error: error.message || 'Verification failed' };
      }
    }
    
    // Fallback methods
    if (memberstack.verifyCode && typeof memberstack.verifyCode === 'function') {
      console.log('[Memberstack] Using verifyCode method (fallback)');
      try {
        const result = await memberstack.verifyCode({ email, code });
        return { success: !!result, data: result };
      } catch (error) {
        console.error('[Memberstack] verifyCode error:', error);
        return { success: false, error: error.message };
      }
    }
    
    console.warn('[Memberstack] No method found to verify code. Available methods:', Object.keys(memberstack));
    return { success: false, error: 'Verification method not available' };
  } catch (error) {
    console.error('[Memberstack] Error verifying code:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

// Open Memberstack login modal
export async function openLoginModal() {
  try {
    const memberstack = await waitForSDK();
    
    if (!memberstack) {
      console.error('[Memberstack] SDK not available for login');
      return;
    }
    
    // Debug: Log available methods
    console.log('[Memberstack] Available methods:', Object.keys(memberstack));
    console.log('[Memberstack] Memberstack instance:', memberstack);
    
    // Try different methods to open login modal
    // Method 1: openModal (common in Memberstack SDK)
    if (memberstack.openModal && typeof memberstack.openModal === 'function') {
      console.log('[Memberstack] Using openModal method');
      await memberstack.openModal('login');
      return;
    }
    
    // Method 2: modal (alternative method)
    if (memberstack.modal && typeof memberstack.modal === 'function') {
      console.log('[Memberstack] Using modal method');
      await memberstack.modal('login');
      return;
    }
    
    // Method 3: login (direct login method)
    if (memberstack.login && typeof memberstack.login === 'function') {
      console.log('[Memberstack] Using login method');
      await memberstack.login();
      return;
    }
    
    // Method 4: Check for UI methods
    if (memberstack.ui && typeof memberstack.ui === 'object') {
      if (memberstack.ui.open && typeof memberstack.ui.open === 'function') {
        console.log('[Memberstack] Using ui.open method');
        await memberstack.ui.open('login');
        return;
      }
      if (memberstack.ui.login && typeof memberstack.ui.login === 'function') {
        console.log('[Memberstack] Using ui.login method');
        await memberstack.ui.login();
        return;
      }
    }
    
    // If no modal method found, log available methods and redirect
    console.warn('[Memberstack] No login modal method found. Available methods:', Object.keys(memberstack));
    console.warn('[Memberstack] Redirecting to login page');
    window.location.href = '/';
  } catch (error) {
    console.error('[Memberstack] Error opening login modal:', error);
    // Fallback: redirect to login page
    window.location.href = '/';
  }
}

// Get session token (from Memberstack docs)
export async function getSessionToken() {
  try {
    const memberstack = await waitForSDK();
    if (!memberstack) {
      return null;
    }
    
    // Method 1: getMemberCookie (from Memberstack docs)
    if (memberstack.getMemberCookie && typeof memberstack.getMemberCookie === 'function') {
      const cookie = memberstack.getMemberCookie();
      if (cookie) {
        return cookie;
      }
    }
    
    // Method 2: Check for token in memberstack instance
    if (memberstack.getToken && typeof memberstack.getToken === 'function') {
      const token = await memberstack.getToken();
      if (token) {
        return token;
      }
    }
    
    // Fallback: Check localStorage/cookies
    const storedToken = localStorage.getItem('_ms-mem') || 
                       document.cookie.split('; ').find(row => row.startsWith('_ms-mem='));
    
    return storedToken ? storedToken.split('=')[1] : null;
  } catch (error) {
    console.error('[Memberstack] Error getting session token:', error);
    return null;
  }
}

// Refresh session (from Memberstack docs)
export async function refreshSession() {
  try {
    const memberstack = await waitForSDK();
    if (!memberstack) {
      return false;
    }
    
    // Check current member to refresh session
    const member = await checkMemberstackSession();
    if (member) {
      console.log('[Memberstack] Session refreshed');
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('[Memberstack] Error refreshing session:', error);
    return false;
  }
}

// Check if session is expired
export async function isSessionExpired() {
  try {
    const token = await getSessionToken();
    if (!token) {
      return true;
    }
    
    // Check if we can get current member
    const member = await checkMemberstackSession();
    return !member;
  } catch (error) {
    console.error('[Memberstack] Error checking session expiration:', error);
    return true;
  }
}

// Logout from Memberstack (enhanced session management)
export async function logout() {
  try {
    console.log('[Memberstack] Starting logout process...');
    
    // Get Memberstack SDK instance
    const memberstack = await waitForSDK();
    
    // Step 1: Call Memberstack logout method (this handles server-side session)
    if (memberstack && memberstack.logout && typeof memberstack.logout === 'function') {
      try {
        console.log('[Memberstack] Calling memberstack.logout()...');
        await memberstack.logout();
        console.log('[Memberstack] Memberstack logout completed');
      } catch (logoutError) {
        console.warn('[Memberstack] Error during memberstack.logout():', logoutError);
        // Continue with cleanup even if logout fails
      }
    } else {
      console.warn('[Memberstack] memberstack.logout() method not available');
    }
    
    // Step 2: Clear all Memberstack-related localStorage items
    const localStorageKeys = Object.keys(localStorage);
    localStorageKeys.forEach(key => {
      if (key.startsWith('_ms-') || key.startsWith('memberstack-') || key.includes('memberstack')) {
        localStorage.removeItem(key);
        console.log(`[Memberstack] Removed localStorage key: ${key}`);
      }
    });
    
    // Step 3: Clear all Memberstack-related sessionStorage items
    const sessionStorageKeys = Object.keys(sessionStorage);
    sessionStorageKeys.forEach(key => {
      if (key.startsWith('_ms-') || key.startsWith('memberstack-') || key.includes('memberstack')) {
        sessionStorage.removeItem(key);
        console.log(`[Memberstack] Removed sessionStorage key: ${key}`);
      }
    });
    
    // Step 4: Clear all Memberstack-related cookies
    const cookiesToClear = [
      '_ms-mem',
      '_ms-token',
      'sb_session',
      'memberstack_session',
      'ms_session',
      'ms_member',
      'ms_token'
    ];
    
    const domain = window.location.hostname;
    const rootDomain = domain.split('.').slice(-2).join('.');
    
    cookiesToClear.forEach(cookieName => {
      // Clear cookie for current path
      document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
      // Clear cookie for root domain
      document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.${rootDomain};`;
      // Clear cookie for current domain
      document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=${domain};`;
      console.log(`[Memberstack] Cleared cookie: ${cookieName}`);
    });
    
    // Step 5: Dispatch logout event for UI updates
    try {
      window.dispatchEvent(new CustomEvent('memberstack:logout'));
      console.log('[Memberstack] Dispatched memberstack:logout event');
    } catch (eventError) {
      console.warn('[Memberstack] Failed to dispatch logout event:', eventError);
    }
    
    // Step 6: Clear any cached session data
    if (window.memberstackSessionCache) {
      delete window.memberstackSessionCache;
    }
    
    console.log('[Memberstack] Logout completed, all sessions and storage cleared');
    
    // Step 7: Redirect to login page (home page)
    // Small delay to ensure all cleanup completes
    setTimeout(() => {
      window.location.href = '/';
    }, 100);
    
  } catch (error) {
    console.error('[Memberstack] Logout error:', error);
    
    // Emergency cleanup: Clear everything and redirect
    try {
      // Clear all storage
      localStorage.clear();
      sessionStorage.clear();
      
      // Clear all cookies
      document.cookie.split(";").forEach(cookie => {
        const eqPos = cookie.indexOf("=");
        const name = eqPos > -1 ? cookie.substr(0, eqPos).trim() : cookie.trim();
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;`;
      });
      
      // Dispatch logout event
      window.dispatchEvent(new CustomEvent('memberstack:logout'));
      
      console.log('[Memberstack] Emergency cleanup completed');
    } catch (cleanupError) {
      console.error('[Memberstack] Emergency cleanup failed:', cleanupError);
    }
    
    // Redirect regardless of errors
    window.location.href = '/';
  }
}

// Get or create session token from API (for backend session management)
export async function getAPISessionToken(userEmail) {
  try {
    // Try to get one from API using email
    const response = await fetch(`${API_BASE}/create-session?email=${encodeURIComponent(userEmail)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include'
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.token) {
        // Set cookie for future requests
        document.cookie = `sb_session=${data.token}; path=/; max-age=86400; SameSite=Lax`;
        return data.token;
      }
    }
  } catch (error) {
    console.warn('[Memberstack] Could not get API session token:', error);
  }
  
  return null;
}

