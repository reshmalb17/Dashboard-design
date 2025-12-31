import { createContext, useContext, useReducer, useCallback, useRef } from 'react';
import { getDashboard, getLicenses, addSite, removeSite } from '../services/api';

// Initial state
const initialState = {
  sites: {},
  licenses: [],
  subscriptions: [],
  pendingSites: [],
  loading: false,
  error: null,
  lastUpdated: null,
  cache: new Map(), // In-memory cache
};

// Action types
const ActionTypes = {
  SET_LOADING: 'SET_LOADING',
  SET_ERROR: 'SET_ERROR',
  SET_DASHBOARD_DATA: 'SET_DASHBOARD_DATA',
  SET_LICENSES: 'SET_LICENSES',
  ADD_SITE_OPTIMISTIC: 'ADD_SITE_OPTIMISTIC',
  REMOVE_SITE_OPTIMISTIC: 'REMOVE_SITE_OPTIMISTIC',
  REFRESH_DATA: 'REFRESH_DATA',
  CLEAR_ERROR: 'CLEAR_ERROR',
};

// Reducer
function dashboardReducer(state, action) {
  switch (action.type) {
    case ActionTypes.SET_LOADING:
      return { ...state, loading: action.payload };

    case ActionTypes.SET_ERROR:
      return { ...state, error: action.payload, loading: false };

    case ActionTypes.SET_DASHBOARD_DATA:
      return {
        ...state,
        sites: action.payload.sites || {},
        subscriptions: action.payload.subscriptions || [],
        pendingSites: action.payload.pendingSites || [],
        loading: false,
        error: null,
        lastUpdated: Date.now(),
      };

    case ActionTypes.SET_LICENSES:
      return {
        ...state,
        licenses: action.payload,
        loading: false,
        error: null,
      };

    case ActionTypes.ADD_SITE_OPTIMISTIC:
      // Optimistic update - add site immediately before API confirms
      return {
        ...state,
        sites: {
          ...state.sites,
          [action.payload.site]: {
            status: 'pending',
            price: action.payload.price,
            created_at: Math.floor(Date.now() / 1000),
          },
        },
      };

    case ActionTypes.REMOVE_SITE_OPTIMISTIC:
      // Optimistic update - mark as inactive immediately
      const updatedSites = { ...state.sites };
      if (updatedSites[action.payload]) {
        updatedSites[action.payload] = {
          ...updatedSites[action.payload],
          status: 'inactive',
        };
      }
      return { ...state, sites: updatedSites };

    case ActionTypes.REFRESH_DATA:
      return {
        ...state,
        lastUpdated: null, // Force refresh
      };

    case ActionTypes.CLEAR_ERROR:
      return { ...state, error: null };

    default:
      return state;
  }
}

// Create context
const DashboardContext = createContext(null);

// Provider component
export function DashboardProvider({ children, userEmail }) {
  const [state, dispatch] = useReducer(dashboardReducer, initialState);
  const loadingRef = useRef(false);
  const cacheRef = useRef(new Map());
  const CACHE_TTL = 30000; // 30 seconds cache

  // Clear error
  const clearError = useCallback(() => {
    dispatch({ type: ActionTypes.CLEAR_ERROR });
  }, []);

  // Check if data is fresh (within cache TTL)
  const isDataFresh = useCallback(() => {
    if (!state.lastUpdated) return false;
    return Date.now() - state.lastUpdated < CACHE_TTL;
  }, [state.lastUpdated]);

  // Load dashboard data with caching
  const loadDashboardData = useCallback(async (forceRefresh = false) => {
    if (!userEmail) return;

    // Skip if already loading
    if (loadingRef.current && !forceRefresh) return;

    // Use cache if data is fresh and not forcing refresh
    if (isDataFresh() && !forceRefresh) {
      return;
    }

    loadingRef.current = true;
    dispatch({ type: ActionTypes.SET_LOADING, payload: true });
    dispatch({ type: ActionTypes.CLEAR_ERROR });

    try {
      // Load dashboard and licenses in parallel
      const [dashboardResponse, licensesResponse] = await Promise.all([
        getDashboard(userEmail),
        getLicenses(userEmail),
      ]);

      dispatch({
        type: ActionTypes.SET_DASHBOARD_DATA,
        payload: dashboardResponse,
      });

      dispatch({
        type: ActionTypes.SET_LICENSES,
        payload: licensesResponse.licenses || [],
      });

      // Update cache
      cacheRef.current.set('dashboard', {
        data: dashboardResponse,
        timestamp: Date.now(),
      });
      cacheRef.current.set('licenses', {
        data: licensesResponse.licenses || [],
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('[DashboardContext] Error loading data:', error);
      dispatch({
        type: ActionTypes.SET_ERROR,
        payload: error.message || 'Failed to load dashboard data',
      });
    } finally {
      loadingRef.current = false;
    }
  }, [userEmail, isDataFresh]);

  // Add site with optimistic update
  const handleAddSite = useCallback(
    async (site, price) => {
      if (!site.trim() || !price.trim()) {
        dispatch({
          type: ActionTypes.SET_ERROR,
          payload: 'Please enter both site domain and price ID',
        });
        return;
      }

      // Optimistic update
      dispatch({
        type: ActionTypes.ADD_SITE_OPTIMISTIC,
        payload: { site: site.trim(), price: price.trim() },
      });

      try {
        await addSite(userEmail, site.trim(), price.trim());
        // Refresh data to get actual server state
        await loadDashboardData(true);
      } catch (error) {
        console.error('[DashboardContext] Error adding site:', error);
        // Revert optimistic update on error
        await loadDashboardData(true);
        dispatch({
          type: ActionTypes.SET_ERROR,
          payload: error.message || 'Failed to add site',
        });
        throw error;
      }
    },
    [userEmail, loadDashboardData]
  );

  // Remove site with optimistic update
  const handleRemoveSite = useCallback(
    async (site) => {
      // Optimistic update
      dispatch({
        type: ActionTypes.REMOVE_SITE_OPTIMISTIC,
        payload: site,
      });

      try {
        await removeSite(userEmail, site);
        // Refresh data to get actual server state
        await loadDashboardData(true);
      } catch (error) {
        console.error('[DashboardContext] Error removing site:', error);
        // Revert optimistic update on error
        await loadDashboardData(true);
        dispatch({
          type: ActionTypes.SET_ERROR,
          payload: error.message || 'Failed to remove site',
        });
        throw error;
      }
    },
    [userEmail, loadDashboardData]
  );

  // Refresh all data
  const refreshData = useCallback(() => {
    dispatch({ type: ActionTypes.REFRESH_DATA });
    loadDashboardData(true);
  }, [loadDashboardData]);

  const value = {
    // State
    sites: state.sites,
    licenses: state.licenses,
    subscriptions: state.subscriptions,
    pendingSites: state.pendingSites,
    loading: state.loading,
    error: state.error,
    lastUpdated: state.lastUpdated,

    // Actions
    loadDashboardData,
    handleAddSite,
    handleRemoveSite,
    refreshData,
    clearError,
    isDataFresh,
  };

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  );
}

// Custom hook to use dashboard context
export function useDashboard() {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error('useDashboard must be used within DashboardProvider');
  }
  return context;
}

