/**
 * Memberstack SDK integration service
 * Handles Memberstack authentication and session management
 */

// Dynamic import Memberstack DOM to prevent blocking page load
import('@memberstack/dom').then(m => {
  window.__memberstackDOM = m.default || m;
}).catch(error => {
  console.error('[Memberstack] ❌ Failed to import SDK:', error);
  console.error('[Memberstack] Error details:', {
    message: error.message,
    stack: error.stack,
    name: error.name
  });
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

// Memberstack public key
// Test Mode: pk_sb_xxxxx (starts with pk_sb_)
// Production Mode: pk_live_xxxxx (starts with pk_live_)
// Set via environment variable: VITE_MEMBERSTACK_PUBLIC_KEY
// Current test key: pk_sb_1f9717616667ce56e24c
const MEMBERSTACK_PUBLIC_KEY = 'pk_dfac8d58db003938620d';

// Initialize Memberstack SDK instance
let memberstackInstance = null;

// Initialize Memberstack SDK (non-blocking)
function initMemberstack() {
  if (!memberstackInstance) {
    try {
      const dom = getMemberstackDOM();
      if (dom && dom.init) {
        memberstackInstance = dom.init({
          publicKey: MEMBERSTACK_PUBLIC_KEY,
          useCookies: true,                // Enable cookie persistence
          setCookieOnRootDomain: true,     // Optional: set cookies on root domain
          sessionDurationDays: 7,           // How long sessions last (7 days)
        });
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

// Cache for SDK promise and instance to prevent multiple initializations
let sdkPromise = null;
let cachedSDKInstance = null;

// Wait for Memberstack SDK to be ready (optimized for fast loading)
export async function waitForSDK() {
  // If we already have a cached instance, return it immediately
  if (cachedSDKInstance) {
    return cachedSDKInstance;
  }
  
  // If there's already a pending promise, return it (prevents multiple concurrent initializations)
  if (sdkPromise) {
    return sdkPromise;
  }
  
  // Create a new promise for SDK initialization
  sdkPromise = (async () => {
    // Wait for dynamic import to complete
    let importAttempts = 0;
    const maxImportAttempts = 20; // Increased from 10
    while (!window.__memberstackDOM && importAttempts < maxImportAttempts) {
      await new Promise(resolve => setTimeout(resolve, 100));
      importAttempts++;
    }
    
    // Initialize SDK
    const memberstack = initMemberstack();
    
    if (memberstack) {
      // If SDK has required methods, return immediately (don't wait for onReady)
      if (memberstack.getCurrentMember || memberstack.member || memberstack.loginWithEmail) {
        // Try to wait for onReady with a longer timeout
        if (memberstack.onReady && typeof memberstack.onReady.then === 'function') {
          // Race between onReady and a longer timeout
          try {
            await Promise.race([
              memberstack.onReady,
              new Promise(resolve => setTimeout(resolve, 3000)) // 3 second max wait
            ]);
          } catch (error) {
            // Continue anyway - SDK might still work
          }
        }
        cachedSDKInstance = memberstack;
        return memberstack;
      } else {
        console.warn('[Memberstack] SDK instance created but missing required methods');
      }
    } else {
      console.warn('[Memberstack] SDK instance not created');
    }
    
    // Fallback: Polling with more attempts
    let pollAttempts = 0;
    const maxAttempts = 20; // Increased from 10
    const interval = 150; // Slightly longer interval
    
    while (pollAttempts < maxAttempts) {
      const sdk = getMemberstackSDK();
      
      if (sdk) {
        if (sdk.getCurrentMember || sdk.member || sdk.loginWithEmail) {
          cachedSDKInstance = sdk;
          return sdk;
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, interval));
      pollAttempts++;
    }
    
    console.warn('[Memberstack] Polling failed after', maxAttempts, 'attempts');
    
    // Final check
    const finalSDK = getMemberstackSDK();
    if (finalSDK) {
      cachedSDKInstance = finalSDK;
    }
    return finalSDK;
  })();
  
  try {
    const result = await sdkPromise;
    return result;
  } catch (error) {
    // Clear promise on error so it can be retried
    sdkPromise = null;
    throw error;
  }
}

// Check if user is logged in via Memberstack
export async function checkMemberstackSession() {
  try {
    const memberstack = await waitForSDK();
    
    if (!memberstack) {
      return null;
    }
    
    // Wait for SDK to be ready with timeout (don't wait indefinitely)
    if (memberstack.onReady && typeof memberstack.onReady.then === 'function') {
      try {
        await Promise.race([
          memberstack.onReady,
          new Promise(resolve => setTimeout(resolve, 3000)) // 3 second timeout
        ]);
      } catch (error) {
        // Continue anyway - SDK might still work
      }
    } else {
      // If onReady is not available, wait a bit for SDK to initialize
      await new Promise(resolve => setTimeout(resolve, 800));
    }
    
    // Get current member - try multiple methods
    let member = null;
    
    // Method 1: memberstack.getCurrentMember (npm package method)
    if (memberstack.getCurrentMember && typeof memberstack.getCurrentMember === 'function') {
      try {
        const memberResult = await memberstack.getCurrentMember();
        member = memberResult;
      } catch (error) {
        // Continue to try other methods
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
        // Continue to try other methods
      }
    }
    
    // Method 3: window.memberstack.getCurrentMember (fallback for script tag)
    if ((!member || !member.id) && window.memberstack && window.memberstack.getCurrentMember) {
      try {
        member = await window.memberstack.getCurrentMember();
      } catch (error) {
        // Continue to try other methods
      }
    }
    
    // Handle Memberstack v2 SDK response structure: {data: {...}}
    if (member && member.data) {
      member = member.data;
    }
    
    // Accept member if we have ID or email
    if (member && (member.id || member._id || member.email || member._email || member.data?.email || member.data?.auth?.email)) {
      return member;
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

// Get user email from Memberstack member (normalized like reference dashboard)
export function getUserEmail(member) {
  if (!member) return null;
  
  // Try multiple possible email fields (matching reference dashboard)
  // Check in order of most likely locations
  const email = member.data?.auth?.email || 
                member.data?.auth?.user?.email ||
                member.data?.email || 
                member.data?.user?.email ||
                member.email || 
                member._email ||
                member.user?.email ||
                member.auth?.email ||
                member.auth?.user?.email ||
                null;
  
  // Normalize email (lowercase and trim) - matching reference dashboard
  if (email) {
    const normalized = email.toLowerCase().trim();
    return normalized;
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
      try {
        const response = await memberstack.loginMemberEmailPassword({ email, password });
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
      try {
        const response = await memberstack.signupMemberEmailPassword({ email, password });
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
    
    // Method 1: Try sendMemberLoginPasswordlessEmail first (for existing members)
    let loginError = null;
    let loginErrorCode = null;
    
    if (memberstack.sendMemberLoginPasswordlessEmail && typeof memberstack.sendMemberLoginPasswordlessEmail === 'function') {
      try {
        const response = await memberstack.sendMemberLoginPasswordlessEmail({ email });
        
        if (response && response.data) {
          return { success: true, data: response.data };
        } else if (response && response.errors && response.errors.length > 0) {
          const errorMessage = response.errors[0]?.message || response.errors[0] || 'Failed to send code';
          const errorCode = response.errors[0]?.code || '';
          
          // Store error but continue to try signup if member not found
          if (errorMessage.toLowerCase().includes('not found') || 
              errorMessage.toLowerCase().includes('does not exist') ||
              errorCode === 'MEMBER_NOT_FOUND' ||
              errorCode === 'passwordless-email-not-found') {
            loginError = errorMessage;
            loginErrorCode = errorCode;
          } else {
            return { success: false, error: errorMessage };
          }
        } else {
          // No errors, assume success
          return { success: true };
        }
      } catch (error) {
        // Extract error message and code - handle different error structures
        const errorMessage = error.message || (error.errors && error.errors[0]?.message) || error.toString() || 'Failed to send code';
        const errorCode = error.code || (error.errors && error.errors[0]?.code) || '';
        
        // If member not found, try signup method
        // Check for passwordless-email-not-found which means member exists but not configured for passwordless
        if (errorMessage.toLowerCase().includes('not found') || 
            errorMessage.toLowerCase().includes('does not exist') ||
            errorCode === 'MEMBER_NOT_FOUND' ||
            errorCode === 'passwordless-email-not-found') {
          loginError = errorMessage;
          loginErrorCode = errorCode;
        } else {
          // For other errors, still try signup as fallback
          loginError = errorMessage;
          loginErrorCode = errorCode;
        }
      }
    }
    
    // Method 1b: Try sendMemberSignupPasswordlessEmail (for new members or if login failed with "not found")
    // This method can work for existing members too - it will send a code if the member exists
    if (memberstack.sendMemberSignupPasswordlessEmail && typeof memberstack.sendMemberSignupPasswordlessEmail === 'function') {
      try {
        const response = await memberstack.sendMemberSignupPasswordlessEmail({ email });
        
        if (response && response.data) {
          return { success: true, data: response.data };
        } else if (response && response.errors && response.errors.length > 0) {
          const errorMessage = response.errors[0]?.message || response.errors[0] || 'Failed to send code';
          const errorCode = response.errors[0]?.code || '';
          
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
          return { success: true };
        } else if (response === true || response === false) {
          // Boolean response
          return { success: response };
        } else {
          // Any other response structure - assume success if no errors
          return { success: true };
        }
      } catch (error) {
        const errorMessage = error.message || error.toString() || 'Failed to send code';
        const errorCode = error.code || '';
        
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
      return { 
        success: false, 
        error: `The email is not set up for passwordless login. Error: ${loginError}. Please configure passwordless authentication in Memberstack or use an alternative login method.` 
      };
    }
    
    // Method 2: Check if methods are nested in different structure
    if (memberstack.auth && typeof memberstack.auth === 'object') {
      if (memberstack.auth.loginWithEmail && typeof memberstack.auth.loginWithEmail === 'function') {
        try {
          const response = await memberstack.auth.loginWithEmail({ email });
          return { success: true, data: response };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    }
    
    // Method 3: passwordless methods
    if (memberstack.passwordless && typeof memberstack.passwordless === 'object') {
      if (memberstack.passwordless.sendCode && typeof memberstack.passwordless.sendCode === 'function') {
        try {
          await memberstack.passwordless.sendCode({ email });
          return { success: true };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    }
    
    // Method 4: sendMagicLink
    if (memberstack.sendMagicLink && typeof memberstack.sendMagicLink === 'function') {
      try {
        await memberstack.sendMagicLink({ email });
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
    
    // Method 5: Try direct API call if SDK methods don't work
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
      // API call failed, continue to return error
    }
    
    return { success: false, error: 'Login method not available' };
  } catch (error) {
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
      try {
        const response = await memberstack.loginMemberPasswordless({ email, passwordlessToken: code });
        if (response && response.data) {
          return { success: true, data: response.data };
        } else if (response && response.errors) {
          return { success: false, error: response.errors[0]?.message || 'Invalid code' };
        }
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message || 'Verification failed' };
      }
    }
    
    // Fallback methods
    if (memberstack.verifyCode && typeof memberstack.verifyCode === 'function') {
      try {
        const result = await memberstack.verifyCode({ email, code });
        return { success: !!result, data: result };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
    
    return { success: false, error: 'Verification method not available' };
  } catch (error) {
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
    
    // Try different methods to open login modal
    // Method 1: openModal (common in Memberstack SDK)
    if (memberstack.openModal && typeof memberstack.openModal === 'function') {
      await memberstack.openModal('login');
      return;
    }
    
    // Method 2: modal (alternative method)
    if (memberstack.modal && typeof memberstack.modal === 'function') {
      await memberstack.modal('login');
      return;
    }
    
    // Method 3: login (direct login method)
    if (memberstack.login && typeof memberstack.login === 'function') {
      await memberstack.login();
      return;
    }
    
    // Method 4: Check for UI methods
    if (memberstack.ui && typeof memberstack.ui === 'object') {
      if (memberstack.ui.open && typeof memberstack.ui.open === 'function') {
        await memberstack.ui.open('login');
        return;
      }
      if (memberstack.ui.login && typeof memberstack.ui.login === 'function') {
        await memberstack.ui.login();
        return;
      }
    }
    
    // If no modal method found, redirect to login page
    window.location.href = '/';
  } catch (error) {
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
      return true;
    }
    
    return false;
  } catch (error) {
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
    // Get Memberstack SDK instance
    const memberstack = await waitForSDK();
    
    // Step 1: Call Memberstack logout method (this handles server-side session)
    // The SDK logout method handles server-side session cleanup automatically
    if (memberstack && memberstack.logout && typeof memberstack.logout === 'function') {
      try {
        // SDK logout handles server-side session - no options needed
        await memberstack.logout();
      } catch (logoutError) {
        // Continue with cleanup even if logout fails
      }
    }
    
    // Step 2: Clear all Memberstack-related localStorage items
    const localStorageKeys = Object.keys(localStorage);
    localStorageKeys.forEach(key => {
      if (key.startsWith('_ms-') || key.startsWith('memberstack-') || key.includes('memberstack')) {
        localStorage.removeItem(key);
      }
    });
    
    // Step 3: Clear all Memberstack-related sessionStorage items
    const sessionStorageKeys = Object.keys(sessionStorage);
    sessionStorageKeys.forEach(key => {
      if (key.startsWith('_ms-') || key.startsWith('memberstack-') || key.includes('memberstack')) {
        sessionStorage.removeItem(key);
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
    });
    
    // Step 5: Dispatch logout event for UI updates
    try {
      window.dispatchEvent(new CustomEvent('memberstack:logout'));
    } catch (eventError) {
      // Event dispatch failed, continue anyway
    }
    
    // Step 6: Clear any cached session data
    if (window.memberstackSessionCache) {
      delete window.memberstackSessionCache;
    }
    
    // Step 7: Redirect to login page (home page)
    // Small delay to ensure all cleanup completes
    setTimeout(() => {
      window.location.href = '/';
    }, 100);
    
  } catch (error) {
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
    } catch (cleanupError) {
      // Cleanup failed, continue to redirect
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
        // Set cookie for future requests (12 hours = 43200 seconds)
        document.cookie = `sb_session=${data.token}; path=/; max-age=43200; SameSite=Lax`;
        return data.token;
      }
    }
  } catch (error) {
    // API call failed, return null
  }
  
  return null;
}

export async function sendSignupPasswordlessEmail(email) {
  try {
    const memberstack = await waitForSDK();

    if (!memberstack) {
      return { success: false, error: "Memberstack SDK not available" };
    }

    // ✅ CORRECT METHOD FOR NEW USERS
    if (
      memberstack.sendMemberSignupPasswordlessEmail &&
      typeof memberstack.sendMemberSignupPasswordlessEmail === "function"
    ) {
      const response = await memberstack.sendMemberSignupPasswordlessEmail({
        email,
      });

      // MemberStack sometimes returns null/undefined on success
      if (!response || response?.data) {
        return { success: true };
      }

      if (response?.errors?.length) {
        return {
          success: false,
          error: response.errors[0]?.message || "Signup failed",
        };
      }

      return { success: true };
    }

    return {
      success: false,
      error: "Passwordless signup not enabled in Memberstack",
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || "Unknown error",
    };
  }
}
export async function verifySignupCode(email, code) {
  try {
    const memberstack = await waitForSDK();
    
    if (!memberstack) {
      console.error('[Memberstack] SDK not available for verifying code');
      return { success: false, error: 'SDK not available' };
    }

    // Method 1: signupMemberPasswordless (correct Memberstack method)
    if (memberstack.signupMemberPasswordless && typeof memberstack.signupMemberPasswordless === 'function') {
      try {
        const response = await memberstack.signupMemberPasswordless({ email, passwordlessToken: code });
        if (response && response.data) {
          return { success: true, data: response.data };
        } else if (response && response.errors) {
          return { success: false, error: response.errors[0]?.message || 'Invalid code' };
        }
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message || 'Verification failed' };
      }
    }
    
    // Fallback methods
    if (memberstack.verifyCode && typeof memberstack.verifyCode === 'function') {
      try {
        const result = await memberstack.verifyCode({ email, code });
        return { success: !!result, data: result };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
    
    return { success: false, error: 'Verification method not available' };
  } catch (error) {
    return { success: false, error: error.message || 'Unknown error' };
  }
}