import { useState, useRef, useEffect } from 'react';
import { useNotification } from '../hooks/useNotification';
import { cancelSubscription, activateLicense,getLicensesStatus } from '../services/api';
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
  const [isActivatingLicense, setActivatingLicense] = useState(false);

  // NEW: internal polling flag for queue
  const [isQueuePolling, setIsQueuePolling] = useState(false);

  const contextMenuRef = useRef(null);
  const searchInputRef = useRef(null);
  const { showSuccess, showError } = useNotification();
  const queryClient = useQueryClient();
  const { userEmail } = useMemberstack();


const checkStatus = async () => {
  if (stopped) return;

  try {
    // This is JSON already (e.g. { status: 'pending' })
    const data = await getLicensesStatus(userEmail);

    console.log('[Licenses] /api/licenses/status =>', data);

    // no .ok here; just read data.status
    const status = (data.status || '').toLowerCase().trim();

    if (status === 'pending') {
      setIsQueuePolling(true);
    } else if (status === 'completed') {
      setIsQueuePolling(false);
      sessionStorage.removeItem('pendingLicensePurchase');
      stopped = true;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.dashboard(userEmail),
      });
    } else if (status === 'failed') {
      setIsQueuePolling(false);
      sessionStorage.removeItem('pendingLicensePurchase');
      stopped = true;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }

      showError(
        data.message ||
          'License creation failed. Please contact support or try again.'
      );
    }
  } catch (err) {
    console.error('Status check failed', err);
  }
};


  // Prepare licenses
  const displayLicenses =
    licenses && licenses.length > 0
      ? licenses.map((lic) => {
          const activatedForSite =
            lic.activated_for_site ||
            lic.activatedForSite ||
            lic.used_site_domain ||
            lic.site_domain ||
            'Not Assigned';

          const isActivated =
            activatedForSite !== 'Not Assigned' &&
            activatedForSite !== null &&
            activatedForSite !== undefined &&
            String(activatedForSite).trim() !== '';

          const backendStatus = (lic.status || '').toLowerCase().trim();

          let status;
          if (
            backendStatus === 'cancelled' ||
            backendStatus === 'canceled' ||
            backendStatus === 'inactive'
          ) {
            status = 'Cancelled';
          } else if (isActivated) {
            status = 'Active';
          } else {
            status = 'Available';
          }

          let createdDate = 'N/A';
          const createdAt = lic.created_at || lic.created_date || lic.createdDate;
          if (createdAt) {
            try {
              const timestamp =
                typeof createdAt === 'number' ? createdAt : parseInt(createdAt);
              const dateInMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
              createdDate = !isNaN(dateInMs)
                ? new Date(dateInMs).toLocaleDateString()
                : 'N/A';
            } catch {
              createdDate = 'N/A';
            }
          }

          let expiryDate = 'N/A';
          const expiryTimestamp =
            lic.renewal_date ||
            lic.expires_at ||
            lic.expiry_date ||
            lic.expiryDate ||
            lic.expiration_date;
          if (expiryTimestamp) {
            try {
              const timestamp =
                typeof expiryTimestamp === 'number'
                  ? expiryTimestamp
                  : parseInt(expiryTimestamp);
              const dateInMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
              expiryDate = !isNaN(dateInMs)
                ? new Date(dateInMs).toLocaleDateString()
                : 'N/A';
            } catch {
              expiryDate = 'N/A';
            }
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
    } catch {
      showError('Failed to copy license key');
    }
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
      `Are you sure you want to cancel the subscription for "${siteDomain}"?`,
    );
    if (!confirmed) return setContextMenu(null);

    setIsCancelling(true);
    setContextMenu(null);

    try {
      const response = await cancelSubscription(userEmail, siteDomain, subscriptionId);
      console.log('Cancel subscription response:', response);
      if (response.success) {
        showSuccess(response.message || 'Subscription cancelled successfully.');

        queryClient.setQueryData(
          queryKeys.dashboard(userEmail),
          (oldData) => {
            if (!oldData) return oldData;

            const newLicenses = oldData.licenses?.map((lic) => {
              if (
                lic.subscription_id !== subscriptionId &&
                lic.subscriptionId !== subscriptionId
              ) {
                return lic;
              }

              return {
                ...lic,
                status: 'cancelled', // backend status
              };
            });

            return {
              ...oldData,
              licenses: newLicenses,
            };
          }
        );
      }
    } catch (error) {
      showError(
        'Failed to cancel subscription: ' +
          (error.message || error.error || 'Unknown error'),
      );
    } finally {
      setIsCancelling(false);
    }
  };

  const MENU_WIDTH = 180;
  const MENU_HEIGHT = 140;

  const handleContextMenu = (e, licenseId) => {
    // no menu in Cancelled tab
    if (activeTab === 'Cancelled') return;

    e.preventDefault();
    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top = rect.bottom + 6;
    let left = rect.left - MENU_WIDTH + rect.width;

    if (top + MENU_HEIGHT > viewportHeight) {
      top = rect.top - MENU_HEIGHT - 6;
    }
    if (left + MENU_WIDTH > viewportWidth) {
      left = viewportWidth - MENU_WIDTH - 8;
    }
    if (left < 8) {
      left = 8;
    }

    setContextMenu({ licenseId, top, left });
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
    setActivatingLicense(true);

    if (!domainInput.trim()) {
      showError('Please enter a domain');
      setActivatingLicense(false);
      return;
    }

    if (!activateModal?.id) {
      showError('License ID not found');
      setActivatingLicense(false);
      return;
    }

    try {
      const response = await activateLicense(
        activateModal.id,
        domainInput.trim(),
        userEmail,
      );
      console.log('Activation response:', response);

      if (response.success) {
        showSuccess(`License activated for ${domainInput}`);
        await queryClient.invalidateQueries({
          queryKey: queryKeys.dashboard(userEmail),
        });
        handleCloseActivateModal();
      } else {
        showError(response.message || 'Failed to activate license');
      }
    } catch (err) {
      showError('Failed to activate license: ' + (err.message || 'Unknown error'));
    } finally {
      setActivatingLicense(false);
    }
  };

  // Filter licenses
  const filteredLicenses = displayLicenses.filter((license) => {
    if (activeTab === 'Not Assigned' && license.activatedForSite !== 'Not Assigned')
      return false;
    if (
      activeTab === 'Activated' &&
      (license.activatedForSite === 'Not Assigned' || license.status !== 'Active')
    )
      return false;
    if (activeTab === 'Cancelled' && license.status !== 'Cancelled') return false;
    if (
      searchQuery &&
      !license.licenseKey.toLowerCase().includes(searchQuery.toLowerCase())
    )
      return false;
    if (billingPeriodFilter && license.billingPeriod !== billingPeriodFilter)
      return false;
    return true;
  });

  return (
    <div className="licenses-container">
      {(isActivatingLicense || isCancelling) && (
        <div className="global-blocker">
          <div className="global-blocker-spinner">
            {isActivatingLicense ? 'Activating license...' : 'Cancelling subscription...'}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="licenses-header">
        <h1 className="licenses-title">
          Licence Keys
          {isQueuePolling && (
            <span
              style={{
                marginLeft: '10px',
                fontSize: '14px',
                color: '#666',
                fontWeight: 'normal',
                fontStyle: 'italic',
              }}
            >
              (Processing new licenses...)
            </span>
          )}
        </h1>

        <div className="licenses-header-controls">
          {isQueuePolling && (
            <div className="licenses-progress-wrapper">
              <div className="licenses-progress-bar">
                <div className="licenses-progress-bar-inner" />
              </div>
            </div>
          )}

          <div
            className={`licenses-search-wrapper ${
              isSearchExpanded ? 'expanded' : ''
            }`}
          >
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
              <svg
                className="licenses-search-icon"
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M9 17C13.4183 17 17 13.4183 17 9C17 4.58172 13.4183 1 9 1C4.58172 1 1 4.58172 1 9C1 13.4183 4.58172 17 9 17Z"
                  stroke="#666"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M19 19L14.65 14.65"
                  stroke="#666"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="licenses-filter-tabs">
        <div className="licenses-tabs">
          <button
            className={`licenses-tab ${
              activeTab === 'Not Assigned' ? 'active' : ''
            }`}
            onClick={() => setActiveTab('Not Assigned')}
          >
            Not Assigned
          </button>
          <button
            className={`licenses-tab ${
              activeTab === 'Activated' ? 'active' : ''
            }`}
            onClick={() => setActiveTab('Activated')}
          >
            Activated
          </button>
          <button
            className={`licenses-tab ${
              activeTab === 'Cancelled' ? 'active' : ''
            }`}
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
              <th>Billing Period</th>
              <th>Activated for site</th>
              <th>Created date</th>
              <th>Expiry date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredLicenses.length === 0 ? (
              <tr>
                <td colSpan="6" className="licenses-empty-cell">
                  No license keys found
                </td>
              </tr>
            ) : (
              filteredLicenses.map((license, index) => (
                <tr
                  key={license.id || index}
                  className={index === 5 ? 'highlighted' : ''}
                  style={{
                    background:
                      contextMenu?.licenseId === (license.id || index)
                        ? '#0777E61A'
                        : 'transparent',
                  }}
                >
                  <td>
                    <div className="license-cell-content license-key-cell">
                      <span className="license-key-text">{license.licenseKey}</span>
                      <button
                        className="license-view-btn"
                        onClick={() => handleCopy(license.licenseKey)}
                        title={
                          copiedKey === license.licenseKey
                            ? 'Copied!'
                            : 'Copy license key'
                        }
                        disabled={license.licenseKey === 'N/A'}
                        style={{
                          opacity: copiedKey === license.licenseKey ? 0.6 : 1,
                          cursor:
                            license.licenseKey === 'N/A'
                              ? 'not-allowed'
                              : 'pointer',
                        }}
                      >
                        Copy
                      </button>
                    </div>
                  </td>
                  <td>
                    <div
                      className={`license-cell-content ${
                        license.billingPeriod === 'Monthly'
                          ? 'billing-monthly'
                          : 'billing-yearly'
                      }`}
                    >
                      {license.billingPeriod}
                    </div>
                  </td>
                  <td>
                    <div className="license-cell-content">
                      <span
                        className={
                          license.activatedForSite === 'Not Assigned'
                            ? 'not-assigned'
                            : ''
                        }
                      >
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

                  {/* Actions column: hidden for Cancelled tab */}
                  {activeTab !== 'Cancelled' && (
                    <td>
                      <div className="license-cell-content license-actions">
                        <button
                          className="license-actions-btn"
                          onClick={(e) =>
                            handleContextMenu(e, license.id || index)
                          }
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
                            {/* NOT ASSIGNED TAB: copy + activate */}
                            {activeTab === 'Not Assigned' && (
                              <>
                                <button
                                  className="context-menu-item"
                                  onClick={() => {
                                    handleCopy(license.licenseKey);
                                    setContextMenu(null);
                                  }}
                                >
                                  <span>Copy License key</span>
                                </button>

                                <button
                                  className="context-menu-item"
                                  onClick={() => {
                                    handleOpenActivateModal(license.id || index);
                                  }}
                                >
                                  <span>Activate License</span>
                                </button>
                              </>
                            )}

                            {/* ACTIVATED TAB: only cancel subscription */}
                            {activeTab === 'Activated' &&
                              license.subscriptionId &&
                              license.siteDomain &&
                              license.status !== 'Cancelled' &&
                              license.status !== 'Expired' &&
                              license.status !== 'Cancelling' &&
                              license.status !== 'inactive' && (
                                <button
                                  className="context-menu-item context-menu-item-danger"
                                  onClick={() =>
                                    handleCancelSubscription(
                                      license.subscriptionId,
                                      license.siteDomain,
                                      license.licenseKey,
                                    )
                                  }
                                  disabled={isCancelling}
                                >
                                  <span>
                                    {isCancelling
                                      ? 'Cancelling...'
                                      : 'Cancel Subscription'}
                                  </span>
                                </button>
                              )}
                          </div>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Activate License Modal */}
      {activateModal !== null && (
        <>
          <div
            className="modal-overlay"
            onClick={handleCloseActivateModal}
          />
          <div className="activate-modal">
            <div className="activate-modal-header">
              <h2 className="activate-modal-title">Activate license key</h2>
              <button
                className="activate-modal-close"
                onClick={handleCloseActivateModal}
                title="Close"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M15 5L5 15M5 5L15 15"
                    stroke="#666"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
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
                disabled={isActivatingLicense}
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
