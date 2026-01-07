import { useState, useEffect, useMemo } from 'react';
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
    let isChecking = false; // Guard to prevent concurrent checks

    async function checkSession(skipLoadingState = false) {
      // Prevent concurrent session checks
      if (isChecking) {
        return;
      }
      
      try {
        isChecking = true;
        // Only set loading state if explicitly requested (prevents flickering on login page)
        if (!skipLoadingState) {
          setLoading(true);
        }
        setError(null);

        // Memberstack SDK is now initialized programmatically via @memberstack/dom
        // No need to check for script tag

        // Wait for SDK with longer timeout to ensure it loads properly
        const memberstack = await Promise.race([
          waitForSDK(),
          new Promise((resolve) => setTimeout(() => resolve(null), 5000)) // 5 second timeout
        ]);

        if (!memberstack) {
          // SDK not loaded yet after timeout - show login prompt anyway
          if (mounted) {
            setMember(null);
            setLoading(false);
            setError('SDK failed to load. Please refresh the page.');
            // Will retry when memberstack:ready event fires
          }
          isChecking = false;
          return;
        }
        

        // Check session
        const currentMember = await checkMemberstackSession();
        
        if (mounted) {
          // Update state if member changed - use deep comparison to detect profile updates
          setMember(prevMember => {
            // If no previous member, always update (first load)
            if (!prevMember) {
              return currentMember;
            }
            
            // If no current member but we had one before, clear it (session expired/logged out)
            // Always clear when currentMember is null to prevent unauthorized access
            if (!currentMember) {
              return null; // Clear member when session is invalid
            }
            
            // Compare IDs first (fast check)
            const prevId = prevMember?.id || prevMember?._id;
            const newId = currentMember?.id || currentMember?._id;
            
            // If IDs are different, definitely update
            if (prevId !== newId) {
              return currentMember;
            }
            
            // If IDs are same, do a deep comparison using JSON.stringify
            // Only update if the actual data structure changed (not just object reference)
            const prevStr = JSON.stringify(prevMember);
            const newStr = JSON.stringify(currentMember);
            
            if (prevStr !== newStr) {
              // Only log if key fields changed (not just object reference)
              const prevEmail = getUserEmail(prevMember);
              const newEmail = getUserEmail(currentMember);
              const prevName = prevMember?.name || prevMember?.data?.name || prevMember?.firstName;
              const newName = currentMember?.name || currentMember?.data?.name || currentMember?.firstName;
              const prevPlan = prevMember?.plan || prevMember?.data?.plan;
              const newPlan = currentMember?.plan || currentMember?.data?.plan;
              
              return currentMember;
            }
            
            // If nothing changed, return previous to prevent re-render
            return prevMember;
          });
          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError(err.message);
          setMember(null);
          setLoading(false);
        }
      } finally {
        isChecking = false;
      }
    }

    checkSession();

    // Set up authentication state listener (from Memberstack docs)
    let authUnsubscribe = null;
    let lastAuthCheck = 0;
    const AUTH_CHECK_THROTTLE = 1000; // Only check once per second
    
    async function setupAuthListener() {
      try {
        const memberstack = await waitForSDK();
        if (memberstack && memberstack.onAuthChange && typeof memberstack.onAuthChange === 'function') {
          authUnsubscribe = memberstack.onAuthChange((authData) => {
            if (mounted) {
              const now = Date.now();
              // Throttle auth change checks to prevent excessive calls
              if (now - lastAuthCheck > AUTH_CHECK_THROTTLE) {
                lastAuthCheck = now;
                checkSession();
              }
            }
          });
        }
      } catch (error) {
        console.warn('[Memberstack] Failed to setup auth listener:', error);
      }
    }
    setupAuthListener();

    // Session management: Check and refresh session periodically
    // Only refresh when session is actually expired - don't refresh member data unnecessarily
    // Only run if we have a member (don't check on login page)
    const sessionCheckInterval = setInterval(async () => {
      if (mounted && member) {
        try {
          const expired = await isSessionExpired();
          if (expired) {
            await refreshSession();
            checkSession(true); // Skip loading state
          }
          // Don't refresh member data if session is not expired
          // This prevents unnecessary re-renders in Profile component
        } catch (err) {
          console.warn('[Memberstack] Session check error:', err);
        }
      }
    }, 10 * 60 * 1000); // Check every 10 minutes (only check if session expired, don't refresh data)

    // Session refresh on visibility change (when user returns to tab)
    // Add debounce to prevent excessive calls
    let visibilityTimeout = null;
    let lastVisibilityCheck = 0;
    const VISIBILITY_CHECK_THROTTLE = 5000; // Only check every 5 seconds
    
    const handleVisibilityChange = () => {
      if (!document.hidden && mounted) {
        const now = Date.now();
        // Throttle visibility checks to prevent excessive calls
        if (now - lastVisibilityCheck < VISIBILITY_CHECK_THROTTLE) {
          return;
        }
        lastVisibilityCheck = now;
        
        // Clear any pending timeout
        if (visibilityTimeout) {
          clearTimeout(visibilityTimeout);
        }
        // Debounce: only check after 1 second of being visible
        visibilityTimeout = setTimeout(() => {
          if (mounted && !document.hidden) {
            // Only refresh if we have a member (don't check on login page)
            if (member) {
              refreshSession().then(() => {
                if (mounted) {
                  checkSession(true); // Skip loading state
                }
              }).catch(err => {
                console.warn('[useMemberstack] Visibility change refresh failed:', err);
              });
            }
          }
        }, 1000);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Listen for Memberstack events
    let readyEventThrottle = 0;
    const handleMemberstackReady = () => {
      const now = Date.now();
      // Throttle ready event to prevent excessive checks
      if (now - readyEventThrottle > 2000) {
        readyEventThrottle = now;
        checkSession();
      }
    };

    window.addEventListener('memberstack:ready', handleMemberstackReady);
    
    // Handle login event - immediately check session and update state
    let loginEventHandled = false;
    let loginEventTimeout = null;
    const handleLogin = async () => {
      if (mounted && !loginEventHandled) {
        loginEventHandled = true;
        
        // Clear any pending timeout
        if (loginEventTimeout) {
          clearTimeout(loginEventTimeout);
        }
        
        // Wait a bit for session to be established, then check
        // Use skipLoadingState to prevent flickering
        loginEventTimeout = setTimeout(async () => {
          if (mounted) {
            await checkSession(true); // Skip loading state to prevent flicker
          }
          // Reset flag after check completes
          loginEventHandled = false;
        }, 500);
      }
    };
    window.addEventListener('memberstack:login', handleLogin);
    
    // Handle logout event - clear member state immediately
    const handleLogout = () => {
      if (mounted) {
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
      if (visibilityTimeout) {
        clearTimeout(visibilityTimeout);
      }
      if (loginEventTimeout) {
        clearTimeout(loginEventTimeout);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('memberstack:ready', handleMemberstackReady);
      window.removeEventListener('memberstack:login', handleLogin);
      window.removeEventListener('memberstack:logout', handleLogout);
    };
  }, []);

  // Memoize userEmail to prevent recalculating on every render
  // Only recalculate when member actually changes
  const userEmail = useMemo(() => {
    if (!member) return null;
    const email = getUserEmail(member);
    return email;
  }, [member]);

  return {
    member,
    userEmail,
    isAuthenticated: !!member,
    loading,
    error,
  };
}

