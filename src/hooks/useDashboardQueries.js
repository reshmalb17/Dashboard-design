import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getDashboard, getLicenses, addSite, removeSite } from '../services/api';
import { mockDashboardData, mockLicensesData, mockApiDelay } from '../data/mockData';

// TEMPORARY: Use mock data instead of API calls for design
const USE_MOCK_DATA = true;

// Query keys
export const queryKeys = {
  dashboard: (email) => ['dashboard', email],
  licenses: (email) => ['licenses', email],
};

/**
 * Hook to fetch dashboard data (sites, subscriptions, etc.)
 */
export function useDashboardData(userEmail, options = {}) {
  return useQuery({
    queryKey: queryKeys.dashboard(userEmail),
    queryFn: async () => {
      if (USE_MOCK_DATA) {
        await mockApiDelay(300); // Simulate network delay
        console.log('[Mock] Returning mock dashboard data');
        return mockDashboardData;
      }
      return getDashboard(userEmail);
    },
    enabled: (USE_MOCK_DATA || !!userEmail) && !options.disabled,
    staleTime: 300000, // 5 minutes (matches queryClient default)
    retry: 1, // Fast failure
    ...options,
  });
}

/**
 * Hook to fetch user licenses
 */
export function useLicenses(userEmail, options = {}) {
  return useQuery({
    queryKey: queryKeys.licenses(userEmail),
    queryFn: async () => {
      if (USE_MOCK_DATA) {
        await mockApiDelay(300); // Simulate network delay
        console.log('[Mock] Returning mock licenses data');
        return mockLicensesData;
      }
      return getLicenses(userEmail);
    },
    enabled: (USE_MOCK_DATA || !!userEmail) && !options.disabled,
    staleTime: 300000, // 5 minutes (matches queryClient default)
    retry: 1, // Fast failure
    ...options,
  });
}

/**
 * Hook to add a new site
 */
export function useAddSite(userEmail) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ site, price }) => addSite(userEmail, site, price),
    onMutate: async ({ site, price }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.dashboard(userEmail) });

      // Snapshot previous value
      const previousData = queryClient.getQueryData(queryKeys.dashboard(userEmail));

      // Optimistically update
      queryClient.setQueryData(queryKeys.dashboard(userEmail), (old) => {
        if (!old) return old;
        return {
          ...old,
          sites: {
            ...old.sites,
            [site]: {
              status: 'pending',
              price: price,
              created_at: Math.floor(Date.now() / 1000),
            },
          },
        };
      });

      return { previousData };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(queryKeys.dashboard(userEmail), context.previousData);
      }
    },
    onSuccess: () => {
      // Invalidate and refetch
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(userEmail) });
    },
  });
}

/**
 * Hook to remove a site
 */
export function useRemoveSite(userEmail) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ site }) => removeSite(userEmail, site),
    onMutate: async ({ site }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.dashboard(userEmail) });

      // Snapshot previous value
      const previousData = queryClient.getQueryData(queryKeys.dashboard(userEmail));

      // Optimistically update - mark as inactive
      queryClient.setQueryData(queryKeys.dashboard(userEmail), (old) => {
        if (!old) return old;
        const updatedSites = { ...old.sites };
        if (updatedSites[site]) {
          updatedSites[site] = {
            ...updatedSites[site],
            status: 'inactive',
          };
        }
        return {
          ...old,
          sites: updatedSites,
        };
      });

      return { previousData };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(queryKeys.dashboard(userEmail), context.previousData);
      }
    },
    onSuccess: () => {
      // Invalidate and refetch
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(userEmail) });
    },
  });
}

/**
 * Hook to refresh all dashboard data
 */
export function useRefreshDashboard(userEmail) {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(userEmail) });
    queryClient.invalidateQueries({ queryKey: queryKeys.licenses(userEmail) });
  };
}

