import { useState } from 'react';
import { useNotification } from '../hooks/useNotification';
import './AddDomainModal.css';

export default function AddDomainModal({ isOpen, onClose }) {
  const [domains, setDomains] = useState(['www.domain.com', 'www.domain.com', 'www.domain.com', 'www.domain.com', 'www.domain.com']);
  const [confirmedDomains, setConfirmedDomains] = useState(new Set([0, 1, 2, 3])); // First 4 are confirmed
  const [billingCycle, setBillingCycle] = useState('Monthly');
  const { showSuccess, showError } = useNotification();

  // Pricing (example - adjust based on your pricing structure)
  const monthlyPrice = 3.4; // per domain
  const yearlyPrice = 2.72; // per domain (20% discount)
  
  // Calculate price based on confirmed domains only
  const confirmedCount = confirmedDomains.size;
  const totalPrice = billingCycle === 'Monthly' 
    ? (confirmedCount * monthlyPrice).toFixed(2)
    : (confirmedCount * yearlyPrice).toFixed(2);

  const handleDomainChange = (index, value) => {
    const newDomains = [...domains];
    newDomains[index] = value;
    setDomains(newDomains);
  };

  const handleAddDomain = () => {
    setDomains([...domains, 'www.domain.com']);
  };

  const handleToggleConfirm = (index) => {
    const newConfirmed = new Set(confirmedDomains);
    if (newConfirmed.has(index)) {
      newConfirmed.delete(index);
    } else {
      newConfirmed.add(index);
    }
    setConfirmedDomains(newConfirmed);
  };

  const handlePayNow = () => {
    // Validate domains - only count confirmed domains
    const validDomains = domains.filter((domain, index) => 
      domain.trim() && 
      domain !== 'www.domain.com' && 
      confirmedDomains.has(index)
    );
    
    if (validDomains.length === 0) {
      showError('Please confirm at least one valid domain');
      return;
    }

    // Here you would typically integrate with payment gateway
    showSuccess(`Processing payment for ${validDomains.length} domain(s) - $${totalPrice}`);
    onClose();
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
            <label className="add-domain-label">Domain name</label>
            <div className="domain-inputs-list">
              {domains.map((domain, index) => (
                <div key={index} className="domain-input-row">
                  <input
                    type="text"
                    className="domain-input"
                    value={domain}
                    onChange={(e) => handleDomainChange(index, e.target.value)}
                    placeholder="www.domain.com"
                  />
                  {index === domains.length - 1 ? (
                    <button
                      className="domain-action-btn domain-add-btn"
                      onClick={handleAddDomain}
                      title="Add another domain"
                      type="button"
                    >
                      <svg width="50" height="50" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="50" height="50" rx="6" fill="#262E84"/>
<path d="M23.6205 31.8509V18.1489H26.3485V31.8509H23.6205ZM17.7615 26.3019V23.6979H32.2385V26.3019H17.7615Z" fill="#F4F6F8"/>
</svg>

                    </button>
                  ) : (
                    <button
                      className={`domain-action-btn domain-check-btn ${confirmedDomains.has(index) ? 'confirmed' : ''}`}
                      onClick={() => handleToggleConfirm(index)}
                      title={confirmedDomains.has(index) ? 'Confirmed' : 'Confirm domain'}
                      type="button"
                    >
                    <svg width="50" height="50" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="50" height="50" rx="6" fill="#69B4FF"/>
<path d="M31.6281 20.919C32.0013 20.5768 32.5557 20.6115 32.8661 20.9966C33.1765 21.3816 33.1257 21.9715 32.7525 22.3137L24.5464 29.8374C23.494 30.8022 21.9463 30.7751 20.9842 29.7757L17.8384 26.5071C17.4975 26.1527 17.5011 25.5632 17.8463 25.1894C18.1916 24.8158 18.7473 24.8004 19.0884 25.1547L22.2347 28.4215C22.5553 28.7546 23.0711 28.7641 23.4219 28.4427L31.6281 20.919Z" fill="white"/>
</svg>

                    </button>
                  )}
                </div>
              ))}
            </div>
             <div className="add-domain-modal-footer">
          <button
            className="add-domain-pay-btn"
            onClick={handlePayNow}
          >
            Pay Now
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

