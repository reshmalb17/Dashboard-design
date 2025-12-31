// Mock data for dashboard design - temporarily disable API calls

export const mockDashboardData = {
  sites: {
    'example.com': {
      status: 'active',
      price: 'price_1234567890',
      created_at: Math.floor(Date.now() / 1000) - 86400, // 1 day ago
    },
    'test-site.com': {
      status: 'active',
      price: 'price_0987654321',
      created_at: Math.floor(Date.now() / 1000) - 172800, // 2 days ago
    },
    'demo-site.com': {
      status: 'pending',
      price: 'price_1122334455',
      created_at: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
    },
  },
  subscriptions: [
    {
      id: 'sub_123',
      status: 'active',
      price_id: 'price_1234567890',
      site: 'example.com',
      interval: 'month',
      current_period_end: Math.floor(Date.now() / 1000) + 2592000, // 30 days from now
      created: Math.floor(Date.now() / 1000) - 86400,
    },
    {
      id: 'sub_456',
      status: 'active',
      price_id: 'price_0987654321',
      site: 'test-site.com',
      interval: 'year',
      current_period_end: Math.floor(Date.now() / 1000) + 31536000, // 1 year from now
      created: Math.floor(Date.now() / 1000) - 172800,
    },
  ],
  pending_sites: ['demo-site.com', 'new-site.com'],
};

export const mockLicensesData = {
  licenses: [
    {
      id: 'lic_001',
      key: 'CB-LICENSE-ABC123XYZ789',
      site: 'example.com',
      status: 'active',
      created_at: Math.floor(Date.now() / 1000) - 86400,
      expires_at: null, // Never expires
    },
    {
      id: 'lic_002',
      key: 'CB-LICENSE-DEF456UVW012',
      site: 'test-site.com',
      status: 'active',
      created_at: Math.floor(Date.now() / 1000) - 172800,
      expires_at: null,
    },
    {
      id: 'lic_003',
      key: 'CB-LICENSE-GHI789RST345',
      site: 'demo-site.com',
      status: 'pending',
      created_at: Math.floor(Date.now() / 1000) - 3600,
      expires_at: null,
    },
  ],
};

// Helper function to simulate API delay
export const mockApiDelay = (ms = 500) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

