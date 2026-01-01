import { useState } from 'react';
import { useNotification } from '../hooks/useNotification';
import './PurchaseLicenseModal.css';

export default function PurchaseLicenseModal({ isOpen, onClose }) {
  const [quantity, setQuantity] = useState(10);
  const [billingCycle, setBillingCycle] = useState('Monthly');
  const { showSuccess, showError } = useNotification();

  // Pricing (example - adjust based on your pricing structure)
  const monthlyPrice = 3.4; // per license
  const yearlyPrice = 2.72; // per license (20% discount)
  
  const totalPrice = billingCycle === 'Monthly' 
    ? (quantity * monthlyPrice).toFixed(2)
    : (quantity * yearlyPrice).toFixed(2);

  const handleDecrease = () => {
    if (quantity > 1) {
      setQuantity(quantity - 1);
    }
  };

  const handleIncrease = () => {
    setQuantity(quantity + 1);
  };

  const handleQuantityChange = (e) => {
    const value = parseInt(e.target.value) || 1;
    if (value >= 1) {
      setQuantity(value);
    }
  };

  const handlePayNow = () => {
    // Here you would typically integrate with payment gateway
    showSuccess(`Processing payment for ${quantity} license key(s) - $${totalPrice}`);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="purchase-modal-overlay" onClick={onClose} />
      <div className="purchase-modal">
        <div className="purchase-modal-header">
          <h2 className="purchase-modal-title">Purchase License Key</h2>
          <button
            className="purchase-modal-close"
            onClick={onClose}
            title="Close"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M15 5L5 15M5 5L15 15" stroke="#000" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="purchase-modal-body">
          <div className="purchase-modal-left">
            <label className="purchase-label">Quantity of license key</label>
            <div className="quantity-controls">
              <button
                className="quantity-btn quantity-btn-decrease"
                onClick={handleDecrease}
                type="button"
              >
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
              />
              <button
                className="quantity-btn quantity-btn-increase"
                onClick={handleIncrease}
                type="button"
              >
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
            >
              Pay Now
            </button>
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
    </>
  );
}

