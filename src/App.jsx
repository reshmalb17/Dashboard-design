import { useState, useEffect, useMemo, useRef } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useMemberstack } from './hooks/useMemberstack';
import { useDashboardData, useLicenses, useInvoices, queryKeys } from './hooks/useDashboardQueries';
import { useNotification } from './hooks/useNotification';
import { queryClient } from './lib/queryClient';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import Sites from './components/Sites';
import Licenses from './components/Licenses';
import Profile from './components/Profile';
import PurchaseLicenseModal from './components/PurchaseLicenseModal';
import AddDomainModal from './components/AddDomainModal';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPrompt from './components/LoginPrompt';
import Notification from './components/Notification';
import consentLogo from './assets/consent-logo.svg';
import exportIcon from './assets/export-icon.svg';
import DashboardSkeleton from './components/DashboardSkeleton';
import './App.css';
import MemberstackSignup from './components/MemberstackSignup';

// Login route component - uses existing LoginPrompt, redirects to dashboard if authenticated
function LoginRoute() {
  const { isAuthenticated, userEmail, loading: authLoading } = useMemberstack();
const [loginScreen, setLoginScreen] = useState(true); // Force re-render on auth state change
if (authLoading) {
    return (
     <div className="auth-loader">
  <div className="spinner" />
</div>

    );
  }


  // Redirect to dashboard if already authenticated (only after loading completes)
  if (!authLoading && isAuthenticated && userEmail) {
    return <Navigate to="/dashboard" replace />;
  }

  // Show login page using existing LoginPrompt component (even during loading)
  return (
    <div className="login-container">
   { loginScreen &&  <LoginPrompt setLoginScreen={setLoginScreen} />}
   {!loginScreen && <MemberstackSignup setLoginScreen={setLoginScreen} /> }
    </div>
  );
}

function DashboardPage() {
  const { member, userEmail, isAuthenticated, loading: authLoading, error: authError } = useMemberstack();
  const { notification, showSuccess, showError, clear: clearNotification } = useNotification();
  const queryClient = useQueryClient();
const initialRender = useRef(true);
  const [maxTimeoutReached, setMaxTimeoutReached] = useState(false);
  const [activeSection, setActiveSection] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false);
  const [addDomainModalOpen, setAddDomainModalOpen] = useState(false);
  const [isPollingLicenses, setIsPollingLicenses] = useState(false);
  const [isPollingDomains, setIsPollingDomains] = useState(false);
  
  const queriesEnabled = isAuthenticated && !!userEmail;
  
  // Invoice state - using TanStack Query for caching
  const [invoiceOffset, setInvoiceOffset] = useState(0);
  const INVOICES_PER_PAGE = 10;
  const invoicesQuery = useInvoices(userEmail, INVOICES_PER_PAGE, 0, {
    enabled: queriesEnabled,
  });
  
  // Aggregate invoices from cache (for pagination)
  const invoices = invoicesQuery.data?.invoices || [];
  const invoicesLoading = invoicesQuery.isLoading;
  const invoicesError = invoicesQuery.error;
  const hasMoreInvoices = invoicesQuery.data?.hasMore || false;
  const totalInvoices = invoicesQuery.data?.total || 0;
  
  // Listen for purchase completion and refetch invoices
  useEffect(() => {
    if (!userEmail) return;

    let lastPendingPurchase = sessionStorage.getItem('pendingLicensePurchase');
    let lastPendingSitesPurchase = sessionStorage.getItem('pendingSitesPurchase');
    let intervalId = null;

    const checkForPurchaseCompletion = () => {
      const currentPendingPurchase = sessionStorage.getItem('pendingLicensePurchase');
      const currentPendingSitesPurchase = sessionStorage.getItem('pendingSitesPurchase');
      
      // If pending purchase was removed, purchase completed
      if ((lastPendingPurchase && !currentPendingPurchase) || 
          (lastPendingSitesPurchase && !currentPendingSitesPurchase)) {
        // Wait a bit for Stripe webhook to create invoice, then refetch
        setTimeout(async () => {
          // Force refetch the first page of invoices to get new invoices
          // Using refetchQueries to bypass staleTime: Infinity
          await queryClient.refetchQueries({ 
            queryKey: ['invoices', userEmail, 10, 0],
            type: 'active'
          });
          
          // Also invalidate all invoice queries for this user to clear cache
          queryClient.invalidateQueries({ 
            queryKey: ['invoices', userEmail]
          });
        }, 5000); // Wait 5 seconds for Stripe webhook to process
        
        // Stop polling once purchase completed
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      }
      
      lastPendingPurchase = currentPendingPurchase;
      lastPendingSitesPurchase = currentPendingSitesPurchase;
    };

    // Only poll if there's a pending purchase
    if (lastPendingPurchase || lastPendingSitesPurchase) {
      intervalId = setInterval(checkForPurchaseCompletion, 2000); // Check every 2 seconds
    }

    // Also check when component becomes visible (user returns from Stripe checkout)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkForPurchaseCompletion();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [userEmail, queryClient]);

  // Poll for new licenses after purchase (only updates licenses table)
  const startLicensePolling = (email, expectedQuantity) => {
    let pollCount = 0;
    const maxPolls = 30;
    const pollInterval = 10000;

    const pollForLicenses = async () => {
      pollCount++;

      try {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.licenses(email),
          refetchType: 'active',
        });

        await new Promise((resolve) => setTimeout(resolve, 500));

        const licensesData = queryClient.getQueryData(queryKeys.licenses(email));
        const currentLicenseCount = licensesData?.licenses?.length || 0;

        const previousCount = parseInt(
          sessionStorage.getItem('licenseCountBeforePurchase') || '0',
          10
        );

        if (currentLicenseCount >= previousCount + expectedQuantity) {
          showSuccess(`Successfully added ${expectedQuantity} license key(s)!`);
          sessionStorage.removeItem('licenseCountBeforePurchase');
          setIsPollingLicenses(false);
          return;
        }

        if (pollCount < maxPolls) {
          setTimeout(pollForLicenses, pollInterval);
        } else {
          showSuccess(
            'Your purchase is being processed. License keys will appear shortly.'
          );
          sessionStorage.removeItem('licenseCountBeforePurchase');
          setIsPollingLicenses(false);
        }
      } catch (error) {
        if (pollCount < maxPolls) {
          setTimeout(pollForLicenses, pollInterval);
        } else {
          setIsPollingLicenses(false);
        }
      }
    };

    const licensesData = queryClient.getQueryData(queryKeys.licenses(email));
    const currentCount = licensesData?.licenses?.length || 0;
    sessionStorage.setItem('licenseCountBeforePurchase', currentCount.toString());

    // Optimistic placeholders so UI updates immediately
    if (licensesData) {
      queryClient.setQueryData(queryKeys.licenses(email), (old) => {
        const existing = old?.licenses || [];
        const placeholders = Array.from({ length: expectedQuantity }).map((_, idx) => ({
          id: `temp-${Date.now()}-${idx}`,
          license_key: 'Processing...',
          status: 'processing',
        }));
        return {
          ...old,
          licenses: [...existing, ...placeholders],
        };
      });
    }

    setTimeout(pollForLicenses, 5000);
  };

  // Poll for new domains after purchase (updates dashboard data smoothly)
  const startDomainPolling = (email, expectedDomains, expectedCount) => {
    let pollCount = 0;
    const maxPolls = 30;
    const pollInterval = 10000;

    const pollForDomains = async () => {
      pollCount++;

      try {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.dashboard(email),
          refetchType: 'active',
        });

        await new Promise((resolve) => setTimeout(resolve, 500));

        const dashboardData = queryClient.getQueryData(queryKeys.dashboard(email));
        const currentSites = dashboardData?.sites || {};
        const currentSitesCount = Object.keys(currentSites).length;

        const previousCount = parseInt(
          sessionStorage.getItem('sitesCountBeforePurchase') || '0',
          10
        );

        const foundDomains = expectedDomains.filter((domain) => {
          const domainKey = domain.trim().toLowerCase();
          return Object.keys(currentSites).some((siteKey) => {
            const key = siteKey.toLowerCase();
            return (
              key === domainKey ||
              key.includes(domainKey) ||
              domainKey.includes(key)
            );
          });
        });

        if (foundDomains.length >= expectedCount || currentSitesCount > previousCount) {
          showSuccess(`Successfully added ${expectedCount} domain(s)!`);
          sessionStorage.removeItem('sitesCountBeforePurchase');
          setIsPollingDomains(false);
          return;
        }

        if (pollCount < maxPolls) {
          setTimeout(pollForDomains, pollInterval);
        } else {
          showSuccess(
            'Your purchase is being processed. Domains will appear shortly.'
          );
          sessionStorage.removeItem('sitesCountBeforePurchase');
          setIsPollingDomains(false);
        }
      } catch (error) {
        if (pollCount < maxPolls) {
          setTimeout(pollForDomains, pollInterval);
        } else {
          setIsPollingDomains(false);
        }
      }
    };

    const dashboardData = queryClient.getQueryData(queryKeys.dashboard(email));
    const currentSites = dashboardData?.sites || {};
    const currentCount = Object.keys(currentSites).length;
    sessionStorage.setItem('sitesCountBeforePurchase', currentCount.toString());

    setTimeout(pollForDomains, 5000);
  };


  // Handle return from Stripe
  useEffect(() => {
    if (!userEmail || !isAuthenticated) return;

    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session_id');
    const canceled = urlParams.get('canceled');

    // Check if we're in a popup window (opened from parent)
    // If so, notify parent and close popup
    if (window.opener && !window.opener.closed) {
      if (sessionId) {
        // Payment successful - notify parent window
        window.opener.postMessage({
          type: 'PAYMENT_SUCCESS',
          sessionId: sessionId
        }, window.location.origin);
        
        // Close popup after a short delay to ensure message is sent
        setTimeout(() => {
          window.close();
        }, 500);
        
        // Clear URL params
        window.history.replaceState({}, document.title, window.location.pathname);
        return; // Don't process further in popup
      } else if (canceled) {
        // Payment cancelled - notify parent
        window.opener.postMessage({
          type: 'PAYMENT_CANCELLED'
        }, window.location.origin);
        
        setTimeout(() => {
          window.close();
        }, 500);
        
        window.history.replaceState({}, document.title, window.location.pathname);
        return;
      }
    }

    const pendingLicensePurchase = sessionStorage.getItem('pendingLicensePurchase');
    const pendingDomainPurchase = sessionStorage.getItem('pendingDomainPurchase');
    const pendingSitesPurchase = sessionStorage.getItem('pendingSitesPurchase');

    if (sessionId && pendingLicensePurchase) {
      const purchaseInfo = JSON.parse(pendingLicensePurchase);
      // DON'T remove pendingLicensePurchase here - let Dashboard component handle it
      // sessionStorage.removeItem('pendingLicensePurchase'); // REMOVED
    
      showSuccess(
        `Payment successful! Processing ${purchaseInfo.quantity} license key(s)...`
      );
    
      setIsPollingLicenses(true);
      startLicensePolling(userEmail, purchaseInfo.quantity);
    
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (sessionId && pendingDomainPurchase) {
      const purchaseInfo = JSON.parse(pendingDomainPurchase);
      sessionStorage.removeItem('pendingDomainPurchase');

      showSuccess(
        `Payment successful! Processing ${purchaseInfo.count} domain(s)...`
      );

      setIsPollingDomains(true);
      startDomainPolling(userEmail, purchaseInfo.domains, purchaseInfo.count);

      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (sessionId && pendingSitesPurchase) {
      const purchaseInfo = JSON.parse(pendingSitesPurchase);
      sessionStorage.removeItem('pendingSitesPurchase');

      showSuccess(
        `Payment successful! Processing ${purchaseInfo.sites?.length || 0} site(s)...`
      );

      setIsPollingDomains(true);
      startDomainPolling(userEmail, purchaseInfo.sites || [], purchaseInfo.sites?.length || 0);

      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (sessionId) {
      // Direct payment link purchase (no pendingLicensePurchase in sessionStorage)
      // Still need to refetch licenses to show newly purchased ones
      showSuccess('Payment successful! Processing your purchase...');

      // Force refetch licenses to get newly purchased ones (bypass staleTime: Infinity)
      queryClient.refetchQueries({
        queryKey: queryKeys.licenses(userEmail),
        type: 'active',
      });

      // Also refetch dashboard to refresh all data
      queryClient.refetchQueries({
        queryKey: queryKeys.dashboard(userEmail),
        type: 'active',
      });

      // Start polling for licenses (without knowing exact quantity)
      // Check for new licenses by comparing counts
      const licensesData = queryClient.getQueryData(queryKeys.licenses(userEmail));
      const currentCount = licensesData?.licenses?.length || 0;
      sessionStorage.setItem('licenseCountBeforePurchase', currentCount.toString());

      // Poll for new licenses
      setIsPollingLicenses(true);
      let pollCount = 0;
      const maxPolls = 30;
      const pollInterval = 10000;

      const pollForLicenses = async () => {
        pollCount++;

        try {
          // Force refetch licenses (bypass staleTime: Infinity)
          await queryClient.refetchQueries({
            queryKey: queryKeys.licenses(userEmail),
            type: 'active',
          });

          await new Promise((resolve) => setTimeout(resolve, 500));

          const licensesData = queryClient.getQueryData(queryKeys.licenses(userEmail));
          const currentLicenseCount = licensesData?.licenses?.length || 0;

          const previousCount = parseInt(
            sessionStorage.getItem('licenseCountBeforePurchase') || '0',
            10
          );

          if (currentLicenseCount > previousCount) {
            const newLicensesCount = currentLicenseCount - previousCount;
            showSuccess(`Successfully added ${newLicensesCount} license key(s)!`);
            sessionStorage.removeItem('licenseCountBeforePurchase');
            setIsPollingLicenses(false);
            return;
          }

          if (pollCount < maxPolls) {
            setTimeout(pollForLicenses, pollInterval);
          } else {
            showSuccess(
              'Your purchase is being processed. License keys will appear shortly.'
            );
            sessionStorage.removeItem('licenseCountBeforePurchase');
            setIsPollingLicenses(false);
          }
        } catch (error) {
          if (pollCount < maxPolls) {
            setTimeout(pollForLicenses, pollInterval);
          } else {
            setIsPollingLicenses(false);
          }
        }
      };

      setTimeout(pollForLicenses, 5000);

      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (canceled === 'true') {
      sessionStorage.removeItem('pendingLicensePurchase');
      sessionStorage.removeItem('pendingDomainPurchase');
      showError('Payment was canceled');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [userEmail, isAuthenticated, showSuccess, showError, queryClient]);

  // Max timeout for auth
  useEffect(() => {
    if (!authLoading) {
      setMaxTimeoutReached(false);
      return;
    }
    const timeout = setTimeout(() => {
      setMaxTimeoutReached(true);
    }, 5000);
    return () => clearTimeout(timeout);
  }, [authLoading]);

  // Data queries
  const {
    data: dashboardData,
    isLoading: loadingDashboard,
    error: dashboardError,
  } = useDashboardData(userEmail, {
    enabled: queriesEnabled,
  });

  const {
    data: licensesData,
    isLoading: loadingLicenses,
    error: licensesError,
  } = useLicenses(userEmail, {
    enabled: queriesEnabled,
  });

  const sites = useMemo(() => dashboardData?.sites ?? {}, [dashboardData?.sites]);
  const licenses = useMemo(
    () => licensesData?.licenses ?? [],
    [licensesData?.licenses]
  );
  const subscriptions = useMemo(() => {
    const subs = dashboardData?.subscriptions;
    if (!subs) return Array.isArray(subs) ? [] : {};
    return subs;
  }, [dashboardData?.subscriptions]);
useEffect(() => {
  if (
    (dashboardData || dashboardError) &&
    (licensesData || licensesError)
  ) {
    initialRender.current = false;
  }
}, [dashboardData, dashboardError, licensesData, licensesError]);
  const hasCachedData = dashboardData || licensesData;
  const isFirstLoad = loadingDashboard || loadingLicenses;
  const shouldShowLoading =
  initialRender.current &&
  (loadingDashboard || loadingLicenses || authLoading);


  const error = dashboardError || licensesError || authError;
  if (error) {
    showError(error.message || 'An error occurred');
  }

  // This component should only render when authenticated (protected by route)
  // But keep the check as a safety measure
  if (!isAuthenticated || !userEmail) {
    return (<div className="auth-loader">
  <div className="spinner" />
</div>
); // Will be redirected by ProtectedRoute
  }

  return (
    <div className="dashboard-layout">
      {/* Header */}
      <div className="dashboard-header">
        <div className="header-content">
          <div className="header-logo">
            <img src={consentLogo} alt="ConsentBit" className="header-logo-image" />
          </div>
          <div className="header-actions">
            {/* <button className="header-btn header-btn-icon" title="Export">
              <img src={exportIcon} alt="Export" className="header-icon-image" />
            </button> */}

           {activeSection === 'licenses' && <button
              className="header-btn header-btn-text"
              onClick={() => setPurchaseModalOpen(true)}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M8 3V13M3 8H13"
                  stroke="#262E84"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              <span>Purchase License Key</span>
            </button>}

            {/* Temporarily hidden - Add Domain button */}
            {/* <button
              className="header-btn header-btn-primary"
              onClick={() => {
                if (isAuthenticated && userEmail) {
                  setAddDomainModalOpen(true);
                } else {
                  showError('Please log in to add domains');
                }
              }}
              disabled={!isAuthenticated || !userEmail}
              title={!isAuthenticated || !userEmail ? 'Please log in to add domains' : 'Add new domain'}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M8 3V13M3 8H13"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              <span>Add New Domain</span>
            </button> */}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="dashboard-body">
        {sidebarOpen && (
          <div
            className="sidebar-overlay"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <Sidebar
          activeSection={activeSection}
          onSectionChange={(section) => {
            setActiveSection(section);
            setSidebarOpen(false);
          }}
          userEmail={userEmail || ''}
          isOpen={sidebarOpen}
        />
        
        {/* Mobile menu toggle button */}
      <button
  className={`mobile-menu-toggle ${sidebarOpen ? 'open' : ''}`}
  onClick={() => setSidebarOpen(!sidebarOpen)}
  aria-label="Toggle menu"
>
  <span className="bar" />
  <span className="bar" />
  <span className="bar" />
</button>

        
        <div className="dashboard-main">
          <div className="dashboard-content">
            {shouldShowLoading ? (
              <DashboardSkeleton />
            ) : dashboardError || licensesError ? (
              <div className="card">
                <div
                  className="error"
                  style={{ color: '#f44336', padding: '20px' }}
                >
                  <h3>Error loading data</h3>
                  <p>
                    {dashboardError?.message ||
                      licensesError?.message ||
                      'Unknown error'}
                  </p>
                  <p
                    style={{
                      marginTop: '10px',
                      fontSize: '12px',
                      color: '#666',
                    }}
                  >
                    User: {userEmail || 'Not logged in'}
                  </p>
                </div>
              </div>
            ) : (
              <>
                {activeSection === 'dashboard' && (
                  <Dashboard
                    sites={sites}
                    subscriptions={subscriptions}
                    licenses={licenses}
                    isPolling={isPollingDomains}
                  />
                )}

                {/* Temporarily hidden - Domains section */}
                {/* {activeSection === 'domains' && (
                  <Sites
                    sites={sites}
                    subscriptions={subscriptions}
                    licenses={licenses}
                    userEmail={userEmail || ''}
                    isPolling={isPollingDomains}
                  />
                )} */}

                {activeSection === 'licenses' && (
                  <Licenses licenses={licenses} isPolling={isPollingLicenses} />
                )}

                {activeSection === 'profile' && (
                  <Profile 
                    userEmail={userEmail}
                    invoices={invoices}
                    invoicesLoading={invoicesLoading}
                    invoicesError={invoicesError}
                    hasMoreInvoices={hasMoreInvoices}
                    totalInvoices={totalInvoices}
                  />
                )}
              </>
            )}
          </div>
         
        </div>
      </div>

      <Notification notification={notification} onClose={clearNotification} />
      <PurchaseLicenseModal
        isOpen={purchaseModalOpen}
        onClose={() => setPurchaseModalOpen(false)}
      />
      <AddDomainModal
        isOpen={addDomainModalOpen}
        onClose={() => setAddDomainModalOpen(false)}
        userEmail={userEmail || ''}
      />
        <footer className="app-footer">
      <span>© {new Date().getFullYear()} All rights reserved ConsentBit</span>
  <span className="footer-service">A service by Seattle New Media</span>
    </footer>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
     
      <Routes>
        <Route path="/" element={<LoginRoute />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        {/* Redirect any unknown routes to login page */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {import.meta.env.DEV && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}

export default App;
