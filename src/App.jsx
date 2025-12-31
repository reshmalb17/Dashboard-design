import { useState, useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useMemberstack } from './hooks/useMemberstack';
import { useDashboardData, useLicenses } from './hooks/useDashboardQueries';
import { useNotification } from './hooks/useNotification';
import { queryClient } from './lib/queryClient';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import Subscriptions from './components/Subscriptions';
import Sites from './components/Sites';
import Licenses from './components/Licenses';
import Profile from './components/Profile';
import PurchaseLicenseModal from './components/PurchaseLicenseModal';
import AddDomainModal from './components/AddDomainModal';
import LoginPrompt from './components/LoginPrompt';
import Notification from './components/Notification';
import consentLogo from './assets/consent-logo.svg';
import exportIcon from './assets/export-icon.svg';
import './App.css';

// Inner component that uses dashboard queries
function DashboardContent() {
  const { member, userEmail, isAuthenticated, loading: authLoading, error: authError } = useMemberstack();
  const { notification, showSuccess, showError, clear: clearNotification } = useNotification();
  const [maxTimeoutReached, setMaxTimeoutReached] = useState(false);
  const [activeSection, setActiveSection] = useState('dashboard'); // Default to dashboard
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false);
  const [addDomainModalOpen, setAddDomainModalOpen] = useState(false);

  // Debug: Log authentication state
  useEffect(() => {
    console.log('[App] Authentication state:', {
      hasMember: !!member,
      userEmail,
      isAuthenticated,
      authLoading,
      authError: authError?.message,
      memberKeys: member ? Object.keys(member) : [],
      memberEmail: member?.email || member?._email || member?.data?.email || 'NOT FOUND'
    });
  }, [member, userEmail, isAuthenticated, authLoading, authError]);

  // Set maximum timeout to prevent infinite loading
  useEffect(() => {
    // Reset timeout flag when loading state changes
    if (!authLoading) {
      setMaxTimeoutReached(false);
      return;
    }

    const timeout = setTimeout(() => {
      setMaxTimeoutReached(true);
    }, 3000); // 3 seconds max - show login prompt faster

    return () => clearTimeout(timeout);
  }, [authLoading]);

  // Debug: Log query enablement
  // TEMPORARY: Enable queries for design (using mock data)
  const queriesEnabled = true; // Always enabled for mock data design
  useEffect(() => {
    console.log('[App] Query enablement:', {
      isAuthenticated,
      userEmail,
      queriesEnabled,
      willFetchDashboard: queriesEnabled,
      willFetchLicenses: queriesEnabled
    });
  }, [isAuthenticated, userEmail, queriesEnabled]);

  // Use TanStack Query hooks - both queries run in parallel automatically
  const {
    data: dashboardData,
    isLoading: loadingDashboard,
    error: dashboardError,
    isFetching: isFetchingDashboard,
    status: dashboardStatus,
  } = useDashboardData(userEmail, {
    enabled: queriesEnabled,
  });

  const {
    data: licensesData,
    isLoading: loadingLicenses,
    error: licensesError,
    isFetching: isFetchingLicenses,
    status: licensesStatus,
  } = useLicenses(userEmail, {
    enabled: queriesEnabled,
  });
  
  // Debug: Log query status
  useEffect(() => {
    console.log('[App] Query status:', {
      dashboardStatus,
      loadingDashboard,
      isFetchingDashboard,
      hasDashboardData: !!dashboardData,
      dashboardError: dashboardError?.message,
      licensesStatus,
      loadingLicenses,
      isFetchingLicenses,
      hasLicensesData: !!licensesData,
      licensesError: licensesError?.message,
    });
  }, [dashboardStatus, loadingDashboard, isFetchingDashboard, dashboardData, dashboardError, licensesStatus, loadingLicenses, isFetchingLicenses, licensesData, licensesError]);

  const loading = loadingDashboard || loadingLicenses;
  const sites = dashboardData?.sites || {};
  const licenses = licensesData?.licenses || [];
  const subscriptions = dashboardData?.subscriptions || [];

  // Debug: Log data fetching status (MUST be before any early returns)
  useEffect(() => {
    console.log('[App] Data fetching status:', {
      loadingDashboard,
      loadingLicenses,
      hasDashboardData: !!dashboardData,
      hasLicensesData: !!licensesData,
      userEmail,
      isAuthenticated,
      dashboardError,
      licensesError
    });
    if (dashboardData) {
      console.log('[App] Dashboard data structure:', {
        hasSites: !!dashboardData.sites,
        sitesCount: dashboardData.sites ? Object.keys(dashboardData.sites).length : 0,
        hasSubscriptions: !!dashboardData.subscriptions,
        subscriptionsType: Array.isArray(dashboardData.subscriptions) ? 'array' : typeof dashboardData.subscriptions,
        subscriptionsCount: Array.isArray(dashboardData.subscriptions) 
          ? dashboardData.subscriptions.length 
          : dashboardData.subscriptions ? Object.keys(dashboardData.subscriptions).length : 0,
        hasPendingSites: !!dashboardData.pendingSites,
        pendingSitesCount: dashboardData.pendingSites ? dashboardData.pendingSites.length : 0,
        fullData: dashboardData
      });
    }
  }, [loadingDashboard, loadingLicenses, dashboardData, licensesData, userEmail, isAuthenticated, dashboardError, licensesError]);

  // Show error notifications
  const error = dashboardError || licensesError || authError;
  if (error) {
    showError(error.message || 'An error occurred');
  }

  // Show loading state only briefly (optimized for fast loading)
  if (authLoading && !maxTimeoutReached) {
    return (
      <div className="login-container">
        <div className="card">
          <div className="loading">Initializing...</div>
        </div>
      </div>
    );
  }

  // If timeout reached or not authenticated, show login prompt immediately
  if (maxTimeoutReached || !isAuthenticated) {
    return (
      <div className="login-container">
        {authError && (
          <div className="error">
            {authError}
          </div>
        )}
        <LoginPrompt />
      </div>
    );
  }

  // Show dashboard with sidebar layout
  return (
    <div className="dashboard-layout">
      {/* Full width header at top */}
      <div className="dashboard-header">
        <div className="header-content">
          {/* Left side - Logo */}
          <div className="header-logo">
            <img src={consentLogo} alt="ConsentBit" className="header-logo-image" />
          </div>
          
          {/* Right side - Action buttons */}
          <div className="header-actions">
              {/* Export button */}
              <button className="header-btn header-btn-icon" title="Export">
                <img src={exportIcon} alt="Export" className="header-icon-image" />
              </button>
              
              {/* Purchase License Key button */}
              <button 
                className="header-btn header-btn-text"
                onClick={() => setPurchaseModalOpen(true)}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 3V13M3 8H13" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <span>Purchase License Key</span>
              </button>
              
              {/* Add New Domain button */}
              <button 
                className="header-btn header-btn-primary"
                onClick={() => setAddDomainModalOpen(true)}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 3V13M3 8H13" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <span>Add New Domain</span>
              </button>
            </div>
          </div>
        </div>
      
      {/* Main content area with sidebar */}
      <div className="dashboard-body">
        {/* Mobile menu overlay */}
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
            setSidebarOpen(false); // Close sidebar on mobile when section changes
          }}
          userEmail={userEmail}
          isOpen={sidebarOpen}
        />
        
        {/* Mobile menu toggle button */}
        <button 
          className="mobile-menu-toggle"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle menu"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 12H21M3 6H21M3 18H21" stroke="#262E84" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
        
        <div className="dashboard-main">
          <div className="dashboard-content">
          {loading ? (
            <div className="card">
              <div className="loading">Loading dashboard data...</div>
              <p style={{ marginTop: '10px', color: '#666', fontSize: '14px' }}>
                {loadingDashboard && 'Fetching dashboard data...'}
                {loadingLicenses && 'Fetching licenses...'}
              </p>
            </div>
          ) : dashboardError || licensesError ? (
            <div className="card">
              <div className="error" style={{ color: '#f44336', padding: '20px' }}>
                <h3>Error loading data</h3>
                <p>{dashboardError?.message || licensesError?.message || 'Unknown error'}</p>
                <p style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>
                  User: {userEmail || 'Not logged in'}
                </p>
              </div>
            </div>
          ) : (
            <>
              {activeSection === 'dashboard' && (
                <Dashboard />
              )}
              {activeSection === 'domains' && (
                <Sites sites={sites} userEmail={userEmail} />
              )}
              {activeSection === 'licenses' && (
                <Licenses licenses={licenses} />
              )}
              {activeSection === 'profile' && (
                <Profile />
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
      />
    </div>
  );
}

// Main App component with QueryClientProvider
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <DashboardContent />
      {/* React Query DevTools - only in development */}
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}

export default App;

