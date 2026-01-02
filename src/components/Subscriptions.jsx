import { useState, useEffect, useMemo, useRef } from 'react';
import './Subscriptions.css';
import { useNotification } from '../hooks/useNotification';
import { addSitesBatch, createCheckoutFromPending, removePendingSite } from '../services/api';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, useLicenses } from '../hooks/useDashboardQueries';

export default function Subscriptions({ dashboardData, userEmail }) {
  // Debug: Log received data
  useEffect(() => {
    console.log('[Subscriptions] dashboardData received:', dashboardData);
    console.log('[Subscriptions] userEmail:', userEmail);
  }, [dashboardData, userEmail]);
  
  // Handle both array and object formats for subscriptions
  const subscriptionsRaw = dashboardData?.subscriptions || {};
  const subscriptions = Array.isArray(subscriptionsRaw) 
    ? subscriptionsRaw 
    : Object.values(subscriptionsRaw);
  
  // Debug: Log processed subscriptions
  useEffect(() => {
    console.log('[Subscriptions] Processed subscriptions:', subscriptions);
    console.log('[Subscriptions] Subscriptions count:', subscriptions.length);
  }, [subscriptions]);
  
  // Also get subscriptions as object for detailed access
  const subscriptionsObj = Array.isArray(subscriptionsRaw)
    ? {}
    : subscriptionsRaw;
  
  const sites = dashboardData?.sites || {};
  
  // Debug: Log sites
  useEffect(() => {
    console.log('[Subscriptions] Sites:', sites);
    console.log('[Subscriptions] Sites count:', Object.keys(sites).length);
  }, [sites]);
  
  // Memoize backendPendingSites to prevent unnecessary re-renders
  const backendPendingSites = useMemo(() => {
    return dashboardData?.pendingSites || [];
  }, [dashboardData?.pendingSites]);
  
  // Get licenses data to match sites with licenses
  const { data: licensesData, isLoading: loadingLicenses, error: licensesError } = useLicenses(userEmail, { enabled: !!userEmail });
  const licenses = licensesData?.licenses || [];
  
  // Debug: Log licenses
  useEffect(() => {
    console.log('[Subscriptions] Licenses:', licenses);
    console.log('[Subscriptions] Licenses count:', licenses.length);
    console.log('[Subscriptions] Loading licenses:', loadingLicenses);
    console.log('[Subscriptions] Licenses error:', licensesError);
  }, [licenses, loadingLicenses, licensesError]);
  const { showSuccess, showError } = useNotification();
  const queryClient = useQueryClient();

  const [selectedPaymentPlan, setSelectedPaymentPlan] = useState(null);
  const [newSite, setNewSite] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [localPendingSites, setLocalPendingSites] = useState([]);
  const [activeSubscriptionTab, setActiveSubscriptionTab] = useState('monthly');
  const [copiedKey, setCopiedKey] = useState(null);

  // Use ref to track previous backendPendingSites to prevent infinite loops
  const prevBackendPendingSitesRef = useRef();
  
  // Sync local pending sites with backend data
  useEffect(() => {
    // Compare with previous value using JSON.stringify for deep comparison
    const prevStr = JSON.stringify(prevBackendPendingSitesRef.current);
    const currentStr = JSON.stringify(backendPendingSites);
    
    // Only update if the data actually changed
    if (prevStr !== currentStr) {
      if (backendPendingSites.length > 0) {
        setLocalPendingSites(backendPendingSites);
      } else {
        setLocalPendingSites([]);
      }
      // Update ref to current value
      prevBackendPendingSitesRef.current = backendPendingSites;
    }
  }, [backendPendingSites]);

  // Get all pending sites (local + backend)
  const allPendingSites = localPendingSites.length > 0 ? localPendingSites : backendPendingSites;

  // Calculate total active sites
  const activeSitesCount = Object.values(sites).filter(
    (site) => site.status === 'active'
  ).length;

  const handleAddSite = async () => {
    if (!newSite.trim()) {
      showError('Please enter a site domain');
      return;
    }

    if (!selectedPaymentPlan) {
      showError('Please select a payment plan (Monthly or Yearly) first');
      return;
    }

    if (!userEmail) {
      showError('User email not found. Please refresh the page.');
      return;
    }

    const siteDomain = newSite.trim();
    const siteDomainLower = siteDomain.toLowerCase();
    
    // Check if site already exists in pending list
    const siteExistsInPending = allPendingSites.some(ps => {
      const existingSite = typeof ps === 'string' ? ps : ps.site || ps.site_domain;
      return existingSite.toLowerCase() === siteDomainLower;
    });

    if (siteExistsInPending) {
      showError(`Site "${siteDomain}" is already in the pending list`);
      return;
    }
    
    // Check if site already exists in active subscriptions
    const siteExistsInSubscriptions = Object.keys(sites).some(existingSite => {
      const siteData = sites[existingSite];
      return existingSite.toLowerCase() === siteDomainLower && 
             siteData.status === 'active';
    });
    
    // Also check subscription items
    let siteExistsInSubscriptionItems = false;
    if (subscriptions && subscriptions.length > 0) {
      subscriptions.forEach(sub => {
        if (sub.items && Array.isArray(sub.items)) {
          sub.items.forEach(item => {
            if (item.site && item.site.toLowerCase() === siteDomainLower && 
                (item.status === 'active' || !item.status)) {
              siteExistsInSubscriptionItems = true;
            }
          });
        }
      });
    }

    if (siteExistsInSubscriptions || siteExistsInSubscriptionItems) {
      showError(`Site "${siteDomain}" already exists in your subscriptions and cannot be added again`);
      return;
    }

    try {
      // Add to backend
      await addSitesBatch(userEmail, [{ site: siteDomain }], selectedPaymentPlan);
      
      // Add to local state immediately
      const newPendingSite = { site: siteDomain, billing_period: selectedPaymentPlan };
      setLocalPendingSites([...allPendingSites, newPendingSite]);
      
      showSuccess(`Site "${siteDomain}" added to pending list`);
      setNewSite('');
      
      // Refresh dashboard data
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(userEmail) });
    } catch (error) {
      showError('Failed to add site: ' + (error.message || 'Unknown error'));
    }
  };

  const handleRemovePendingSite = async (index) => {
    if (!userEmail) {
      showError('User email not found. Please refresh the page.');
      return;
    }

    const siteToRemove = allPendingSites[index];
    const siteName = typeof siteToRemove === 'string' 
      ? siteToRemove 
      : siteToRemove.site || siteToRemove.site_domain;

    try {
      // Remove from backend
      await removePendingSite(userEmail, siteName);
      
      // Remove from local state immediately
      const updated = allPendingSites.filter((_, i) => i !== index);
      setLocalPendingSites(updated);
      
      showSuccess(`Site "${siteName}" removed from pending list`);
      
      // Refresh dashboard data
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(userEmail) });
    } catch (error) {
      showError('Failed to remove site: ' + (error.message || 'Unknown error'));
    }
  };

  const handlePayNow = async () => {
    if (allPendingSites.length === 0) {
      showError('No sites to add. Please add at least one site.');
      return;
    }

    if (!selectedPaymentPlan) {
      showError('Please select a payment plan (Monthly or Yearly) first');
      return;
    }

    if (!userEmail) {
      showError('User email not found. Please refresh the page.');
      return;
    }

    setIsProcessing(true);
    try {
      // First, ensure all pending sites are saved to backend
      const sitesToSend = allPendingSites.map(ps => ({
        site: typeof ps === 'string' ? ps : ps.site || ps.site_domain
      }));
      
      await addSitesBatch(userEmail, sitesToSend, selectedPaymentPlan);
      
      // Create checkout session
      const checkoutData = await createCheckoutFromPending(userEmail, selectedPaymentPlan);
      
      if (checkoutData.url) {
        // Redirect to Stripe checkout
        window.location.href = checkoutData.url;
      } else {
        throw new Error('No checkout URL received');
      }
    } catch (error) {
      showError('Failed to process payment: ' + (error.message || 'Unknown error'));
      setIsProcessing(false);
    }
  };

  // Show loading state if dashboardData is not available
  if (!dashboardData) {
    return (
      <div className="subscriptions-container">
        <div className="subscriptions-header">
          <h2>💳 Subscriptions</h2>
          <p>Manage your active subscriptions and billing</p>
        </div>
        <div className="card">
          <div className="loading">Loading subscription data...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="subscriptions-container">
      <div className="subscriptions-header">
        <h2>💳 Subscriptions</h2>
        <p>Manage your active subscriptions and billing</p>
      </div>

      {/* Payment Plan Selector */}
      <div className="card payment-plan-selector">
        <label className="payment-plan-label">Select Payment Plan</label>
        <div className="payment-plan-options">
          <label 
            className={`payment-plan-option ${selectedPaymentPlan === 'monthly' ? 'selected' : ''}`}
            onClick={() => setSelectedPaymentPlan('monthly')}
          >
            <input 
              type="radio" 
              name="payment-plan" 
              value="monthly"
              checked={selectedPaymentPlan === 'monthly'}
              onChange={() => setSelectedPaymentPlan('monthly')}
            />
            <span>Monthly</span>
          </label>
          <label 
            className={`payment-plan-option ${selectedPaymentPlan === 'yearly' ? 'selected' : ''}`}
            onClick={() => setSelectedPaymentPlan('yearly')}
          >
            <input 
              type="radio" 
              name="payment-plan" 
              value="yearly"
              checked={selectedPaymentPlan === 'yearly'}
              onChange={() => setSelectedPaymentPlan('yearly')}
            />
            <span>Yearly</span>
          </label>
        </div>
      </div>

      {/* Add Site Input */}
      <div className="card add-site-section">
        <div className="add-site-form">
          <input
            type="text"
            placeholder="Enter site domain (e.g., example.com)"
            value={newSite}
            onChange={(e) => setNewSite(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleAddSite()}
            disabled={!selectedPaymentPlan}
            className={!selectedPaymentPlan ? 'disabled' : ''}
          />
          <button
            className="btn btn-primary"
            onClick={handleAddSite}
            disabled={!selectedPaymentPlan || !newSite.trim()}
          >
            Add to List
          </button>
        </div>
        {!selectedPaymentPlan && (
          <p className="helper-text">Please select a payment plan above to enable site input</p>
        )}
      </div>

      {/* Pending Sites List */}
      <div className="card pending-sites-section">
        <h3>Pending Sites</h3>
        <div className="pending-sites-list">
          {allPendingSites.length === 0 ? (
            <p style={{ color: '#999', margin: 0, fontSize: '14px' }}>
              No pending sites. Add sites above to get started.
            </p>
          ) : (
            allPendingSites.map((ps, index) => {
              const siteName = typeof ps === 'string' ? ps : ps.site || ps.site_domain || ps;
              return (
                <div key={index} className="pending-site-item">
                  <span>{siteName}</span>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => handleRemovePendingSite(index)}
                    disabled={isProcessing}
                  >
                    Remove
                  </button>
                </div>
              );
            })
          )}
        </div>
        {allPendingSites.length > 0 && (
          <button
            className="btn btn-success pay-now-btn"
            onClick={handlePayNow}
            disabled={isProcessing}
          >
            {isProcessing ? 'Processing...' : `💳 Pay Now (${allPendingSites.length} site${allPendingSites.length === 1 ? '' : 's'})`}
          </button>
        )}
      </div>

      {/* Your Subscribed Items */}
      <div className="card subscribed-items-section">
        <h3>Your Subscribed Items</h3>
        
        {/* Process subscriptions and sites to create subscribed items */}
        {(() => {
          // Create map of subscription_id -> licenses
          const subscriptionLicenses = {};
          licenses.forEach(license => {
            if (license.subscription_id) {
              if (!subscriptionLicenses[license.subscription_id]) {
                subscriptionLicenses[license.subscription_id] = [];
              }
              subscriptionLicenses[license.subscription_id].push(license);
            }
          });

          // Collect all subscribed items
          const subscribedItems = [];
          
          // Process subscriptions
          subscriptions.forEach(sub => {
            const subId = sub.subscription_id || sub.id;
            const licensesForSub = subscriptionLicenses[subId] || [];
            
            // Get billing period
            const billingPeriod = sub.billingPeriod || sub.billing_period || 
                                 licensesForSub[0]?.billing_period || 'monthly';
            
            // Get expiration date
            const currentPeriodEnd = sub.current_period_end || sub.current_periodEnd;
            let expirationDate = 'N/A';
            if (currentPeriodEnd) {
              try {
                const timestamp = typeof currentPeriodEnd === 'number' ? currentPeriodEnd : parseInt(currentPeriodEnd);
                const dateInMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
                expirationDate = new Date(dateInMs).toLocaleDateString();
              } catch (e) {
                console.warn('[Subscriptions] Error parsing expiration date:', e);
              }
            }
            
            // Process sites from this subscription
            Object.keys(sites).forEach(siteDomain => {
              const siteData = sites[siteDomain];
              const siteSubscriptionId = siteData.subscription_id;
              
              // Only include sites that belong to this subscription
              if (siteSubscriptionId !== subId) return;
              
              // Skip inactive sites
              if (siteData.status === 'inactive' || siteData.status === 'cancelled') return;
              
              // Find license for this site
              const siteLicense = licensesForSub.find(lic => {
                const licSite = (lic.used_site_domain || lic.site_domain || '').toLowerCase().trim();
                return licSite === siteDomain.toLowerCase().trim();
              });
              
              // Get expiration from license if available
              let siteExpirationDate = expirationDate;
              if (siteLicense?.renewal_date) {
                try {
                  const timestamp = typeof siteLicense.renewal_date === 'number' 
                    ? siteLicense.renewal_date 
                    : parseInt(siteLicense.renewal_date);
                  const dateInMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
                  siteExpirationDate = new Date(dateInMs).toLocaleDateString();
                } catch (e) {
                  // Use subscription expiration
                }
              }
              
              subscribedItems.push({
                type: 'site',
                name: siteDomain,
                licenseKey: siteLicense?.license_key || siteData.license_key || 'N/A',
                status: siteData.status || sub.status || 'active',
                subscriptionId: subId,
                billingPeriod: billingPeriod,
                expirationDate: siteExpirationDate
              });
            });
          });
          
          // Categorize by billing period
          const categorizedItems = {
            monthly: subscribedItems.filter(item => item.billingPeriod !== 'yearly'),
            yearly: subscribedItems.filter(item => item.billingPeriod === 'yearly')
          };
          
          if (subscribedItems.length === 0) {
            return (
              <div className="empty-state">
                <p style={{ color: '#666', fontSize: '14px', margin: 0 }}>
                  No subscribed items yet. Add sites above to create subscriptions.
                </p>
              </div>
            );
          }
          
          return (
            <>
              {/* Tabs */}
              <div className="subscription-tabs">
                <button
                  className={`subscription-tab-button ${activeSubscriptionTab === 'monthly' ? 'active' : ''}`}
                  onClick={() => setActiveSubscriptionTab('monthly')}
                >
                  Monthly ({categorizedItems.monthly.length})
                </button>
                <button
                  className={`subscription-tab-button ${activeSubscriptionTab === 'yearly' ? 'active' : ''}`}
                  onClick={() => setActiveSubscriptionTab('yearly')}
                >
                  Yearly ({categorizedItems.yearly.length})
                </button>
              </div>
              
              {/* Table for Monthly */}
              {activeSubscriptionTab === 'monthly' && (
                <div className="subscription-tab-content">
                  {categorizedItems.monthly.length === 0 ? (
                    <div className="empty-state">
                      <p style={{ color: '#666', fontSize: '14px', margin: 0 }}>
                        No monthly subscriptions
                      </p>
                    </div>
                  ) : (
                    <table className="subscribed-items-table">
                      <thead>
                        <tr>
                          <th>Domain/Site</th>
                          <th>License Key</th>
                          <th>Expiration Date</th>
                          <th style={{ textAlign: 'center' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {categorizedItems.monthly.map((item, index) => (
                          <tr key={index}>
                            <td>🌐 {item.name}</td>
                            <td className="license-key-cell">
                              {item.licenseKey !== 'N/A' 
                                ? item.licenseKey.substring(0, 20) + '...' 
                                : 'N/A'}
                            </td>
                            <td>{item.expirationDate}</td>
                            <td style={{ textAlign: 'center' }}>
                              {item.licenseKey !== 'N/A' && (
                                <button
                                  className="btn-copy-license"
                                  onClick={() => handleCopyLicenseKey(item.licenseKey)}
                                  title={copiedKey === item.licenseKey ? "Copied!" : "Copy License Key"}
                                  style={{
                                    opacity: copiedKey === item.licenseKey ? 0.6 : 1,
                                    cursor: 'pointer'
                                  }}
                                >
                                  {copiedKey === item.licenseKey ? '✓' : '📋'}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
              
              {/* Table for Yearly */}
              {activeSubscriptionTab === 'yearly' && (
                <div className="subscription-tab-content">
                  {categorizedItems.yearly.length === 0 ? (
                    <div className="empty-state">
                      <p style={{ color: '#666', fontSize: '14px', margin: 0 }}>
                        No yearly subscriptions
                      </p>
                    </div>
                  ) : (
                    <table className="subscribed-items-table">
                      <thead>
                        <tr>
                          <th>Domain/Site</th>
                          <th>License Key</th>
                          <th>Expiration Date</th>
                          <th style={{ textAlign: 'center' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {categorizedItems.yearly.map((item, index) => (
                          <tr key={index}>
                            <td>🌐 {item.name}</td>
                            <td className="license-key-cell">
                              {item.licenseKey !== 'N/A' 
                                ? item.licenseKey.substring(0, 20) + '...' 
                                : 'N/A'}
                            </td>
                            <td>{item.expirationDate}</td>
                            <td style={{ textAlign: 'center' }}>
                              {item.licenseKey !== 'N/A' && (
                                <button
                                  className="btn-copy-license"
                                  onClick={() => handleCopyLicenseKey(item.licenseKey)}
                                  title={copiedKey === item.licenseKey ? "Copied!" : "Copy License Key"}
                                  style={{
                                    opacity: copiedKey === item.licenseKey ? 0.6 : 1,
                                    cursor: 'pointer'
                                  }}
                                >
                                  {copiedKey === item.licenseKey ? '✓' : '📋'}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </>
          );
        })()}
      </div>

      <div className="subscription-summary">
        <div className="summary-card">
          <div className="summary-label">Total Active Sites</div>
          <div className="summary-value">{activeSitesCount}</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">Active Subscriptions</div>
          <div className="summary-value">{subscriptions.length}</div>
        </div>
      </div>
    </div>
  );
}

