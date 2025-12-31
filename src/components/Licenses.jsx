import { useState, useRef, useEffect } from 'react';
import { useNotification } from '../hooks/useNotification';
import './Licenses.css';

// Mock license keys data for design
const mockLicenses = [
  {
    id: '1',
    licenseKey: 'KEY-GN5B-PUHB-7NLK',
    status: 'Available',
    billingPeriod: 'Yearly',
    activatedForSite: 'Not Assigned',
    createdDate: '12/12/26',
    expiryDate: '12/12/26',
  },
  {
    id: '2',
    licenseKey: 'KEY-GN5B-PUHB-7NLK',
    status: 'Available',
    billingPeriod: 'Monthly',
    activatedForSite: 'Not Assigned',
    createdDate: '12/12/26',
    expiryDate: '12/12/26',
  },
  {
    id: '3',
    licenseKey: 'KEY-GN5B-PUHB-7NLK',
    status: 'Available',
    billingPeriod: 'Yearly',
    activatedForSite: 'Not Assigned',
    createdDate: '12/12/26',
    expiryDate: '12/12/26',
  },
  {
    id: '4',
    licenseKey: 'KEY-GN5B-PUHB-7NLK',
    status: 'Available',
    billingPeriod: 'Yearly',
    activatedForSite: 'Not Assigned',
    createdDate: '12/12/26',
    expiryDate: '12/12/26',
  },
  {
    id: '5',
    licenseKey: 'KEY-GN5B-PUHB-7NLK',
    status: 'Available',
    billingPeriod: 'Yearly',
    activatedForSite: 'Not Assigned',
    createdDate: '12/12/26',
    expiryDate: '12/12/26',
  },
  {
    id: '6',
    licenseKey: 'KEY-GN5B-PUHB-7NLK',
    status: 'Available',
    billingPeriod: 'Yearly',
    activatedForSite: 'Not Assigned',
    createdDate: '12/12/26',
    expiryDate: '12/12/26',
  },
];

export default function Licenses({ licenses }) {
  const [activeTab, setActiveTab] = useState('Not Assigned');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [billingPeriodFilter, setBillingPeriodFilter] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const [activateModal, setActivateModal] = useState(null);
  const [domainInput, setDomainInput] = useState('');
  const contextMenuRef = useRef(null);
  const searchInputRef = useRef(null);
  const { showSuccess, showError } = useNotification();

  // Use mock data if licenses array is empty
  const displayLicenses = licenses && licenses.length > 0 
    ? licenses.map(lic => ({
        id: lic.id || lic.license_key,
        licenseKey: lic.license_key || lic.licenseKey || 'KEY-GN5B-PUHB-7NLK',
        status: lic.status || 'Available',
        billingPeriod: lic.billing_period || lic.billingPeriod || 'Yearly',
        activatedForSite: lic.activated_for_site || lic.activatedForSite || 'Not Assigned',
        createdDate: lic.created_date || lic.createdDate || '12/12/26',
        expiryDate: lic.expiry_date || lic.expiryDate || '12/12/26',
      }))
    : mockLicenses;

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
    try {
      await navigator.clipboard.writeText(key);
      showSuccess('License key copied to clipboard');
    } catch (err) {
      console.error('Failed to copy license key:', err);
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

  const handleContextMenu = (e, licenseId) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      licenseId,
      x: e.clientX,
      y: e.clientY,
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
    if (activeTab === 'Not Assigned' && license.activatedForSite !== 'Not Assigned') return false;
    if (activeTab === 'Activated' && license.activatedForSite === 'Not Assigned') return false;
    if (activeTab === 'Cancelled' && license.status !== 'Cancelled') return false;
    
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

      {/* Filter Tabs */}
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
                <tr key={license.id || index} className={index === 5 ? 'highlighted' : ''}>
                  <td>
                    <div className="license-cell-content license-key-cell">
                      <span className="license-key-text">{license.licenseKey}</span>
                      <button
                        className="license-view-btn"
                        onClick={() => handleCopy(license.licenseKey)}
                        title="View License Key"
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M1 8C1 8 3.5 3 8 3C12.5 3 15 8 15 8C15 8 12.5 13 8 13C3.5 13 1 8 1 8Z" stroke="#666" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          <circle cx="8" cy="8" r="2" stroke="#666" strokeWidth="1.5"/>
                        </svg>
                      </button>
                    </div>
                  </td>
                  <td>
                    <div className="license-cell-content">
                      <span className="license-status-available">
                        <span className="status-dot-blue" />
                        <span>{license.status}</span>
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="license-cell-content">
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
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <circle cx="8" cy="8" r="7" fill="#10B981" stroke="white" strokeWidth="1"/>
                          <path d="M8 5V11M5 8H11" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
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
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M10 10.5C10.4142 10.5 10.75 10.1642 10.75 9.75C10.75 9.33579 10.4142 9 10 9C9.58579 9 9.25 9.33579 9.25 9.75C9.25 10.1642 9.58579 10.5 10 10.5Z" fill="#666"/>
                          <path d="M10 5.5C10.4142 5.5 10.75 5.16421 10.75 4.75C10.75 4.33579 10.4142 4 10 4C9.58579 4 9.25 4.33579 9.25 4.75C9.25 5.16421 9.58579 5.5 10 5.5Z" fill="#666"/>
                          <path d="M10 15.5C10.4142 15.5 10.75 15.1642 10.75 14.75C10.75 14.3358 10.4142 14 10 14C9.58579 14 9.25 14.3358 9.25 14.75C9.25 15.1642 9.58579 15.5 10 15.5Z" fill="#666"/>
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
                              <path d="M5.5 4.5H3.5C2.67157 4.5 2 5.17157 2 6V12.5C2 13.3284 2.67157 14 3.5 14H10C10.8284 14 11.5 13.3284 11.5 12.5V10.5M5.5 4.5C5.5 3.67157 6.17157 3 7 3H11.5C12.3284 3 13 3.67157 13 4.5V9C13 9.82843 12.3284 10.5 11.5 10.5H7C6.17157 10.5 5.5 9.82843 5.5 9V4.5Z" stroke="#666" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
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
                              <path d="M8 10C9.10457 10 10 9.10457 10 8C10 6.89543 9.10457 6 8 6C6.89543 6 6 6.89543 6 8C6 9.10457 6.89543 10 8 10Z" stroke="#666" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M12.5 8C12.5 8.5 12.7 9 13 9.5L14.5 11.5C14.8 11.9 14.7 12.4 14.3 12.7L12.5 14C12.1 14.3 11.6 14.2 11.3 13.8L10 12C9.5 12.3 9 12.5 8.5 12.5H6.5C6 12.5 5.5 12.3 5 12L3.7 13.8C3.4 14.2 2.9 14.3 2.5 14L0.7 12.7C0.3 12.4 0.2 11.9 0.5 11.5L2 9.5C2.3 9 2.5 8.5 2.5 8C2.5 7.5 2.3 7 2 6.5L0.5 4.5C0.2 4.1 0.3 3.6 0.7 3.3L2.5 2C2.9 1.7 3.4 1.8 3.7 2.2L5 4C5.5 3.7 6 3.5 6.5 3.5H8.5C9 3.5 9.5 3.7 10 4L11.3 2.2C11.6 1.8 12.1 1.7 12.5 2L14.3 3.3C14.7 3.6 14.8 4.1 14.5 4.5L13 6.5C12.7 7 12.5 7.5 12.5 8Z" stroke="#666" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            <span>Activate License</span>
                          </button>
                          <button 
                            className="context-menu-item context-menu-item-disabled"
                            disabled
                          >
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M12 4L4 12M4 4L12 12" stroke="#999" strokeWidth="1.5" strokeLinecap="round"/>
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
