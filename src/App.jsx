import { useState, useEffect, useMemo } from 'react';
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useMemberstack } from './hooks/useMemberstack';
import { useDashboardData, useLicenses, queryKeys } from './hooks/useDashboardQueries';
import { useNotification } from './hooks/useNotification';
import { queryClient } from './lib/queryClient';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import Sites from './components/Sites';
import Licenses from './components/Licenses';
import Profile from './components/Profile';
import PurchaseLicenseModal from './components/PurchaseLicenseModal';
import AddDomainModal from './components/AddDomainModal';
import LoginPrompt from './components/LoginPrompt';
import Notification from './components/Notification';
import consentLogo from './assets/consent-logo.svg';
import exportIcon from './assets/export-icon.svg';
import DashboardSkeleton from './components/DashboardSkeleton';
import './App.css';
import { useRef } from 'react';

function DashboardContent() {
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

    const pendingLicensePurchase = sessionStorage.getItem('pendingLicensePurchase');
    const pendingDomainPurchase = sessionStorage.getItem('pendingDomainPurchase');

    if (sessionId && pendingLicensePurchase) {
      const purchaseInfo = JSON.parse(pendingLicensePurchase);
      sessionStorage.removeItem('pendingLicensePurchase');

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
    } else if (canceled === 'true') {
      sessionStorage.removeItem('pendingLicensePurchase');
      sessionStorage.removeItem('pendingDomainPurchase');
      showError('Payment was canceled');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [userEmail, isAuthenticated, showSuccess, showError]);

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

  if (
    maxTimeoutReached ||
    (!isAuthenticated && !userEmail && !authLoading && !isFirstLoad)
  ) {
    return (
      <div className="login-container">
        {authError && <div className="error">{authError}</div>}
        <LoginPrompt />
      </div>
    );
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
            <button className="header-btn header-btn-icon" title="Export">
              <img src={exportIcon} alt="Export" className="header-icon-image" />
            </button>

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

            <button
              className="header-btn header-btn-primary"
              onClick={() => setAddDomainModalOpen(true)}
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
            </button>
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

                {activeSection === 'domains' && (
                  <Sites
                    sites={sites}
                    subscriptions={subscriptions}
                    licenses={licenses}
                    userEmail={userEmail || ''}
                    isPolling={isPollingDomains}
                  />
                )}

                {activeSection === 'licenses' && (
                  <Licenses licenses={licenses} isPolling={isPollingLicenses} />
                )}

                {activeSection === 'profile' && <Profile userEmail={userEmail}  />}
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
      © {new Date().getFullYear()} All rights reserved ConsentBit
    </footer>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <DashboardContent />
      {import.meta.env.DEV && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}

export default App;
