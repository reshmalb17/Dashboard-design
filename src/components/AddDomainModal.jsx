import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNotification } from '../hooks/useNotification';
import { addSitesBatch, getSitesStatus } from '../services/api';
import { queryKeys } from '../hooks/useDashboardQueries';
import './AddDomainModal.css';

export default function AddDomainModal({ isOpen, onClose, userEmail }) {
  const [domains, setDomains] = useState(['']);
  const [domainErrors, setDomainErrors] = useState({});
  const [billingCycle, setBillingCycle] = useState('Monthly');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [pollProgress, setPollProgress] = useState(null);
  const { showSuccess, showError } = useNotification();
  const queryClient = useQueryClient();
  const intervalIdRef = useRef(null);
  const stoppedRef = useRef(false);
  const MAX_SITES = 5;

  // Pricing
  const monthlyPrice = 8; // per domain
  const yearlyPrice = 72; // per domain
  
  // Calculate price based on valid domains
  const validDomains = domains.filter((d, idx) => {
    const trimmed = d.trim();
    return trimmed && !domainErrors[idx];
  });
  const totalPrice = billingCycle === 'Monthly' 
    ? (validDomains.length * monthlyPrice).toFixed(2)
    : (validDomains.length * yearlyPrice).toFixed(2);

  // Domain validation pattern
  const domainPattern = /^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

  const validateDomain = (domain, index) => {
    const trimmed = domain.trim();
    const errors = { ...domainErrors };

    if (!trimmed) {
      errors[index] = '';
      setDomainErrors(errors);
      return false;
    }

    // Remove www. prefix for validation
    const normalizedDomain = trimmed.replace(/^www\./i, '');

    if (!domainPattern.test(normalizedDomain)) {
      errors[index] = 'Invalid domain format. Use format like "example.com" or "www.example.com"';
      setDomainErrors(errors);
      return false;
    }

    // Check for duplicates
    const duplicateIndex = domains.findIndex((d, idx) => 
      idx !== index && d.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (duplicateIndex !== -1) {
      errors[index] = 'Duplicate domain';
      setDomainErrors(errors);
      return false;
    }

    delete errors[index];
    setDomainErrors(errors);
    return true;
  };

  const handleDomainChange = (index, value) => {
    const newDomains = [...domains];
    newDomains[index] = value;
    setDomains(newDomains);
    
    // Clear error when user starts typing
    if (domainErrors[index]) {
      const errors = { ...domainErrors };
      delete errors[index];
      setDomainErrors(errors);
    }
  };

  const handleDomainBlur = (index) => {
    validateDomain(domains[index], index);
  };

  const handleAddDomain = () => {
    if (domains.length >= MAX_SITES) {
      showError(`Maximum ${MAX_SITES} sites allowed`);
      return;
    }
    setDomains([...domains, '']);
  };

  // Polling for site creation status
  const checkSitesStatus = async (paymentIntentId) => {
    if (stoppedRef.current) return;

    try {
      const data = await getSitesStatus(userEmail, paymentIntentId);
      const status = (data.status || '').toLowerCase().trim();
      const progress = data.progress || {};

      if (status === 'pending' || status === 'processing') {
        setIsPolling(true);
        setPollProgress(progress);
        
        // Refresh dashboard data
        await queryClient.invalidateQueries({
          queryKey: queryKeys.dashboard(userEmail),
        });
      } else if (status === 'completed') {
        setIsPolling(false);
        setPollProgress(null);
        stoppedRef.current = true;
        
        if (intervalIdRef.current) {
          clearInterval(intervalIdRef.current);
          intervalIdRef.current = null;
        }

        sessionStorage.removeItem('pendingSitesPurchase');
        
        // Final refresh
        await queryClient.invalidateQueries({
          queryKey: queryKeys.dashboard(userEmail),
        });

        const completedCount = progress.completed || 0;
        if (completedCount > 0) {
          showSuccess(`Successfully created ${completedCount} site subscription${completedCount > 1 ? 's' : ''}!`);
        } else {
          showSuccess('Site subscriptions created successfully!');
        }
      } else if (status === 'failed') {
        setIsPolling(false);
        setPollProgress(null);
        stoppedRef.current = true;
        
        if (intervalIdRef.current) {
          clearInterval(intervalIdRef.current);
          intervalIdRef.current = null;
        }

        sessionStorage.removeItem('pendingSitesPurchase');
        showError('Failed to create site subscriptions. Please contact support.');
      }
    } catch (error) {
      console.error('[AddDomainModal] Error checking sites status:', error);
    }
  };

  // Start polling when component mounts if there's a pending purchase
  useEffect(() => {
    if (!isOpen || !userEmail) return;

    const pendingPurchase = sessionStorage.getItem('pendingSitesPurchase');
    if (pendingPurchase) {
      try {
        const purchaseData = JSON.parse(pendingPurchase);
        const paymentIntentId = purchaseData.payment_intent_id;
        
        if (paymentIntentId) {
          stoppedRef.current = false;
          setIsPolling(true);
          
          // Check immediately
          checkSitesStatus(paymentIntentId);
          
          // Then poll every 3 seconds
          intervalIdRef.current = setInterval(() => {
            if (!stoppedRef.current) {
              checkSitesStatus(paymentIntentId);
            }
          }, 3000);
        }
      } catch (err) {
        console.error('[AddDomainModal] Error parsing pending purchase:', err);
      }
    }

    return () => {
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
      }
      stoppedRef.current = true;
    };
  }, [isOpen, userEmail]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
      }
      stoppedRef.current = true;
    };
  }, []);
  const handlePayNow = async () => {
    // Validate user is logged in
    if (!userEmail) {
      showError('Please log in to add sites');
      return;
    }

    // Validate all domains
    const validatedSites = [];
    const errors = {};
    let hasErrors = false;

    domains.forEach((domain, index) => {
      const trimmed = domain.trim();
      if (!trimmed) {
        return; // Skip empty domains
      }

      if (!validateDomain(trimmed, index)) {
        errors[index] = domainErrors[index] || 'Invalid domain';
        hasErrors = true;
        return;
      }

      // Check for duplicates in validated list
      if (validatedSites.some(s => s.toLowerCase() === trimmed.toLowerCase())) {
        errors[index] = 'Duplicate domain';
        hasErrors = true;
        return;
      }

      validatedSites.push(trimmed);
    });

    if (hasErrors) {
      setDomainErrors(errors);
      showError('Please fix domain validation errors');
      return;
    }

    if (validatedSites.length === 0) {
      showError('Please enter at least one valid domain');
      return;
    }

    if (validatedSites.length > MAX_SITES) {
      showError(`Maximum ${MAX_SITES} sites allowed per purchase`);
      return;
    }

    setIsProcessing(true);

    try {
      const billingPeriod = billingCycle.toLowerCase(); // 'monthly' or 'yearly'

      // Call the add-sites-batch endpoint
      const response = await addSitesBatch(userEmail, validatedSites, billingPeriod);

      // Check if checkout_url is returned
      if (response && response.checkout_url) {
        // Store info for polling when user returns
        sessionStorage.setItem('pendingSitesPurchase', JSON.stringify({
          sites: validatedSites,
          billingPeriod,
          payment_intent_id: response.payment_intent_id,
          timestamp: Date.now(),
        }));

        // Open checkout in new tab
        const checkoutWindow = window.open(response.checkout_url, '_blank');
        
        if (!checkoutWindow || checkoutWindow.closed) {
          // Fallback to redirect if popup blocked
          setTimeout(() => {
            window.location.href = response.checkout_url;
          }, 500);
        } else {
          onClose(); // Close modal if popup opened successfully
        }
      } else {
        showError('Failed to create checkout session. Please try again.');
        setIsProcessing(false);
      }
    } catch (error) {
      const errorMessage = error.message || error.error || 'Failed to process payment. Please try again.';
      showError(errorMessage);
      setIsProcessing(false);
    }
  };


  if (!isOpen) return null;

  return (
    <>
      <div className="add-domain-modal-overlay" onClick={onClose} />
      <div className="add-domain-modal">
        <div className="add-domain-modal-header">
          <h2 className="add-domain-modal-title">Add new domain</h2>
          <button
            className="add-domain-modal-close"
            onClick={onClose}
            title="Close"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M15 5L5 15M5 5L15 15" stroke="#000" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="add-domain-modal-body">
          <div className="add-domain-modal-left">
            <label className="add-domain-label">Domain name (Max {MAX_SITES} sites)</label>
            {isPolling && pollProgress && (
              <div className="sites-polling-banner">
                <div className="sites-polling-text">
                  Creating site subscriptions... {pollProgress.completed || 0} of {pollProgress.total || 0} completed
                </div>
                <div className="sites-polling-progress-bar">
                  <div 
                    className="sites-polling-progress-fill"
                    style={{ width: `${((pollProgress.completed || 0) / (pollProgress.total || 1)) * 100}%` }}
                  ></div>
                </div>
              </div>
            )}
            <div className="domain-inputs-list">
              {domains.map((domain, index) => (
                <div key={index} className="domain-input-row">
                  <div className={`domain-input-wrapper ${domainErrors[index] ? 'has-error' : ''}`}>
                    <input
                      type="text"
                      className={`domain-input ${domainErrors[index] ? 'error' : ''}`}
                      value={domain}
                      onChange={(e) => handleDomainChange(index, e.target.value)}
                      onBlur={() => handleDomainBlur(index)}
                      placeholder="example.com or www.example.com"
                      disabled={isProcessing || isPolling}
                    />
                    {domainErrors[index] && (
                      <div className="domain-error-message">{domainErrors[index]}</div>
                    )}
                  </div>
                  {index === domains.length - 1 && domains.length < MAX_SITES ? (
                    <button
                      className="domain-add-btn"
                      onClick={handleAddDomain}
                      title="Add another domain"
                      type="button"
                      disabled={isProcessing || isPolling}
                    >
                      <svg width="31" height="31" viewBox="0 0 31 31" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect width="31" height="31" rx="6" fill="#262E84"/>
                        <path d="M14.4518 21V10H16.5246V21H14.4518ZM10 16.5452V14.4548H21V16.5452H10Z" fill="#F4F6F8"/>
                      </svg>
                    </button>
                  ) : index !== domains.length - 1 ? (
                    <button
                      className="domain-remove-btn"
                      onClick={() => {
                        const newDomains = domains.filter((_, i) => i !== index);
                        setDomains(newDomains);
                        const errors = { ...domainErrors };
                        delete errors[index];
                        // Reindex errors
                        const reindexedErrors = {};
                        Object.keys(errors).forEach(key => {
                          const keyNum = parseInt(key);
                          if (keyNum > index) {
                            reindexedErrors[keyNum - 1] = errors[key];
                          } else {
                            reindexedErrors[key] = errors[key];
                          }
                        });
                        setDomainErrors(reindexedErrors);
                      }}
                      style={{border:"none", cursor:"pointer",background:"transparent"}}
                      title="Remove domain"
                      type="button"
                      disabled={isProcessing || isPolling}
                    >
                      <svg width="31" height="31" viewBox="0 0 31 31" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="0.5" y="0.5" width="30" height="30" rx="5.5" stroke="#717171"/>
                        <path d="M21 11L11 21" stroke="#717171" strokeLinecap="round"/>
                        <path d="M11 11L21 21" stroke="#717171" strokeLinecap="round"/>
                      </svg>
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="add-domain-modal-footer">
              <button
                className="add-domain-pay-btn"
                onClick={handlePayNow}
                disabled={isProcessing || isPolling || validDomains.length === 0}
              >
                {isProcessing ? 'Processing...' : isPolling ? 'Processing...' : `Pay Now (${validDomains.length} site${validDomains.length !== 1 ? 's' : ''})`}
              </button>
            </div>
          </div>

          <div className="add-domain-modal-right">
            <div className="add-domain-modal-right-card">
            <label className="add-domain-label">Cost</label>
            <div className="purchase-price">${totalPrice}</div>
            <div className="add-domain-billing-options">
              <label className="billing-option">
                <input
                  type="radio"
                  name="billingCycle"
                  value="Yearly"
                  checked={billingCycle === 'Yearly'}
                  onChange={(e) => setBillingCycle(e.target.value)}
                />
                <span className="billing-option-label">
                  Yearly
                  <span className="billing-discount-tag">20%</span>
                </span>
              </label>
              <label className="billing-option">
                <input
                  type="radio"
                  name="billingCycle"
                  value="Monthly"
                  checked={billingCycle === 'Monthly'}
                  onChange={(e) => setBillingCycle(e.target.value)}
                />
                <span className="billing-option-label">Monthly</span>
              </label>
            </div>
          </div>
        </div>
</div>
       
      </div>
    </>
  );
}

