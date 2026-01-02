import { useState, useRef, useEffect } from 'react';
import { useNotification } from '../hooks/useNotification';
import { cancelSubscription } from '../services/api';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../hooks/useDashboardQueries';
import { useMemberstack } from '../hooks/useMemberstack';
import './Licenses.css';

export default function Licenses({ licenses }) {
  const [activeTab, setActiveTab] = useState('Not Assigned');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [billingPeriodFilter, setBillingPeriodFilter] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const [activateModal, setActivateModal] = useState(null);
  const [domainInput, setDomainInput] = useState('');
  const [copiedKey, setCopiedKey] = useState(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const contextMenuRef = useRef(null);
  const searchInputRef = useRef(null);
  const { showSuccess, showError } = useNotification();
  const queryClient = useQueryClient();
  const { userEmail } = useMemberstack();
  // Use real data - return empty array if no licenses
  const displayLicenses = licenses && licenses.length > 0 
    ? licenses.map(lic => {
        // Determine activated site - check multiple possible fields
        const activatedForSite = lic.activated_for_site || lic.activatedForSite || lic.used_site_domain || lic.site_domain || 'Not Assigned';
        
        // Determine if license is activated (has a site domain assigned)
        const isActivated = activatedForSite !== 'Not Assigned' && 
                           activatedForSite !== null && 
                           activatedForSite !== undefined && 
                           activatedForSite !== '' &&
                           String(activatedForSite).trim() !== '';
        
        // Determine status: If activated, show "Active", otherwise show "Available"
        let status = 'Available';
        if (isActivated) {
          // License is activated - show "Active" unless backend explicitly says it's cancelled/inactive
          const backendStatus = (lic.status || '').toLowerCase().trim();
          if (backendStatus === 'cancelled' || backendStatus === 'canceled' || backendStatus === 'inactive') {
            // Only override with cancelled/inactive if backend explicitly says so
            status = lic.status.charAt(0).toUpperCase() + lic.status.slice(1); // Capitalize first letter
          } else {
            // License is activated - always show "Active" (override any backend status)
            status = 'Active';
          }
        } else {
          // License is not activated (Not Assigned) - always show "Available"
          status = 'Available';
        }
        
        return {
          id: lic.id || lic.license_key,
          licenseKey: lic.license_key || lic.licenseKey || 'N/A',
          status: status,
          billingPeriod: lic.billing_period || lic.billingPeriod || 'N/A',
          activatedForSite: activatedForSite,
          createdDate: lic.created_date || lic.createdDate || 'N/A',
          expiryDate: lic.expiry_date || lic.expiryDate || 'N/A',
          subscriptionId: lic.subscription_id || lic.subscriptionId || null,
          siteDomain: lic.used_site_domain || lic.site_domain || null,
        };
      })
    : [];

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target)) {
        setContextMenu(null);
      }
    };

    if (contextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [contextMenu]);

  const handleCopy = async (key) => {
    if (!key || key === 'N/A') {
      return;
    }
    
    try {
      // Use modern clipboard API
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(key);
      } else {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = key;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          document.execCommand('copy');
        } catch (err) {
          // Fallback copy failed
        }
        document.body.removeChild(textArea);
      }
      
      // Show feedback
      setCopiedKey(key);
      showSuccess('License key copied to clipboard');
      setTimeout(() => {
        setCopiedKey(null);
      }, 2000);
    } catch (err) {
      // Failed to copy license key
      showError('Failed to copy license key');
    }
  };

  const handleSearchIconClick = () => {
    setIsSearchExpanded(true);
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 100);
  };

  const handleSearchBlur = () => {
    if (!searchQuery.trim()) {
      setIsSearchExpanded(false);
    }
  };

  const handleCancelSubscription = async (subscriptionId, siteDomain, licenseKey) => {
    if (isCancelling) {
      return; // Prevent multiple clicks
    }

    if (!userEmail) {
      showError('User email not found. Please refresh the page.');
      return;
    }

    if (!subscriptionId) {
      showError('Subscription ID not found.');
      return;
    }

    if (!siteDomain) {
      showError('Site domain not found.');
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to cancel the subscription for "${siteDomain}"? This will cancel the entire subscription and all sites in it. The subscription will remain active until the end of the current billing period.`
    );

    if (!confirmed) {
      setContextMenu(null);
      return;
    }

    setIsCancelling(true);
    setContextMenu(null); // Close menu immediately

    try {
      const response = await cancelSubscription(userEmail, siteDomain, subscriptionId);
      const message = response.message || 'Subscription cancelled successfully. The subscription will remain active until the end of the current billing period.';
      showSuccess(message);
      
      // Refresh dashboard data
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(userEmail) });
    } catch (error) {
      const errorMessage = error.message || error.error || 'Unknown error';
      showError('Failed to cancel subscription: ' + errorMessage);
    } finally {
      setIsCancelling(false);
    }
  };

  const handleContextMenu = (e, licenseId) => {
  e.preventDefault();
  e.stopPropagation();

  const rect = e.currentTarget.getBoundingClientRect();

  setContextMenu({
    licenseId,
    top: rect.bottom + 6,   // below button
    left: rect.left - 180,  // open to left
  });
};


  const handleOpenActivateModal = (licenseId) => {
    setActivateModal(licenseId);
    setDomainInput('');
    setContextMenu(null);
  };

  const handleCloseActivateModal = () => {
    setActivateModal(null);
    setDomainInput('');
  };

  const handleActivateSubmit = () => {
    if (!domainInput.trim()) {
      showError('Please enter a domain');
      return;
    }
    
    // Here you would typically make an API call to activate the license
    showSuccess(`License activated for ${domainInput}`);
    handleCloseActivateModal();
  };

  // Filter licenses based on active tab, search, and billing period
  const filteredLicenses = displayLicenses.filter(license => {
    // Tab filter
    if (activeTab === 'Not Assigned' && license.activatedForSite !== 'Not Assigned') {
      return false;
    } else if (activeTab === 'Activated' && (license.activatedForSite === 'Not Assigned' || license.status !== 'Active')) {
      return false;
    } else if (activeTab === 'Cancelled' && license.status !== 'Cancelled') {
      return false;
    }
    
    // Search filter
    if (searchQuery && !license.licenseKey.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    
    // Billing period filter
    if (billingPeriodFilter && license.billingPeriod !== billingPeriodFilter) return false;
    
    return true;
  });

  return (
    <div className="licenses-container">
      {/* Header */}
      <div className="licenses-header">
        <h1 className="licenses-title">Licence Keys</h1>
        <div className="licenses-header-controls">
          <div className={`licenses-search-wrapper ${isSearchExpanded ? 'expanded' : ''}`}>
            <input
              ref={searchInputRef}
              type="text"
              className="licenses-search-input"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onBlur={handleSearchBlur}
            />
            <button
              className="licenses-search-icon-btn"
              onClick={handleSearchIconClick}
              type="button"
              title="Search"
            >
              <svg className="licenses-search-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 17C13.4183 17 17 13.4183 17 9C17 4.58172 13.4183 1 9 1C4.58172 1 1 4.58172 1 9C1 13.4183 4.58172 17 9 17Z" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M19 19L14.65 14.65" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
          {/* <select
            className="licenses-billing-filter"
            value={billingPeriodFilter}
            onChange={(e) => setBillingPeriodFilter(e.target.value)}
          >
            <option value="">Billing Period</option>
            <option value="Monthly">Monthly</option>
            <option value="Yearly">Yearly</option>
          </select> */}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="licenses-filter-tabs">
      <div className="licenses-tabs">
        <button
          className={`licenses-tab ${activeTab === 'Not Assigned' ? 'active' : ''}`}
          onClick={() => setActiveTab('Not Assigned')}
        >
          Not Assigned
        </button>
        <button
          className={`licenses-tab ${activeTab === 'Activated' ? 'active' : ''}`}
          onClick={() => setActiveTab('Activated')}
        >
          Activated
        </button>
        <button
          className={`licenses-tab ${activeTab === 'Cancelled' ? 'active' : ''}`}
          onClick={() => setActiveTab('Cancelled')}
        >
          Cancelled
        </button>
      </div>

      <div>
         <select
            className="licenses-billing-filter"
            value={billingPeriodFilter}
            onChange={(e) => setBillingPeriodFilter(e.target.value)}
          >
            <option value="">Billing Period</option>
            <option value="Monthly">Monthly</option>
            <option value="Yearly">Yearly</option>
          </select>
      </div>
</div>
      {/* Table */}
      <div className="licenses-table-wrapper">
        <table className="licenses-table">
          <thead>
            <tr>
              <th>License Key</th>
              <th>Status</th>
              <th>Billing Period</th>
              <th>Activated for site</th>
              <th>Created date</th>
              <th>Expiry date</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredLicenses.length === 0 ? (
              <tr>
                <td colSpan="8" className="licenses-empty-cell">
                  No license keys found
                </td>
              </tr>
            ) : (
              filteredLicenses.map((license, index) => (
                <tr key={license.id || index} className={index === 5 ? 'highlighted' : ''} style={{
    background:
      contextMenu?.licenseId === (license.id || index)
        ? '#0777E61A'
        : 'transparent',
  }}>
                  <td>
                    <div className="license-cell-content license-key-cell">
                      <span className="license-key-text">{license.licenseKey}</span>
                      <button
                        className="license-view-btn"
                        onClick={() => handleCopy(license.licenseKey)}
                        title={copiedKey === license.licenseKey ? "Copied!" : "Copy license key"}
                        disabled={license.licenseKey === 'N/A'}
                        style={{
                          opacity: copiedKey === license.licenseKey ? 0.6 : 1,
                          cursor: license.licenseKey === 'N/A' ? 'not-allowed' : 'pointer'
                        }}
                      >
                        {copiedKey === license.licenseKey ? (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect width="16" height="16" rx="3" fill="#10B981" />
                            <path d="M4 8L6.5 10.5L12 5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect width="16" height="16" rx="3" fill="#DEE8F4"/>
                            <path d="M9.7333 8.46752V10.1825C9.7333 11.6117 9.16163 12.1834 7.73245 12.1834H6.01745C4.58827 12.1834 4.0166 11.6117 4.0166 10.1825V8.46752C4.0166 7.03834 4.58827 6.46667 6.01745 6.46667H7.73245C9.16163 6.46667 9.7333 7.03834 9.7333 8.46752Z" stroke="#292D32" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M12.1835 6.01751V7.73251C12.1835 9.16169 11.6118 9.73336 10.1826 9.73336H9.73348V8.46752C9.73348 7.03834 9.16181 6.46667 7.73264 6.46667H6.4668V6.01751C6.4668 4.58833 7.03847 4.01666 8.46764 4.01666H10.1826C11.6118 4.01666 12.1835 4.58833 12.1835 6.01751Z" stroke="#292D32" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </button>
                    </div>
                  </td>
                  <td>
                    <div className="license-cell-content">
                      <span className={`license-status-${license.status.toLowerCase() === 'active' ? 'active' : license.status.toLowerCase() === 'cancelled' ? 'cancelled' : 'available'}`}>
                        <span className={`status-dot-${license.status.toLowerCase() === 'active' ? 'green' : license.status.toLowerCase() === 'cancelled' ? 'red' : 'blue'}`} />
                        <span>{license.status}</span>
                      </span>
                    </div>
                  </td>
                  <td>
                    <div  className={`license-cell-content ${
    license.billingPeriod === 'Monthly'
      ? 'billing-monthly'
      : 'billing-yearly'
  }`}>
                      {license.billingPeriod}
                    </div>
                  </td>
                  <td>
                    <div className="license-cell-content">
                      <span className={license.activatedForSite === 'Not Assigned' ? 'not-assigned' : ''}>
                        {license.activatedForSite}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="license-cell-content">
                      {license.createdDate}
                    </div>
                  </td>
                  <td>
                    <div className="license-cell-content">
                      {license.expiryDate}
                    </div>
                  </td>
                  <td>
                    <div className="license-cell-content license-actions">
                      <button
                        className="license-activate-btn"
                        title="Activate License"
                        onClick={() => handleOpenActivateModal(license.id || index)}
                      >
                       <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M8 12H16" stroke="#118A41" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M12 16V8" stroke="#118A41" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M9 22H15C20 22 22 20 22 15V9C22 4 20 2 15 2H9C4 2 2 4 2 9V15C2 20 4 22 9 22Z" stroke="#118A41" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>

                      </button>
                    </div>
                  </td>
                  <td>
                    <div className="license-cell-content license-actions">
                      <button
                        className="license-actions-btn"
                        onClick={(e) => handleContextMenu(e, license.id || index)}
                        title="More options"
                      >
                             <svg width="17" height="3" viewBox="0 0 17 3">
  <circle cx="1.5" cy="1.5" r="1.5" />
  <circle cx="8.5" cy="1.5" r="1.5" />
  <circle cx="15.5" cy="1.5" r="1.5" />
</svg>
                      </button>
                      {contextMenu?.licenseId === (license.id || index) && (
                        <div
                          ref={contextMenuRef}
                          className="license-context-menu"
                          style={{
                            position: 'fixed',
                            top: contextMenu.y,
                            left: contextMenu.x,
                          }}
                        >
                          <button 
                            className="context-menu-item"
                            onClick={() => {
                              handleCopy(license.licenseKey);
                              setContextMenu(null);
                            }}
                          >
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="16" height="16" rx="3" fill="#DEE8F4"/>
<path d="M9.7333 8.46752V10.1825C9.7333 11.6117 9.16163 12.1834 7.73245 12.1834H6.01745C4.58827 12.1834 4.0166 11.6117 4.0166 10.1825V8.46752C4.0166 7.03834 4.58827 6.46667 6.01745 6.46667H7.73245C9.16163 6.46667 9.7333 7.03834 9.7333 8.46752Z" stroke="#292D32" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M12.1835 6.01751V7.73251C12.1835 9.16169 11.6118 9.73336 10.1826 9.73336H9.73348V8.46752C9.73348 7.03834 9.16181 6.46667 7.73264 6.46667H6.4668V6.01751C6.4668 4.58833 7.03847 4.01666 8.46764 4.01666H10.1826C11.6118 4.01666 12.1835 4.58833 12.1835 6.01751Z" stroke="#292D32" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>

                            <span>Copy License key</span>
                          </button>
                          <button 
                            className="context-menu-item"
                            onClick={() => {
                              handleOpenActivateModal(license.id || index);
                            }}
                          >
                           <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="16" height="16" rx="3" fill="#DEE8F4"/>
<path d="M7.49672 4.74327L5.83339 5.36994C5.45005 5.51327 5.13672 5.9666 5.13672 6.37327V8.84994C5.13672 9.24327 5.39672 9.75994 5.71339 9.9966L7.14672 11.0666C7.61672 11.4199 8.39005 11.4199 8.86005 11.0666L10.2934 9.9966C10.6101 9.75994 10.8701 9.24327 10.8701 8.84994V6.37327C10.8701 5.96327 10.5567 5.50994 10.1734 5.3666L8.51005 4.74327C8.22672 4.63994 7.77339 4.63994 7.49672 4.74327Z" stroke="#292D32" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M7.0166 7.95673L7.55327 8.49339L8.9866 7.06006" stroke="#292D32" stroke-linecap="round" stroke-linejoin="round"/>
</svg>

                            <span>Activate License</span>
                          </button>
                          {license.subscriptionId && 
                           license.siteDomain && 
                           license.status !== 'Cancelled' && 
                           license.status !== 'Expired' && 
                           license.status !== 'Cancelling' && 
                           license.status !== 'inactive' && (
                            <button
                              className="context-menu-item context-menu-item-danger"
                              onClick={() => handleCancelSubscription(license.subscriptionId, license.siteDomain, license.licenseKey)}
                              disabled={isCancelling}
                            >
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M12 4L4 12M4 4L12 12" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                              <span>{isCancelling ? 'Cancelling...' : 'Cancel Subscription'}</span>
                            </button>
                          )}
                          <button 
                            className="context-menu-item context-menu-item-disabled"
                            disabled
                          >
                           <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
<g opacity="0.5">
<rect width="16" height="16" rx="3" fill="#DEE8F4"/>
<path d="M8.9665 4.66675H7.03317C6.80651 4.66675 6.4865 4.80008 6.3265 4.96008L4.95984 6.32675C4.79984 6.48675 4.6665 6.80675 4.6665 7.03342V8.96675C4.6665 9.19341 4.79984 9.51341 4.95984 9.67341L6.3265 11.0401C6.4865 11.2001 6.80651 11.3334 7.03317 11.3334H8.9665C9.19317 11.3334 9.51317 11.2001 9.67317 11.0401L11.0398 9.67341C11.1998 9.51341 11.3332 9.19341 11.3332 8.96675V7.03342C11.3332 6.80675 11.1998 6.48675 11.0398 6.32675L9.67317 4.96008C9.51317 4.80008 9.19317 4.66675 8.9665 4.66675Z" stroke="#292D32" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M5.64648 10.3601L10.3598 5.64673" stroke="#292D32" stroke-linecap="round" stroke-linejoin="round"/>
</g>
</svg>

                            <span>Cancel License</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Activate License Modal */}
      {activateModal !== null && (
        <>
          <div className="modal-overlay" onClick={handleCloseActivateModal} />
          <div className="activate-modal">
            <div className="activate-modal-header">
              <h2 className="activate-modal-title">Activate license key</h2>
              <button
                className="activate-modal-close"
                onClick={handleCloseActivateModal}
                title="Close"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M15 5L5 15M5 5L15 15" stroke="#666" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className="activate-modal-body">
              <input
                type="text"
                className="activate-modal-input"
                placeholder="Add your domain"
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleActivateSubmit()}
                autoFocus
              />
              <button
                className="activate-modal-submit"
                onClick={handleActivateSubmit}
              >
                Submit
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
