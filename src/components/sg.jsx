// Your imports remain the same
import { useState, useRef, useEffect } from 'react';
import { useNotification } from '../hooks/useNotification';
import { cancelSubscription, activateLicense } from '../services/api';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../hooks/useDashboardQueries';
import { useMemberstack } from '../hooks/useMemberstack';
import './Licenses.css';

export default function Licenses({ licenses, isPolling = false }) {
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

  // Prepare licenses
  const displayLicenses = licenses && licenses.length > 0 
    ? licenses.map(lic => {
        const activatedForSite = lic.activated_for_site || lic.activatedForSite || lic.used_site_domain || lic.site_domain || 'Not Assigned';
        const isActivated = activatedForSite !== 'Not Assigned' && activatedForSite !== null && activatedForSite !== undefined && String(activatedForSite).trim() !== '';
        let status = 'Available';
        if (isActivated) {
          const backendStatus = (lic.status || '').toLowerCase().trim();
          status = (backendStatus === 'cancelled' || backendStatus === 'canceled' || backendStatus === 'inactive')
            ? lic.status.charAt(0).toUpperCase() + lic.status.slice(1)
            : 'Active';
        }
        let createdDate = 'N/A';
        const createdAt = lic.created_at || lic.created_date || lic.createdDate;
        if (createdAt) {
          try {
            const timestamp = typeof createdAt === 'number' ? createdAt : parseInt(createdAt);
            const dateInMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
            createdDate = !isNaN(dateInMs) ? new Date(dateInMs).toLocaleDateString() : 'N/A';
          } catch { createdDate = 'N/A'; }
        }
        let expiryDate = 'N/A';
        const expiryTimestamp = lic.renewal_date || lic.expires_at || lic.expiry_date || lic.expiryDate || lic.expiration_date;
        if (expiryTimestamp) {
          try {
            const timestamp = typeof expiryTimestamp === 'number' ? expiryTimestamp : parseInt(expiryTimestamp);
            const dateInMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
            expiryDate = !isNaN(dateInMs) ? new Date(dateInMs).toLocaleDateString() : 'N/A';
          } catch { expiryDate = 'N/A'; }
        }

        return {
          id: lic.id || lic.license_key,
          licenseKey: lic.license_key || lic.licenseKey || 'N/A',
          status,
          billingPeriod: lic.billing_period || lic.billingPeriod || 'N/A',
          activatedForSite,
          createdDate,
          expiryDate,
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
    if (!key || key === 'N/A') return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(key);
      else {
        const textArea = document.createElement('textarea');
        textArea.value = key;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopiedKey(key);
      showSuccess('License key copied to clipboard');
      setTimeout(() => setCopiedKey(null), 2000);
    } catch { showError('Failed to copy license key'); }
  };

  const handleSearchIconClick = () => {
    setIsSearchExpanded(true);
    setTimeout(() => searchInputRef.current?.focus(), 100);
  };

  const handleSearchBlur = () => {
    if (!searchQuery.trim()) setIsSearchExpanded(false);
  };

const handleCancelSubscription = async (subscriptionId, siteDomain) => {
  if (isCancelling) return;
  if (!userEmail) return showError('User email not found. Please refresh.');
  if (!subscriptionId) return showError('Subscription ID not found.');
  if (!siteDomain) return showError('Site domain not found.');

  const confirmed = window.confirm(
    `Are you sure you want to cancel the subscription for "${siteDomain}"?`
  );
  if (!confirmed) return setContextMenu(null);

  setIsCancelling(true);
  setContextMenu(null);

  try {
    const response = await cancelSubscription(userEmail, siteDomain, subscriptionId);
    showSuccess(response.message || 'Subscription cancelled successfully.');

    // Refresh dashboard or relevant queries
    await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(userEmail) });
  } catch (error) {
    showError('Failed to cancel subscription: ' + (error.message || error.error || 'Unknown error'));
  } finally {
    setIsCancelling(false);
  }
};


 const MENU_WIDTH = 180;
const MENU_HEIGHT = 140; // adjust if menu grows

const handleContextMenu = (e, licenseId) => {
  e.preventDefault();
  e.stopPropagation();

  const rect = e.currentTarget.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let top = rect.bottom + 6; // default: below
  let left = rect.left - MENU_WIDTH + rect.width; // open left aligned

  // 🔽 If going out of bottom → open upwards
  if (top + MENU_HEIGHT > viewportHeight) {
    top = rect.top - MENU_HEIGHT - 6;
  }

  // ▶️ If going out of right
  if (left + MENU_WIDTH > viewportWidth) {
    left = viewportWidth - MENU_WIDTH - 8;
  }

  // ◀️ If going out of left
  if (left < 8) {
    left = 8;
  }

  setContextMenu({
    licenseId,
    top,
    left,
  });
};



  const handleOpenActivateModal = (licenseId) => {
    setActivateModal({ id: licenseId });
    setDomainInput('');
  };

  const handleCloseActivateModal = () => {
    setActivateModal(null);
    setDomainInput('');
  };

  const handleActivateSubmit = async () => {
    if (!domainInput.trim()) return showError('Please enter a domain');
    if (!activateModal?.id) return showError('License ID not found');
    try {
      await activateLicense(activateModal.id, domainInput.trim(), userEmail);
      showSuccess(`License activated for ${domainInput}`);
      handleCloseActivateModal();
    } catch (err) {
      showError('Failed to activate license: ' + (err.message || 'Unknown error'));
    }
  };

  // Filter licenses
  const filteredLicenses = displayLicenses.filter(license => {
    if (activeTab === 'Not Assigned' && license.activatedForSite !== 'Not Assigned') return false;
    if (activeTab === 'Activated' && (license.activatedForSite === 'Not Assigned' || license.status !== 'Active')) return false;
    if (activeTab === 'Cancelled' && license.status !== 'Cancelled') return false;
    if (searchQuery && !license.licenseKey.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (billingPeriodFilter && license.billingPeriod !== billingPeriodFilter) return false;
    return true;
  });

  return (
    <div className="licenses-container">
      {/* Header */}
      <div className="licenses-header">
        <h1 className="licenses-title">
          Licence Keys
          {isPolling && (
            <span style={{ 
              marginLeft: '10px', 
              fontSize: '14px', 
              color: '#666', 
              fontWeight: 'normal',
              fontStyle: 'italic'
            }}>
              (Processing new licenses...)
            </span>
          )}
        </h1>
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
              {/* <th>Status</th> */}
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
                  {/* <td>
                    <div className="license-cell-content">
                      <span className={`license-status-${license.status.toLowerCase() === 'active' ? 'active' : license.status.toLowerCase() === 'cancelled' ? 'cancelled' : 'available'}`}>
                        <span className={`status-dot-${license.status.toLowerCase() === 'active' ? 'green' : license.status.toLowerCase() === 'cancelled' ? 'red' : 'blue'}`} />
                        <span>{license.status}</span>
                      </span>
                    </div>
                  </td> */}
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
                        onClick={(e) => handleOpenActivateModal(license.id || index)}
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
                            top: contextMenu.top,
                            left: contextMenu.left,
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
                          { <button 
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
                          </button>}
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
                          )
                          }
                          <button 
                            className="context-menu-item context-menu-item-disabled"
                            disabled
                          >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="16" height="16" rx="3" fill="#DEE8F4"/>
<path d="M11 5.99333C9.89 5.88333 8.77333 5.82666 7.66 5.82666C7 5.82666 6.34 5.85999 5.68 5.92666L5 5.99333" stroke="#292D32" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M6.83301 5.6565L6.90634 5.21984C6.95967 4.90317 6.99967 4.6665 7.56301 4.6665H8.43634C8.99967 4.6665 9.04301 4.9165 9.09301 5.22317L9.16634 5.6565" stroke="#292D32" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M10.283 7.04663L10.0663 10.4033C10.0296 10.9266 9.99964 11.3333 9.06964 11.3333H6.92964C5.99964 11.3333 5.96964 10.9266 5.93298 10.4033L5.71631 7.04663" stroke="#292D32" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M7.44287 9.5H8.55287" stroke="#292D32" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M7.16699 8.1665H8.83366" stroke="#292D32" stroke-linecap="round" stroke-linejoin="round"/>
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
          <div className="modal-overlay"  onClick={(e) => handleCloseActivateModal(e, activateModal.licenseKey)} />
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
