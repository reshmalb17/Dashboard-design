import { useState, useEffect } from 'react';
import { checkMemberstackSession, getUserEmail, waitForSDK, refreshSession, isSessionExpired } from '../services/memberstack';

/**
 * Custom hook for Memberstack authentication
 * Returns user state and loading status
 */
export function useMemberstack() {
  const [member, setMember] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;

    async function checkSession() {
      try {
        setLoading(true);
        setError(null);

        // Memberstack SDK is now initialized programmatically via @memberstack/dom
        // No need to check for script tag

        // Wait for SDK with shorter timeout (optimized for fast loading)
        const memberstack = await Promise.race([
          waitForSDK(),
          new Promise((resolve) => setTimeout(() => resolve(null), 2000)) // 2 second timeout - show UI faster
        ]);

        if (!memberstack) {
          // SDK not loaded yet after timeout - show login prompt anyway
          console.warn('[Memberstack] SDK not loaded after timeout, showing login prompt');
          if (mounted) {
            setMember(null);
            setLoading(false);
            // Will retry when memberstack:ready event fires
          }
          return;
        }

        // Check session
        const currentMember = await checkMemberstackSession();
        
        if (mounted) {
          setMember(currentMember);
          setLoading(false);
        }
      } catch (err) {
        console.error('[useMemberstack] Error:', err);
        if (mounted) {
          setError(err.message);
          setMember(null);
          setLoading(false);
        }
      }
    }

    checkSession();

    // Set up authentication state listener (from Memberstack docs)
    let authUnsubscribe = null;
    async function setupAuthListener() {
      try {
        const memberstack = await waitForSDK();
        if (memberstack && memberstack.onAuthChange && typeof memberstack.onAuthChange === 'function') {
          authUnsubscribe = memberstack.onAuthChange((authData) => {
            if (mounted) {
              console.log('[Memberstack] Auth state changed:', authData);
              checkSession();
            }
          });
        }
      } catch (error) {
        console.warn('[Memberstack] Failed to setup auth listener:', error);
      }
    }
    setupAuthListener();

    // Session management: Check and refresh session periodically
    const sessionCheckInterval = setInterval(async () => {
      if (mounted) {
        const expired = await isSessionExpired();
        if (expired && member) {
          console.log('[Memberstack] Session expired, refreshing...');
          await refreshSession();
          checkSession();
        }
      }
    }, 5 * 60 * 1000); // Check every 5 minutes

    // Session refresh on visibility change (when user returns to tab)
    const handleVisibilityChange = () => {
      if (!document.hidden && mounted) {
        refreshSession().then(() => {
          if (mounted) {
            checkSession();
          }
        });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Listen for Memberstack events
    const handleMemberstackReady = () => {
      checkSession();
    };

    window.addEventListener('memberstack:ready', handleMemberstackReady);
    
    // Handle login event - immediately check session and update state
    const handleLogin = async () => {
      if (mounted) {
        console.log('[useMemberstack] Login event received, checking session immediately');
        // Wait a bit for session to be established, then check
        setTimeout(async () => {
          if (mounted) {
            console.log('[useMemberstack] Re-checking session after login event');
            await checkSession();
          }
        }, 100);
        // Also check immediately
        await checkSession();
      }
    };
    window.addEventListener('memberstack:login', handleLogin);
    
    // Handle logout event - clear member state immediately
    const handleLogout = () => {
      if (mounted) {
        console.log('[useMemberstack] Logout event received, clearing member state');
        setMember(null);
        setLoading(false);
        setError(null);
      }
    };
    window.addEventListener('memberstack:logout', handleLogout);

    return () => {
      mounted = false;
      if (authUnsubscribe && typeof authUnsubscribe.unsubscribe === 'function') {
        authUnsubscribe.unsubscribe();
      }
      clearInterval(sessionCheckInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('memberstack:ready', handleMemberstackReady);
      window.removeEventListener('memberstack:login', handleLogin);
      window.removeEventListener('memberstack:logout', handleLogout);
    };
  }, []);

  return {
    member,
    userEmail: getUserEmail(member),
    isAuthenticated: !!member,
    loading,
    error,
  };
}

