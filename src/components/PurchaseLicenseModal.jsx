import { useState } from 'react';
import { useNotification } from '../hooks/useNotification';
import { useMemberstack } from '../hooks/useMemberstack';
import { purchaseQuantity } from '../services/api';
import './PurchaseLicenseModal.css';

export default function PurchaseLicenseModal({ isOpen, onClose }) {
  const [quantity, setQuantity] = useState(1);
  const [billingCycle, setBillingCycle] = useState('Monthly');
  const [isProcessing, setIsProcessing] = useState(false);
  const { showSuccess, showError } = useNotification();
  const { userEmail } = useMemberstack();

  // Pricing
  const monthlyPrice = 8;  // per license
  const yearlyPrice = 72;  // per license

  const totalPrice =
    billingCycle === 'Monthly'
      ? (quantity * monthlyPrice).toFixed(2)
      : (quantity * yearlyPrice).toFixed(2);

  const handleDecrease = () => {
    setQuantity((prev) => (prev > 1 ? prev - 1 : 1));
  };

  const handleIncrease = () => {
    setQuantity((prev) => (prev < 100 ? prev + 1 : 100));
  };

 const handleQuantityChange = (e) => {
  const raw = e.target.value;

  if (raw === '') {
    setQuantity('');
    return;
  }

  const value = parseInt(raw, 10);
  if (isNaN(value)) return;

  if (value > 25) {
    showError('Maximum 25 license keys per purchase');
    setQuantity(25);
  } else if (value < 1) {
    setQuantity(1);
  } else {
    setQuantity(value);
  }
};

const handlePayNow = async () => {
  if (!userEmail) {
    showError('Please log in to purchase license keys');
    return;
  }

  const numericQty =
    typeof quantity === 'string' ? parseInt(quantity, 10) : quantity;

  if (!numericQty || numericQty < 1) {
    showError('Please select at least 1 license key');
    return;
  }

  if (numericQty > 25) {
    showError('Maximum 25 license keys per purchase');
    return;
  }

  setIsProcessing(true);

  try {
    const billingPeriod = billingCycle.toLowerCase();
    const response = await purchaseQuantity(userEmail, numericQty, billingPeriod);
    // ...rest as before
  } catch (error) {
    // ...error handling as before
  }
};

//   const handleQuantityBlur = () => {
//   let value = parseInt(quantity, 10);
//   if (isNaN(value) || value < 1) value = 1;
//   if (value > 100) value = 100;
//   setQuantity(value);
// };

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
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M15 5L5 15M5 5L15 15"
                stroke="#000"
                strokeWidth="2"
                strokeLinecap="round"
              />
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
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M8 12H16"
                    stroke="#120F27"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M9 22H15C20 22 22 20 22 15V9C22 4 20 2 15 2H9C4 2 2 4 2 9V15C2 20 4 22 9 22Z"
                    stroke="#120F27"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>

              <input
                type="number"
                className="quantity-input"
                value={quantity}
                onChange={handleQuantityChange}
                // onBlur={handleQuantityBlur}
                min="1"
                max="100"
              />

              <button
                className="quantity-btn quantity-btn-increase"
                onClick={handleIncrease}
                type="button"
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M8 12H16"
                    stroke="#120F27"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M12 16V8"
                    stroke="#120F27"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M9 22H15C20 22 22 20 22 15V9C22 4 20 2 15 2H9C4 2 2 4 2 9V15C2 20 4 22 9 22Z"
                    stroke="#120F27"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
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
