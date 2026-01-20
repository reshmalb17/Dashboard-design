import { useState, useEffect, useCallback } from 'react';
import { useNotification } from '../hooks/useNotification';
import { useMemberstack } from '../hooks/useMemberstack';
import { purchaseQuantity } from '../services/api';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys} from  '../hooks/useDashboardQueries'
import './PurchaseLicenseModal.css';

export default function PurchaseLicenseModal({ isOpen, onClose }) {
  const [quantity, setQuantity] = useState(1);
  const [billingCycle, setBillingCycle] = useState('Monthly');
  const [isProcessing, setIsProcessing] = useState(false);
  const { showSuccess, showError } = useNotification();
  const { userEmail } = useMemberstack();
  const queryClient = useQueryClient();

  // Polling state
  const [polling, setPolling] = useState(false);

  const monthlyPrice = 8;
  const yearlyPrice = 72;

  const totalPrice =
    billingCycle === 'Monthly'
      ? (quantity * monthlyPrice).toFixed(2)
      : (quantity * yearlyPrice).toFixed(2);

  const handleDecrease = () => setQuantity((prev) => (prev > 1 ? prev - 1 : 1));
  const handleIncrease = () => setQuantity((prev) => (prev < 25 ? prev + 1 : 25));
  const handleQuantityChange = (e) => {
    const value = parseInt(e.target.value, 10);
    if (!isNaN(value) && value >= 1 && value <= 50) setQuantity(value);
  };

  // Polling function
  const pollPurchaseStatus = useCallback(async () => {
    const pending = JSON.parse(sessionStorage.getItem('pendingLicensePurchase'));
    if (!pending) return;

    try {
      // Fetch dashboard data
      const data = await queryClient.fetchQuery({
        queryKey: queryKeys.dashboard(userEmail),
        queryFn: () => queryClient.getQueryData(queryKeys.dashboard(userEmail)), // Or call your API
        staleTime: 0,
      });

      // Check if licenses updated
      const licensesUpdated = data?.licenses?.length >= pending.quantity;
      if (licensesUpdated) {
        showSuccess('License purchase completed!');
        sessionStorage.removeItem('pendingLicensePurchase');
        setPolling(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(userEmail) });
      }
    } catch (error) {
      console.error('Polling error:', error);
    }
  }, [queryClient, userEmail, showSuccess]);

  // Start polling when there is a pending purchase
  useEffect(() => {
    const pending = sessionStorage.getItem('pendingLicensePurchase');
    if (pending) setPolling(true);
  }, []);

  // Poll every 3 seconds
  useEffect(() => {
    if (!polling) return;
    const interval = setInterval(pollPurchaseStatus, 40000);
    return () => clearInterval(interval);
  }, [polling, pollPurchaseStatus]);

  const handlePayNow = async () => {
    if (!userEmail) {
      showError('Please log in to purchase license keys');
      return;
    }

    setIsProcessing(true);

    try {
      const response = await purchaseQuantity(userEmail, quantity, billingCycle.toLowerCase());

      if (response?.checkout_url) {
        // Save pending purchase info
        sessionStorage.setItem(
          'pendingLicensePurchase',
          JSON.stringify({
            quantity,
            billingPeriod: billingCycle.toLowerCase(),
            timestamp: Date.now(),
          })
        );

        setPolling(true); // Start polling immediately

        // Open checkout in popup
        const checkoutWindow = window.open(
          response.checkout_url,
          '_blank',
          'width=600,height=700'
        );

        // Close modal immediately
        onClose();

        if (!checkoutWindow || checkoutWindow.closed) {
          // Fallback to redirect if popup blocked
          setTimeout(() => {
            window.location.href = response.checkout_url;
          }, 500);
        } else {
          // Monitor popup closure
          const checkClosed = setInterval(() => {
            if (checkoutWindow.closed) {
              clearInterval(checkClosed);
              setIsProcessing(false);
            }
          }, 1000);
        }
      } else {
        showError('Failed to create checkout session. Please try again.');
        setIsProcessing(false);
      }
    } catch (error) {
      const errorMessage = error.message?.includes('timeout')
        ? 'Request timeout. Please try again.'
        : error.message || 'Failed to process purchase. Please try again.';
      showError(errorMessage);
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="purchase-modal-overlay" onClick={onClose} />
      <div className="purchase-modal">
        <div className="purchase-modal-header">
          <h2 className="purchase-modal-title">Purchase License Key</h2>
          <button className="purchase-modal-close" onClick={onClose} title="Close">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M15 5L5 15M5 5L15 15" stroke="#000" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="purchase-modal-body">
          <div className="purchase-modal-left">
            <label className="purchase-label">Quantity of license key</label>
            <div className="quantity-controls">
              <button className="quantity-btn quantity-btn-decrease" onClick={handleDecrease}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M8 12H16" stroke="#120F27" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M9 22H15C20 22 22 20 22 15V9C22 4 20 2 15 2H9C4 2 2 4 2 9V15C2 20 4 22 9 22Z" stroke="#120F27" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>

              </button>
              <input
                type="number"
                className="quantity-input"
                value={quantity}
                onChange={handleQuantityChange}
                min="1"
                max="25"
              />
              <button className="quantity-btn quantity-btn-increase" onClick={handleIncrease}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M8 12H16" stroke="#120F27" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M12 16V8" stroke="#120F27" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M9 22H15C20 22 22 20 22 15V9C22 4 20 2 15 2H9C4 2 2 4 2 9V15C2 20 4 22 9 22Z" stroke="#120F27" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>

              </button>
            </div>

            <button
              className="purchase-pay-btn"
              onClick={handlePayNow}
              disabled={isProcessing || !userEmail}
            >
              {isProcessing ? 'Processing...' : 'Pay Now'}
            </button>
            <p className="quantity-max-message">Maximum quantity per purchase is 25 license keys.</p>
          </div>

          <div className="purchase-modal-right">
            <label className="purchase-label">Cost</label>
            <div className="purchase-price">${totalPrice}</div>
            <div className="purchase-billing-options">
              <label className="billing-option">
                <input
                  type="radio"
                  name="billingCycle"
                  value="Yearly"
                  checked={billingCycle === 'Yearly'}
                  onChange={(e) => setBillingCycle(e.target.value)}
                />
                <span className="billing-option-label">
                  Yearly <span className="billing-discount-tag">20%</span>
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
                <span className="billing-option-label" style={{fontWeight:"200"}}>Monthly</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
