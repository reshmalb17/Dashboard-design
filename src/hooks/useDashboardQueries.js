import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getDashboard, getLicenses, addSite, removeSite, getInvoices } from '../services/api';
// import { getUserProfile } from '../services/api'; // COMMENTED OUT: Profile API endpoint doesn't exist yet

// Query keys
export const queryKeys = {
  dashboard: (email) => ['dashboard', email],
  licenses: (email) => ['licenses', email],
  profile: (email) => ['profile', email],
  invoices: (email, limit, offset) => ['invoices', email, limit, offset],
};

/**
 * Hook to fetch dashboard data (sites, subscriptions, etc.)
 */
export function useDashboardData(userEmail, options = {}) {
  return useQuery({
    queryKey: queryKeys.dashboard(userEmail),
    queryFn: async () => {
      // This function is ONLY called when data doesn't exist in cache
      // With staleTime: Infinity, cached data will be used automatically
      const data = await getDashboard(userEmail);
      return data;
    },
    enabled: !!userEmail && !options.disabled,
    // Data is considered fresh forever - will use cache and NOT refetch from server
    staleTime: Infinity, // Never consider data stale - use cached data forever
    gcTime: 24 * 60 * 60 * 1000, // Keep in cache for 24 hours
    retry: 2, // Retry on failure
    // Never refetch - always use cached data if available
    refetchOnMount: false, // Use cached data, don't refetch
    refetchOnWindowFocus: false, // Use cached data, don't refetch
    refetchOnReconnect: false, // Use cached data, don't refetch
    refetchInterval: false, // Disable automatic refetching
    // Only fetch if data doesn't exist in cache
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
      // This function is ONLY called when data doesn't exist in cache
      // With staleTime: Infinity, cached data will be used automatically
      const data = await getLicenses(userEmail);
      return data;
    },
    enabled: !!userEmail && !options.disabled,
    // Data is considered fresh forever - will use cache and NOT refetch from server
    staleTime: Infinity, // Never consider data stale - use cached data forever
    gcTime: 24 * 60 * 60 * 1000, // Keep in cache for 24 hours
    retry: 2, // Retry on failure
    // Never refetch - always use cached data if available
    refetchOnMount: false, // Use cached data, don't refetch
    refetchOnWindowFocus: false, // Use cached data, don't refetch
    refetchOnReconnect: false, // Use cached data, don't refetch
    refetchInterval: false, // Disable automatic refetching
    // Only fetch if data doesn't exist in cache
    ...options,
  });
}

/**
 * Hook to fetch user invoices
 */
export function useInvoices(userEmail, limit = 10, offset = 0, options = {}) {
  return useQuery({
    queryKey: queryKeys.invoices(userEmail, limit, offset),
    queryFn: async () => {
      // This function is ONLY called when data doesn't exist in cache
      // With staleTime: Infinity, cached data will be used automatically
      const data = await getInvoices(userEmail, limit, offset);
      return data;
    },
    enabled: !!userEmail && !options.disabled,
    // Data is considered fresh forever - will use cache and NOT refetch from server
    staleTime: Infinity, // Never consider data stale - use cached data forever
    gcTime: 24 * 60 * 60 * 1000, // Keep in cache for 24 hours
    retry: 2, // Retry on failure
    // Never refetch - always use cached data if available
    refetchOnMount: false, // Use cached data, don't refetch
    refetchOnWindowFocus: false, // Use cached data, don't refetch
    refetchOnReconnect: false, // Use cached data, don't refetch
    refetchInterval: false, // Disable automatic refetching
    // Only fetch if data doesn't exist in cache
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
 * Hook to fetch user profile data from database
 * COMMENTED OUT: Profile API endpoint doesn't exist yet
 */
/*
export function useUserProfile(userEmail, options = {}) {
  return useQuery({
    queryKey: queryKeys.profile(userEmail),
    queryFn: async () => {
      // This function is ONLY called when data doesn't exist in cache
      const data = await getUserProfile(userEmail);
      return data;
    },
    enabled: !!userEmail && !options.disabled,
    // Data is considered fresh forever - will use cache and NOT refetch from server
    staleTime: Infinity, // Never consider data stale - use cached data forever
    gcTime: 24 * 60 * 60 * 1000, // Keep in cache for 24 hours
    retry: 2, // Retry on failure
    // Never refetch - always use cached data if available
    refetchOnMount: false, // Use cached data, don't refetch
    refetchOnWindowFocus: false, // Use cached data, don't refetch
    refetchOnReconnect: false, // Use cached data, don't refetch
    refetchInterval: false, // Disable automatic refetching
    ...options,
  });
}
*/

/**
 * Hook to refresh all dashboard data
 */
export function useRefreshDashboard(userEmail) {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(userEmail) });
    queryClient.invalidateQueries({ queryKey: queryKeys.licenses(userEmail) });
    queryClient.invalidateQueries({ queryKey: ['invoices', userEmail] }); // Invalidate all invoice queries for this user
    // queryClient.invalidateQueries({ queryKey: queryKeys.profile(userEmail) }); // COMMENTED OUT: Profile API doesn't exist yet
  };
}

