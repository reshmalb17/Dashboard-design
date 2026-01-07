import { useState, useRef, useEffect, useCallback } from 'react';
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
  const [cancelModal, setCancelModal] = useState(null);
  const [domainInput, setDomainInput] = useState('');
  const [domainError, setDomainError] = useState('');
  const [copiedKey, setCopiedKey] = useState(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isActivatingLicense, setActivatingLicense] = useState(false);

  // Queue polling state
  const [isQueuePolling, setIsQueuePolling] = useState(false);
  const [queueProgress, setQueueProgress] = useState(null);
  const intervalIdRef = useRef(null);
  const stoppedRef = useRef(false);

  const contextMenuRef = useRef(null);
  const searchInputRef = useRef(null);
  const { showSuccess, showError } = useNotification();
  const queryClient = useQueryClient();
  const { userEmail } = useMemberstack();

  // Check queue status and update progress
  const checkStatus = useCallback(async () => {
    if (stoppedRef.current || !userEmail) return;

    try {
      const data = await getLicensesStatus(userEmail);

      const status = (data.status || '').toLowerCase().trim();
      const progress = data.progress || {};

      if (status === 'pending' || status === 'processing') {
        setIsQueuePolling(true);
        setQueueProgress(progress);
        
        // Force refetch license data periodically to show new licenses as they're created
        // Use refetchQueries to bypass staleTime: Infinity
        await queryClient.refetchQueries({
          queryKey: queryKeys.dashboard(userEmail),
          type: 'active',
        });
        await queryClient.refetchQueries({
          queryKey: queryKeys.licenses(userEmail),
          type: 'active',
        });
      } else if (status === 'completed') {
        setIsQueuePolling(false);
        setQueueProgress(null);
        stoppedRef.current = true;
        
        if (intervalIdRef.current) {
          clearInterval(intervalIdRef.current);
          intervalIdRef.current = null;
        }
        
        sessionStorage.removeItem('pendingLicensePurchase');
        
        // Final refresh to get all licenses - force refetch
        await queryClient.refetchQueries({
          queryKey: queryKeys.dashboard(userEmail),
          type: 'active',
        });
        await queryClient.refetchQueries({
          queryKey: queryKeys.licenses(userEmail),
          type: 'active',
        });
        
        // Show success message - use completed count from queue, not total licenses
        const completedCount = progress.completed || 0;
        if (completedCount > 0) {
          showSuccess(`Successfully created ${completedCount} license${completedCount > 1 ? 's' : ''}!`);
        } else {
          showSuccess('License creation completed!');
        }
      } else if (status === 'failed') {
        setIsQueuePolling(false);
        setQueueProgress(null);
        stoppedRef.current = true;
        
        if (intervalIdRef.current) {
          clearInterval(intervalIdRef.current);
          intervalIdRef.current = null;
        }
        
        sessionStorage.removeItem('pendingLicensePurchase');
        
        showError(
          data.message ||
            'License creation failed. Please contact support or try again.'
        );
      }
    } catch (err) {
      // Don't stop polling on error, continue polling
    }
  }, [userEmail, queryClient, showSuccess, showError]);

  // Start polling when component mounts if there's a pending purchase
  useEffect(() => {
    if (!userEmail) return;

    // Check if there's a pending purchase in sessionStorage
    const pendingPurchase = sessionStorage.getItem('pendingLicensePurchase');
    if (pendingPurchase) {
      try {
        const purchaseData = JSON.parse(pendingPurchase);
        const purchaseTime = purchaseData.timestamp || 0;
        const timeSincePurchase = Date.now() - purchaseTime;
        
        // Only start polling if purchase was recent (within last 30 minutes)
        // Queue processing should complete within a few minutes
        if (timeSincePurchase < 30 * 60 * 1000) {
          stoppedRef.current = false;
          setIsQueuePolling(true);
          
          // Check immediately
          checkStatus();
          
          // Then poll every 3 seconds
          intervalIdRef.current = setInterval(() => {
            checkStatus();
          }, 3000);
        } else {
          // Purchase is too old, remove from sessionStorage
          sessionStorage.removeItem('pendingLicensePurchase');
        }
      } catch (err) {
        console.error('[Licenses] Error parsing pending purchase:', err);
        sessionStorage.removeItem('pendingLicensePurchase');
      }
    }

    // Cleanup on unmount
    return () => {
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
      }
    };
  }, [userEmail, checkStatus]);


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
              if (!isNaN(dateInMs)) {
                const date = new Date(dateInMs);
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const year = date.getFullYear();
                createdDate = `${month}/${day}/${year}`;
              }
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
              if (!isNaN(dateInMs)) {
                const date = new Date(dateInMs);
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const year = date.getFullYear();
                expiryDate = `${month}/${day}/${year}`;
              }
            } catch {
              expiryDate = 'N/A';
            }
          }

          // Normalize billing period to match filter options
          let billingPeriod = 'N/A';
          const rawBillingPeriod = lic.billing_period || lic.billingPeriod;
          if (rawBillingPeriod) {
            const period = rawBillingPeriod.toLowerCase().trim();
            if (period.endsWith('ly')) {
              billingPeriod = period.charAt(0).toUpperCase() + period.slice(1);
            } else {
              billingPeriod = period.charAt(0).toUpperCase() + period.slice(1) + 'ly';
            }
          }

          // Get platform from license data (if available) or set to N/A
          const platform = lic.platform || lic.source || 'N/A';
          const platformDisplay = platform !== 'N/A' 
            ? platform.charAt(0).toUpperCase() + platform.slice(1).toLowerCase()
            : 'N/A';

          return {
            id: lic.id || lic.license_key,
            licenseKey: lic.license_key || lic.licenseKey || 'N/A',
            status,
            billingPeriod,
            activatedForSite,
            createdDate,
            expiryDate,
            subscriptionId: lic.subscription_id || lic.subscriptionId || null,
            siteDomain: lic.used_site_domain || lic.site_domain || null,
            platform: platformDisplay,
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

  const handleOpenCancelModal = (subscriptionId, siteDomain) => {
    setCancelModal({ subscriptionId, siteDomain });
    setContextMenu(null);
  };

  const handleCloseCancelModal = () => {
    if (isCancelling) return; // Prevent closing during cancellation
    setCancelModal(null);
  };

  const handleCancelSubscription = async () => {
    if (isCancelling) return;
    if (!cancelModal) return;
    
    const { subscriptionId, siteDomain } = cancelModal;
    
    if (!userEmail) {
      showError('User email not found. Please refresh.');
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

    setIsCancelling(true);

    try {
      const response = await cancelSubscription(userEmail, siteDomain, subscriptionId);
      if (response.success) {
        const successMessage = response.message || `Subscription for "${siteDomain}" has been cancelled successfully.`;
        showSuccess(successMessage);

        // Update licenses cache
        queryClient.setQueryData(
          queryKeys.licenses(userEmail),
          (oldData) => {
            if (!oldData) return oldData;

            const updatedLicenses = oldData.licenses?.map((lic) => {
              // Match by subscription ID or site domain
              const matchesSubscription = 
                lic.subscription_id === subscriptionId ||
                lic.subscriptionId === subscriptionId;
              
              const matchesDomain = 
                (lic.used_site_domain || lic.site_domain || '').toLowerCase().trim() ===
                siteDomain.toLowerCase().trim();

              if (matchesSubscription || matchesDomain) {
                return {
                  ...lic,
                  status: 'cancelled', // backend status
                  subscription_id: lic.subscription_id || subscriptionId,
                  subscriptionId: lic.subscriptionId || subscriptionId,
                };
              }

              return lic;
            });

            return {
              ...oldData,
              licenses: updatedLicenses,
            };
          }
        );

        // Update dashboard cache - licenses
        queryClient.setQueryData(
          queryKeys.dashboard(userEmail),
          (oldData) => {
            if (!oldData) return oldData;

            // Update licenses in dashboard
            const updatedLicenses = oldData.licenses?.map((lic) => {
              const matchesSubscription = 
                lic.subscription_id === subscriptionId ||
                lic.subscriptionId === subscriptionId;
              
              const matchesDomain = 
                (lic.used_site_domain || lic.site_domain || '').toLowerCase().trim() ===
                siteDomain.toLowerCase().trim();

              if (matchesSubscription || matchesDomain) {
                return {
                  ...lic,
                  status: 'cancelled',
                  subscription_id: lic.subscription_id || subscriptionId,
                  subscriptionId: lic.subscriptionId || subscriptionId,
                };
              }

              return lic;
            });

            // Update sites
            const updatedSites = { ...oldData.sites };
            if (updatedSites[siteDomain]) {
              updatedSites[siteDomain] = {
                ...updatedSites[siteDomain],
                status: 'cancelled',
              };
            }

            // Update subscriptions
            const subscriptionsArray = Array.isArray(oldData.subscriptions)
              ? oldData.subscriptions
              : Object.values(oldData.subscriptions || {});
            
            const updatedSubscriptions = subscriptionsArray.map((sub) => {
              const subId = sub.subscription_id || sub.subscriptionId || sub.id;
              if (subId === subscriptionId) {
                return {
                  ...sub,
                  status: 'cancelled',
                };
              }
              return sub;
            });

            // Convert back to original format if it was an object
            const subscriptionsFormatted = Array.isArray(oldData.subscriptions)
              ? updatedSubscriptions
              : updatedSubscriptions.reduce((acc, sub) => {
                  const subId = sub.subscription_id || sub.subscriptionId || sub.id;
                  if (subId) {
                    acc[subId] = sub;
                  }
                  return acc;
                }, {});

            return {
              ...oldData,
              licenses: updatedLicenses,
              sites: updatedSites,
              subscriptions: subscriptionsFormatted,
            };
          }
        );

        // Invalidate queries to trigger UI updates
        queryClient.invalidateQueries({
          queryKey: queryKeys.licenses(userEmail),
          refetchType: 'none',
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.dashboard(userEmail),
          refetchType: 'none',
        });

        handleCloseCancelModal();
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
    setDomainError('');
  };

  const handleCloseActivateModal = () => {
    setActivateModal(null);
    setDomainInput('');
    setDomainError('');
  };

  // Validate domain pattern: www.sitename.domain
  const validateDomainPattern = (domain) => {
    // Pattern: www.sitename.domain (e.g., www.example.com, www.test.co.in)
    const domainPattern = /^www\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
    return domainPattern.test(domain.trim());
  };

  // Check if domain is already activated (checks both props and query cache)
  const checkDomainAlreadyActivated = (domain) => {
    const normalizedDomain = domain.trim().toLowerCase();
    
    // Check licenses prop
    if (licenses && Array.isArray(licenses)) {
      const foundInProps = licenses.some((lic) => {
        const activatedDomain = (
          lic.activated_for_site ||
          lic.activatedForSite ||
          lic.used_site_domain ||
          lic.site_domain ||
          ''
        ).toLowerCase().trim();
        
        return activatedDomain === normalizedDomain && activatedDomain !== '';
      });
      
      if (foundInProps) return true;
    }
    
    // Also check query cache for latest data
    const cachedData = queryClient.getQueryData(queryKeys.licenses(userEmail));
    if (cachedData && cachedData.licenses && Array.isArray(cachedData.licenses)) {
      const foundInCache = cachedData.licenses.some((lic) => {
        const activatedDomain = (
          lic.activated_for_site ||
          lic.activatedForSite ||
          lic.used_site_domain ||
          lic.site_domain ||
          ''
        ).toLowerCase().trim();
        
        return activatedDomain === normalizedDomain && activatedDomain !== '';
      });
      
      if (foundInCache) return true;
    }
    
    return false;
  };

  const handleDomainInputChange = (e) => {
    const value = e.target.value;
    setDomainInput(value);
    
    // Clear error when user starts typing
    if (domainError) {
      setDomainError('');
    }
  };

  const validateDomain = async (domain) => {
    const trimmedDomain = domain.trim();
    
    // Check if empty
    if (!trimmedDomain) {
      setDomainError('Please enter a domain');
      return false;
    }

    // Check pattern
    if (!validateDomainPattern(trimmedDomain)) {
      setDomainError('Domain must be in the format: www.sitename.domain (e.g., www.example.com)');
      return false;
    }

    // Check if already activated
    if (checkDomainAlreadyActivated(trimmedDomain)) {
      setDomainError('This domain is already activated. Please use a different domain.');
      return false;
    }

    setDomainError('');
    return true;
  };

  const handleActivateSubmit = async () => {
    if (isActivatingLicense) return; // Prevent multiple submissions

    if (!activateModal?.id) {
      showError('License ID not found');
      return;
    }

    // Validate domain pattern and check for duplicates
    const isValid = await validateDomain(domainInput);
    if (!isValid) {
      return; // Error message is set by validateDomain
    }

    const domainToActivate = domainInput.trim();
    const licenseId = activateModal.id;

    setActivatingLicense(true);

    // Optimistic update - update the UI immediately
    queryClient.setQueryData(queryKeys.licenses(userEmail), (oldData) => {
      if (!oldData) return oldData;
      
      const updatedLicenses = oldData.licenses?.map((lic) => {
        const matchId = lic.id === licenseId || 
                       lic.license_key === licenseId || 
                       lic.licenseKey === licenseId;
        
        if (matchId) {
          return {
            ...lic,
            used_site_domain: domainToActivate,
            site_domain: domainToActivate,
            status: 'active', // Optimistically set as active
          };
        }
        return lic;
      });

      return {
        ...oldData,
        licenses: updatedLicenses,
      };
    });

    try {
      const response = await activateLicense(
        licenseId,
        domainToActivate,
        userEmail,
      );

      if (response.success || !response.error) {
        showSuccess(`License activated for ${domainToActivate}`);
        
        // Update query client state with the response data
        queryClient.setQueryData(queryKeys.licenses(userEmail), (oldData) => {
          if (!oldData) return oldData;
          
          const updatedLicenses = oldData.licenses?.map((lic) => {
            const matchId = lic.id === licenseId || 
                           lic.license_key === licenseId || 
                           lic.licenseKey === licenseId ||
                           (response.license && (
                             lic.id === response.license.id ||
                             lic.license_key === response.license.license_key ||
                             lic.licenseKey === response.license.license_key
                           ));
            
            if (matchId) {
              // Update with response data if available, otherwise use optimistic data
              return {
                ...lic,
                used_site_domain: response.license?.used_site_domain || domainToActivate,
                site_domain: response.license?.site_domain || domainToActivate,
                activated_for_site: response.license?.activated_for_site || domainToActivate,
                status: response.license?.status || 'active',
                ...(response.license || {}), // Merge any additional fields from response
              };
            }
            return lic;
          });

          return {
            ...oldData,
            licenses: updatedLicenses,
          };
        });

        // Also update dashboard data to reflect the activation
        queryClient.setQueryData(queryKeys.dashboard(userEmail), (oldData) => {
          if (!oldData) return oldData;
          
          // Update sites if the response includes site data
          if (response.site) {
            const updatedSites = {
              ...oldData.sites,
              [domainToActivate]: {
                ...oldData.sites?.[domainToActivate],
                ...response.site,
                status: 'active',
              },
            };
            
            return {
              ...oldData,
              sites: updatedSites,
            };
          }
          
          return oldData;
        });

        // Mark queries as stale to trigger re-render with updated cache data
        // This ensures the parent component receives the updated licenses prop without refetching
        queryClient.invalidateQueries({
          queryKey: queryKeys.licenses(userEmail),
          refetchType: 'none', // Don't refetch, just use updated cache
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.dashboard(userEmail),
          refetchType: 'none', // Don't refetch, just use updated cache
        });

        handleCloseActivateModal();
      } else {
        // Revert optimistic update on error
        await queryClient.invalidateQueries({
          queryKey: queryKeys.licenses(userEmail),
        });
        showError(response.message || response.error || 'Failed to activate license');
      }
    } catch (err) {
      // Revert optimistic update on error
      await queryClient.invalidateQueries({
        queryKey: queryKeys.licenses(userEmail),
      });
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
    // Filter by billing period
    if (billingPeriodFilter && billingPeriodFilter.trim() !== '') {
      const filterValue = billingPeriodFilter.trim();
      const licensePeriod = (license.billingPeriod || '').trim();
      // Skip entries with "N/A" billing period when filtering
      if (licensePeriod === 'N/A' || licensePeriod === '') {
        return false;
      }
      // Case-insensitive comparison
      if (licensePeriod.toLowerCase() !== filterValue.toLowerCase()) {
        return false;
      }
    }
    return true;
  });

  return (
    <div className="licenses-container">

      {/* Header */}
      <div className="licenses-header">
        <h1 className="licenses-title">
          Licence Keys
        </h1>

        <div className="licenses-header-controls">
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

      {/* Progress Banner - Show when polling (all tabs) */}
      {isQueuePolling && queueProgress && (
        <div className="licenses-progress-banner">
          <div className="licenses-progress-banner-content">
            <div className="licenses-progress-banner-icon">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2" strokeDasharray="12.566" strokeDashoffset="6.283">
                  <animate attributeName="stroke-dashoffset" values="12.566;0;12.566" dur="1.5s" repeatCount="indefinite" />
                </circle>
              </svg>
            </div>
            <div className="licenses-progress-banner-text">
              <strong>Creating your licenses...</strong>
              <span>
                {queueProgress.completed || 0} of {queueProgress.total || '?'}
                {queueProgress.processing > 0 && ` (${queueProgress.processing} processing)`}
              </span>
            </div>
            <div className="licenses-progress-banner-bar-wrapper">
              <div className="licenses-progress-banner-bar">
                <div 
                  className="licenses-progress-banner-bar-fill" 
                  style={{ 
                    width: queueProgress.total > 0 
                      ? `${((queueProgress.completed || 0) / queueProgress.total) * 100}%` 
                      : '0%' 
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="licenses-table-wrapper">
        <table className="licenses-table">
            <thead>
              <tr>
                <th>License Key</th>
                <th>Billing Period</th>
                <th>Platform</th>
                <th>Activated for site</th>
                <th>Created date</th>
                <th>Expiry date</th>
                <th></th>
              </tr>
            </thead>
          <tbody>
            {filteredLicenses.length === 0 ? (
              <tr>
                <td colSpan="7" className="licenses-empty-cell">
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
                      {activeTab !== 'Cancelled' && (
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
                        {copiedKey === license.licenseKey ? (
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 16 16"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <rect
                              width="16"
                              height="16"
                              rx="3"
                              fill="#10B981"
                            />
                            <path
                              d="M4 8L6.5 10.5L12 5"
                              stroke="white"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        ) : (
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 16 16"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <rect
                              width="16"
                              height="16"
                              rx="3"
                              fill="#DEE8F4"
                            />
                            <path
                              d="M9.7333 8.46752V10.1825C9.7333 11.6117 9.16163 12.1834 7.73245 12.1834H6.01745C4.58827 12.1834 4.0166 11.6117 4.0166 10.1825V8.46752C4.0166 7.03834 4.58827 6.46667 6.01745 6.46667H7.73245C9.16163 6.46667 9.7333 7.03834 9.7333 8.46752Z"
                              stroke="#292D32"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            <path
                              d="M12.1835 6.01751V7.73251C12.1835 9.16169 11.6118 9.73336 10.1826 9.73336H9.73348V8.46752C9.73348 7.03834 9.16181 6.46667 7.73264 6.46667H6.4668V6.01751C6.4668 4.58833 7.03847 4.01666 8.46764 4.01666H10.1826C11.6118 4.01666 12.1835 4.58833 12.1835 6.01751Z"
                              stroke="#292D32"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </button>
                      )}
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
                      {license.platform || 'N/A'}
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
                        style={{ 
                          fontSize: '14px',
                          color: license.activatedForSite === 'Not Assigned' ? '#8A1111' : '#666'
                        }}
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
                                    handleOpenCancelModal(
                                      license.subscriptionId,
                                      license.siteDomain,
                                    )
                                  }
                                >
                                  <span>Cancel Subscription</span>
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
            onClick={isActivatingLicense ? undefined : handleCloseActivateModal}
            style={{ cursor: isActivatingLicense ? 'not-allowed' : 'pointer' }}
          />
          <div className="activate-modal">
            <div className="activate-modal-header">
              <h2 className="activate-modal-title">Activate license key</h2>
              <button
                className="activate-modal-close"
                onClick={isActivatingLicense ? undefined : handleCloseActivateModal}
                title="Close"
                disabled={isActivatingLicense}
                style={{ opacity: isActivatingLicense ? 0.5 : 1, cursor: isActivatingLicense ? 'not-allowed' : 'pointer' }}
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
              {isActivatingLicense && (
                <div className="activate-modal-loading-overlay">
                  Activating license...
                </div>
              )}
              <input
                type="text"
                className={`activate-modal-input ${domainError ? 'error' : ''}`}
                placeholder="www.sitename.domain (e.g., www.example.com)"
                value={domainInput}
                onChange={handleDomainInputChange}
                onBlur={() => {
                  if (domainInput.trim()) {
                    validateDomain(domainInput);
                  }
                }}
                onKeyPress={(e) => e.key === 'Enter' && !isActivatingLicense && handleActivateSubmit()}
                autoFocus
                disabled={isActivatingLicense}
                style={{
                  opacity: isActivatingLicense ? 0.6 : 1,
                  pointerEvents: isActivatingLicense ? 'none' : 'auto',
                }}
              />
              {domainError && (
                <div className="activate-modal-error">
                  {domainError}
                </div>
              )}

              <button
                className={`activate-modal-submit ${isActivatingLicense ? 'activating' : ''}`}
                onClick={handleActivateSubmit}
                disabled={isActivatingLicense}
              >
                {isActivatingLicense ? (
                  <>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      className="activate-spinner"
                    >
                      <circle
                        cx="8"
                        cy="8"
                        r="7"
                        stroke="#fff"
                        strokeWidth="2"
                        strokeDasharray="43.98"
                        strokeDashoffset="10"
                        strokeLinecap="round"
                      />
                    </svg>
                    Activating...
                  </>
                ) : (
                  'Submit'
                )}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Cancel Subscription Modal */}
      {cancelModal !== null && (
        <>
          <div
            className="modal-overlay"
            onClick={isCancelling ? undefined : handleCloseCancelModal}
            style={{ cursor: isCancelling ? 'not-allowed' : 'pointer' }}
          />
          <div className="cancel-modal">
            <div className="cancel-modal-header">
              <h2 className="cancel-modal-title">Cancel Subscription</h2>
              <button
                className="cancel-modal-close"
                onClick={isCancelling ? undefined : handleCloseCancelModal}
                title="Close"
                disabled={isCancelling}
                style={{ opacity: isCancelling ? 0.5 : 1, cursor: isCancelling ? 'not-allowed' : 'pointer' }}
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
            <div className="cancel-modal-body">
              <p className="cancel-modal-message">
                Are you sure you want to cancel the subscription for{' '}
                <strong>"{cancelModal.siteDomain}"</strong>?
              </p>
              <div className="cancel-modal-actions">
                <button
                  className="cancel-modal-cancel-btn"
                  onClick={handleCloseCancelModal}
                  disabled={isCancelling}
                  style={{
                    opacity: isCancelling ? 0.6 : 1,
                    pointerEvents: isCancelling ? 'none' : 'auto',
                  }}
                >
                  Cancel
                </button>
                <button
                  className={`cancel-modal-confirm-btn ${isCancelling ? 'cancelling' : ''}`}
                  onClick={handleCancelSubscription}
                  disabled={isCancelling}
                >
                  {isCancelling ? (
                    <>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        className="cancel-spinner"
                      >
                        <circle
                          cx="8"
                          cy="8"
                          r="7"
                          stroke="#fff"
                          strokeWidth="2"
                          strokeDasharray="43.98"
                          strokeDashoffset="10"
                          strokeLinecap="round"
                        />
                      </svg>
                      Cancelling...
                    </>
                  ) : (
                    'Confirm Cancellation'
                  )}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
// hrr