import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Error boundary to catch any initialization errors
try {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
} catch (error) {
  console.error('Failed to render app:', error);
  // Fallback: render error message
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `
      <div style="padding: 20px; text-align: center;">
        <h1>Error Loading App</h1>
        <p>${error.message}</p>
        <p>Please refresh the page or check the console for details.</p>
      </div>
    `;
  }
}

