import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import "./Dashboard.css";
import total from "../assets/wff.png";
import webflow from "../assets/webflow.png";
import Framer from "../assets/Framer.png";
import www from "../assets/WWW.png";
import { useNotification } from "../hooks/useNotification";
import { cancelSubscription, getLicensesStatus } from "../services/api";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../hooks/useDashboardQueries";
import { useMemberstack } from "../hooks/useMemberstack";

// Status color mapping
const statusColors = {
  Active: { dot: "#118A41", bg: "#B6F5CF", text: "#118A41" },
  Cancelled: { dot: "#8A1111", bg: "#F5B6B6", text: "#8A1111" },
  Cancelling: { dot: "#8A1111", bg: "#F5B6B6", text: "#8A1111" },
  Expired: { dot: "#717171", bg: "#EEECEC", text: "#717171" },
};

// Source color mapping
const sourceColors = {
  "Direct payment": { bg: "#FEF3C7", text: "#92400E" },
  "License Key": { bg: "#E9D5FF", text: "#6B21A8" },
};

export default function Dashboard({
  sites = {},
  subscriptions = {},
  licenses = [],
  isPolling = false,
}) {
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [billingPeriodFilter, setBillingPeriodFilter] = useState("");
  const searchInputRef = useRef(null);
  const [copiedKey, setCopiedKey] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const contextMenuRef = useRef(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelModal, setCancelModal] = useState(null);
  
  // Queue polling state for license generation progress
  const [isQueuePolling, setIsQueuePolling] = useState(false);
  const [queueProgress, setQueueProgress] = useState(null);
  const queueIntervalIdRef = useRef(null);
  const queueStoppedRef = useRef(false);
  
  const { showSuccess, showError } = useNotification();
  const queryClient = useQueryClient();
  const { userEmail } = useMemberstack();

  // Check queue status and update progress (for license generation)
// ... existing code ...


const checkQueueStatus = useCallback(async () => {
  if (queueStoppedRef.current || !userEmail) return;

  try {
    const data = await getLicensesStatus(userEmail);
    console.log('[Dashboard] Queue status response:', data); // Debug log

    const status = (data.status || '').toLowerCase().trim();
    const progress = data.progress || {};

    if (status === 'pending' || status === 'processing') {
      setIsQueuePolling(true);
      setQueueProgress(progress);
      
      // Force refetch license data periodically to show new licenses as they're created
      // Use refetchQueries with force: true to bypass staleTime: Infinity
      const dashboardResult = await queryClient.refetchQueries({
        queryKey: queryKeys.dashboard(userEmail),
        type: 'active',
      });
      
      const licensesResult = await queryClient.refetchQueries({
        queryKey: queryKeys.licenses(userEmail),
        type: 'active',
      });
      
      // Update cache directly with new data if refetch succeeded
      if (licensesResult && licensesResult.length > 0 && licensesResult[0].data) {
        queryClient.setQueryData(queryKeys.licenses(userEmail), licensesResult[0].data);
      }
      
      if (dashboardResult && dashboardResult.length > 0 && dashboardResult[0].data) {
        queryClient.setQueryData(queryKeys.dashboard(userEmail), dashboardResult[0].data);
      }
    } else if (status === 'completed') {
      setIsQueuePolling(false);
      setQueueProgress(null);
      queueStoppedRef.current = true;
      
      if (queueIntervalIdRef.current) {
        clearInterval(queueIntervalIdRef.current);
        queueIntervalIdRef.current = null;
      }
      
      sessionStorage.removeItem('pendingLicensePurchase');
      
      // Final refresh to get all licenses - force refetch and update cache
      const dashboardResult = await queryClient.refetchQueries({
        queryKey: queryKeys.dashboard(userEmail),
        type: 'active',
      });
      
      const licensesResult = await queryClient.refetchQueries({
        queryKey: queryKeys.licenses(userEmail),
        type: 'active',
      });
      
      // Update cache directly with new data
      if (licensesResult && licensesResult.length > 0 && licensesResult[0].data) {
        queryClient.setQueryData(queryKeys.licenses(userEmail), licensesResult[0].data);
      }
      
      if (dashboardResult && dashboardResult.length > 0 && dashboardResult[0].data) {
        queryClient.setQueryData(queryKeys.dashboard(userEmail), dashboardResult[0].data);
      }
      
      // Show success message
      const completedCount = progress.completed || 0;
      if (completedCount > 0) {
        showSuccess(`Successfully created ${completedCount} license${completedCount > 1 ? 's' : ''}!`);
      } else {
        showSuccess('License creation completed!');
      }
    } else if (status === 'failed') {
      setIsQueuePolling(false);
      setQueueProgress(null);
      queueStoppedRef.current = true;
      
      if (queueIntervalIdRef.current) {
        clearInterval(queueIntervalIdRef.current);
        queueIntervalIdRef.current = null;
      }
      
      sessionStorage.removeItem('pendingLicensePurchase');
      
      showError(
        data.message ||
          'License creation failed. Please contact support or try again.'
      );
    } else {
      // Unknown status - log it but don't stop polling
      console.log('[Dashboard] Unknown queue status:', status, data);
    }
  } catch (err) {
    // Log error but don't stop polling
    console.error('[Dashboard] Error checking queue status:', err);
  }
}, [userEmail, queryClient, showSuccess, showError]);

// Start polling when component mounts if there's a pending purchase
useEffect(() => {
  if (!userEmail) return;

  // Check if there's a pending purchase in sessionStorage
  const pendingPurchase = sessionStorage.getItem('pendingLicensePurchase');
  if (pendingPurchase) {
    try {
      const purchaseData = JSON.parse(pendingPurchase);
      const purchaseTime = purchaseData.timestamp || 0;
      const timeSincePurchase = Date.now() - purchaseTime;
      
      // Only start polling if purchase was recent (within last 30 minutes)
      if (timeSincePurchase < 30 * 60 * 1000) {
        queueStoppedRef.current = false;
        setIsQueuePolling(true);
        
        // Check immediately
        checkQueueStatus();
        
        // Then poll every 3 seconds
        queueIntervalIdRef.current = setInterval(() => {
          checkQueueStatus();
        }, 3000);
      } else {
        // Purchase is too old, remove from sessionStorage
        sessionStorage.removeItem('pendingLicensePurchase');
      }
    } catch (err) {
      console.error('[Dashboard] Error parsing pending purchase:', err);
      sessionStorage.removeItem('pendingLicensePurchase');
    }
  }

  // Cleanup on unmount
  return () => {
    if (queueIntervalIdRef.current) {
      clearInterval(queueIntervalIdRef.current);
      queueIntervalIdRef.current = null;
    }
  };
}, [userEmail, checkQueueStatus]);

// ... existing code ...
  // Calculate stats from real data
  const dashboardStats = useMemo(() => {
    // Count activated sites from licenses
    const activatedSites = licenses.filter(
      (lic) =>
        lic.status === "active" &&
        (lic.used_site_domain || lic.site_domain),
    );
    
    const totalDomains = activatedSites.length;
    
    const activeSites = Object.values(sites).filter(
      (site) => site.status === "active" || site.status === "pending",
    ).length;

    // Create a combined map of sites from both sites object and licenses array
    // Priority: sites object first, then licenses (to avoid double-counting)
    const sitePlatformMap = new Map();
    
    // Add sites from sites object
    Object.entries(sites).forEach(([siteDomain, siteData]) => {
      if (siteData && (siteData.platform || siteData.source)) {
        const platform = (siteData.platform || siteData.source || '').toLowerCase().trim();
        if (platform && (platform === 'webflow' || platform === 'framer')) {
          sitePlatformMap.set(siteDomain.toLowerCase().trim(), platform);
        }
      }
    });
    
    // Add sites from licenses (only if not already in sites object)
    licenses.forEach((lic) => {
      const siteDomain = lic.used_site_domain || lic.site_domain;
      if (siteDomain && lic.status === 'active') {
        const normalizedDomain = siteDomain.toLowerCase().trim();
        // Only add if not already in map (sites object takes priority)
        if (!sitePlatformMap.has(normalizedDomain) && lic.platform) {
          const platform = (lic.platform || '').toLowerCase().trim();
          if (platform === 'webflow' || platform === 'framer') {
            sitePlatformMap.set(normalizedDomain, platform);
          }
        }
      }
    });

    // Count platforms from the combined map
    const webflowCount = Array.from(sitePlatformMap.values()).filter(
      (platform) => platform === "webflow"
    ).length;

    const framerCount = Array.from(sitePlatformMap.values()).filter(
      (platform) => platform === "framer"
    ).length;

    console.log('[Dashboard] Platform counts:', {
      webflow: webflowCount,
      framer: framerCount,
      totalSitesInMap: sitePlatformMap.size,
      sitesObjectCount: Object.keys(sites).length,
      licensesCount: licenses.length
    });

    const activatedLicenseKeys = activatedSites.length;

    const notAssignedLicenseKeys = licenses.filter(
      (lic) =>
        lic.status === "active" &&
        !lic.used_site_domain &&
        !lic.site_domain,
    ).length;

    return {
      totalDomains,
      webflow: { count: webflowCount, totalDomains },
      framer: { count: framerCount, totalDomains },
      activatedLicenseKeys,
      notAssignedLicenseKeys,
    };
  }, [sites, licenses]);

  // Process and combine data from subscriptions and activated licenses
  const recentDomains = useMemo(() => {
    const allItems = [];

    const subscriptionsArray = Array.isArray(subscriptions)
      ? subscriptions
      : Object.values(subscriptions || {});

    subscriptionsArray.forEach((subscription) => {
      if (
        !subscription ||
        !subscription.items ||
        !Array.isArray(subscription.items)
      ) {
        return;
      }

      const subscriptionId = subscription.subscriptionId || subscription.id;

      subscription.items.forEach((item, itemIndex) => {
        const siteDomain = item.site || item.site_domain;
        if (!siteDomain || siteDomain.trim() === "") {
          return;
        }

        // Skip placeholder sites
        if (
          siteDomain.startsWith("site_") &&
          /^site_\d+$/.test(siteDomain)
        ) {
          return;
        }
        if (
          (siteDomain.startsWith("license_") ||
            siteDomain.startsWith("quantity_")) &&
          !item.isActivated
        ) {
          return;
        }

        // Determine source
        const source =
          item.purchase_type === "quantity" && item.isActivated
            ? "License Key"
            : "Direct payment";

        // Site name from sites object
        const siteData = sites[siteDomain];
        const siteName =
          siteData?.name || siteData?.site_name || siteDomain;

        // Determine status - check item, subscription, and site data
        let status = "Active";
        
        // First check item status
        if (item.status === "inactive" || item.status === "cancelled" || item.status === "canceled") {
          status = "Cancelled";
        } else if (item.status === "expired") {
          status = "Expired";
        } else if (item.status === "cancelling" || item.status === "canceling") {
          status = "Cancelling";
        }
        // Then check subscription status
        else if (
          subscription.status === "cancelled" ||
          subscription.status === "canceled" ||
          subscription.cancel_at_period_end
        ) {
          if (
            subscription.current_period_end &&
            subscription.current_period_end <
              Math.floor(Date.now() / 1000)
          ) {
            status = "Cancelled";
          } else {
            status = "Cancelling";
          }
        }
        // Finally check site data status
        if (siteData?.status) {
          const siteStatus = (siteData.status || "").toLowerCase().trim();
          if (siteStatus === "expired") {
            status = "Expired";
          } else if (siteStatus === "cancelled" || siteStatus === "canceled" || siteStatus === "inactive") {
            status = "Cancelled";
          } else if (siteStatus === "cancelling" || siteStatus === "canceling") {
            status = "Cancelling";
          }
        }

        // Billing period
        let billingPeriod = "N/A";
        if (subscription.billingPeriod) {
          const period = subscription.billingPeriod.toLowerCase().trim();
          if (period.endsWith("ly")) {
            billingPeriod =
              period.charAt(0).toUpperCase() + period.slice(1);
          } else {
            billingPeriod =
              period.charAt(0).toUpperCase() + period.slice(1) + "ly";
          }
        }

        // Expiration date
        let expirationDate = "N/A";
        const renewalDate =
          item.renewal_date || subscription.current_period_end;
        if (renewalDate) {
          try {
            const timestamp =
              typeof renewalDate === "number"
                ? renewalDate
                : parseInt(renewalDate);
            const dateInMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
            expirationDate = new Date(dateInMs).toLocaleDateString();
          } catch {
            expirationDate = "N/A";
          }
        }

        // Created date
        let created = "N/A";
        const createdAt = item.created_at || subscription.created_at;
        if (createdAt) {
          try {
            const timestamp =
              typeof createdAt === "number"
                ? createdAt
                : parseInt(createdAt);
            const dateInMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
            created = new Date(dateInMs).toLocaleDateString();
          } catch {
            created = "N/A";
          }
        }

        // Get platform from site data
        const platform = siteData?.platform || siteData?.source || "N/A";
        const platformDisplay = platform !== "N/A" 
          ? platform.charAt(0).toUpperCase() + platform.slice(1).toLowerCase()
          : "N/A";

        allItems.push({
          id: subscriptionId
            ? `${subscriptionId}_${itemIndex}`
            : `sub_${itemIndex}_${siteDomain}`,
          domain: siteDomain,
          siteName,
          active: status === "Active" || status === "Cancelling",
          source,
          status,
          billingPeriod,
          expirationDate,
          licenseKey: item.license_key || "N/A",
          created,
          createdTimestamp: createdAt || 0,
          subscriptionId,
          platform: platformDisplay,
        });
      });
    });

    // Process licenses (including cancelled, inactive, etc.)
    licenses.forEach((license) => {
      // Only process licenses that are assigned to a site
      const activatedSite = license.used_site_domain || license.site_domain;
      if (!activatedSite) {
        return; // Skip unassigned licenses
      }

      const alreadyAdded = allItems.some(
        (item) =>
          item.domain.toLowerCase().trim() ===
          activatedSite.toLowerCase().trim(),
      );
      if (alreadyAdded) return;

      if (
        activatedSite.startsWith("license_") ||
        activatedSite.startsWith("quantity_") ||
        activatedSite === "N/A" ||
        activatedSite.startsWith("KEY-")
      ) {
        return;
      }

      // Determine status from license
      const backendStatus = (license.status || "").toLowerCase().trim();
      let status = "Active";
      if (
        backendStatus === "cancelled" ||
        backendStatus === "canceled" ||
        backendStatus === "inactive"
      ) {
        status = "Cancelled";
      } else if (backendStatus === "expired") {
        status = "Expired";
      } else if (backendStatus === "cancelling") {
        status = "Cancelling";
      }

      // Also check site data for status
      const siteData = sites[activatedSite];
      if (siteData) {
        const siteStatus = (siteData.status || "").toLowerCase().trim();
        if (siteStatus === "cancelled" || siteStatus === "canceled" || siteStatus === "inactive") {
          status = "Cancelled";
        } else if (siteStatus === "expired") {
          status = "Expired";
        } else if (siteStatus === "cancelling") {
          status = "Cancelling";
        }
      }

      let expirationDate = "N/A";
      if (license.renewal_date) {
        try {
          const timestamp =
            typeof license.renewal_date === "number"
              ? license.renewal_date
              : parseInt(license.renewal_date);
          const dateInMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
          expirationDate = new Date(dateInMs).toLocaleDateString();
        } catch {
          expirationDate = "N/A";
        }
      }

      let created = "N/A";
      if (license.created_at) {
        try {
          const timestamp =
            typeof license.created_at === "number"
              ? license.created_at
              : parseInt(license.created_at);
          const dateInMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
          created = new Date(dateInMs).toLocaleDateString();
        } catch {
          created = "N/A";
        }
      }

      let billingPeriod = "N/A";
      if (license.billing_period) {
        const period = license.billing_period.toLowerCase().trim();
        if (period.endsWith("ly")) {
          billingPeriod =
            period.charAt(0).toUpperCase() + period.slice(1);
        } else {
          billingPeriod =
            period.charAt(0).toUpperCase() + period.slice(1) + "ly";
        }
      }

      const siteName =
        siteData?.name || siteData?.site_name || activatedSite;

      // Get subscriptionId from license first, then from site data
      const subscriptionId = 
        license.subscription_id || 
        license.subscriptionId || 
        siteData?.subscription_id || 
        siteData?.subscriptionId || 
        null;

      // Get platform from site data
      const platform = siteData?.platform || siteData?.source || "N/A";
      const platformDisplay = platform !== "N/A" 
        ? platform.charAt(0).toUpperCase() + platform.slice(1).toLowerCase()
        : "N/A";

      allItems.push({
        id: `license_${license.license_key || activatedSite}`,
        domain: activatedSite,
        siteName,
        active: status === "Active" || status === "Cancelling",
        source: "License Key",
        status,
        billingPeriod,
        expirationDate,
        licenseKey: license.license_key || "N/A",
        created,
        createdTimestamp: license.created_at || 0,
        subscriptionId,
        platform: platformDisplay,
      });
    });

    return allItems
      .sort((a, b) => {
        if (a.createdTimestamp === 0) return 1;
        if (b.createdTimestamp === 0) return -1;
        return b.createdTimestamp - a.createdTimestamp;
      })
      .slice(0, 20);
  }, [sites, subscriptions, licenses]);

  // Filter domains based on search query and billing period
  const filteredDomains = useMemo(() => {
    let filtered = recentDomains;

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (domain) =>
          domain.domain.toLowerCase().includes(query) ||
          domain.licenseKey.toLowerCase().includes(query),
      );
    }

    // Filter by billing period
    if (billingPeriodFilter && billingPeriodFilter.trim() !== "") {
      const filterValue = billingPeriodFilter.trim();
      filtered = filtered.filter((domain) => {
        const domainPeriod = (domain.billingPeriod || "").trim();
        // Skip entries with "N/A" billing period
        if (domainPeriod === "N/A" || domainPeriod === "") {
          return false;
        }
        // Normalize and compare (case-insensitive)
        return domainPeriod.toLowerCase() === filterValue.toLowerCase();
      });
    }

    return filtered;
  }, [recentDomains, searchQuery, billingPeriodFilter]);

  useEffect(() => {
    if (searchExpanded && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchExpanded]);

  const handleSearchClick = () => setSearchExpanded(true);

  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value);
  };

  const handleSearchBlur = () => {
    if (searchQuery === "") setSearchExpanded(false);
  };
  

  const handleCopyLicenseKey = async (licenseKey) => {
    if (!licenseKey || licenseKey === "N/A") return;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(licenseKey);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = licenseKey;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          document.execCommand("copy");
        } catch {
          // ignore
        }
        document.body.removeChild(textArea);
      }

      setCopiedKey(licenseKey);
      showSuccess("License key copied to clipboard!");
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      showError("Failed to copy license key");
    }
  };


  const handleMenuClick = (e, domain) => {
    e.stopPropagation();
    if (!domain.subscriptionId) {
      return; // Don't open menu if no subscriptionId
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const MENU_WIDTH = 180;
    const MENU_HEIGHT = 50;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top = rect.bottom + 6;
    let left = rect.left - MENU_WIDTH + rect.width;

    if (top + MENU_HEIGHT > viewportHeight) {
      top = rect.top - MENU_HEIGHT - 6;
    }
    if (left + MENU_WIDTH > viewportWidth) {
      left = viewportWidth - MENU_WIDTH - 8;
    }
    if (left < 8) {
      left = 8;
    }

    setContextMenu({
      id: domain.id,
      top,
      left,
      subscriptionId: domain.subscriptionId,
      domainName: domain.domain,
      siteDomain: domain.domain,
    });
  };
  // Close context menu when clicking outside (currently unused in active JSX)
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(event.target)
      ) {
        setContextMenu(null);
      }
    };

    if (contextMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [contextMenu]);

  const handleOpenCancelModal = (subscriptionId, domainName, siteDomain) => {
    setCancelModal({ subscriptionId, domainName, siteDomain });
    setContextMenu(null);
  };

  const handleCloseCancelModal = () => {
    if (isCancelling) return; // Prevent closing during cancellation
    setCancelModal(null);
  };

  // const handleCancelSubscription = async () => {
  //   if (isCancelling) return;
  //   if (!cancelModal) return;

  //   const { subscriptionId, siteDomain, domainName } = cancelModal;

  //   if (!userEmail) {
  //     showError("User email not found. Please refresh the page.");
  //     return;
  //   }

  //   if (!subscriptionId) {
  //     showError("Subscription ID not found.");
  //     return;
  //   }

  //   if (!siteDomain) {
  //     showError("Site domain not found.");
  //     return;
  //   }

  //   setIsCancelling(true);

  //   try {
  //     const response = await cancelSubscription(
  //       userEmail,
  //       siteDomain,
  //       subscriptionId,
  //     );
  //     const message =
  //       response.message ||
  //       "Subscription cancelled successfully. The subscription will remain active until the end of the current billing period.";
  //     showSuccess(message);

  //     // Update dashboard cache
  //     queryClient.setQueryData(
  //       queryKeys.dashboard(userEmail),
  //       (oldData) => {
  //         if (!oldData) return oldData;

  //         // Update sites
  //         const updatedSites = { ...oldData.sites };
  //         if (updatedSites[siteDomain]) {
  //           updatedSites[siteDomain] = {
  //             ...updatedSites[siteDomain],
  //             status: 'cancelled',
  //           };
  //         }

  //         // Update subscriptions
  //         const subscriptionsArray = Array.isArray(oldData.subscriptions)
  //           ? oldData.subscriptions
  //           : Object.values(oldData.subscriptions || {});
          
  //         const updatedSubscriptions = subscriptionsArray.map((sub) => {
  //           const subId = sub.subscription_id || sub.subscriptionId || sub.id;
  //           if (subId === subscriptionId) {
  //             return {
  //               ...sub,
  //               status: 'cancelled',
  //             };
  //           }
  //           return sub;
  //         });

  //         // Convert back to original format if it was an object
  //         const subscriptionsFormatted = Array.isArray(oldData.subscriptions)
  //           ? updatedSubscriptions
  //           : updatedSubscriptions.reduce((acc, sub) => {
  //               const subId = sub.subscription_id || sub.subscriptionId || sub.id;
  //               if (subId) {
  //                 acc[subId] = sub;
  //               }
  //               return acc;
  //             }, {});

  //         return {
  //           ...oldData,
  //           sites: updatedSites,
  //           subscriptions: subscriptionsFormatted,
  //         };
  //       }
  //     );

  //     // Invalidate queries to trigger UI updates
  //     await queryClient.invalidateQueries({
  //       queryKey: queryKeys.dashboard(userEmail),
  //     });

  //     handleCloseCancelModal();
  //   } catch (error) {
  //     const errorMessage = error.message || error.error || "Unknown error";
  //     showError("Failed to cancel subscription: " + errorMessage);
  //   } finally {
  //     setIsCancelling(false);
  //   }
  // };
  const handleCancelSubscription = async () => {
    if (isCancelling) return;
    if (!cancelModal) return;
    
    const { subscriptionId, siteDomain } = cancelModal;
    
    if (!userEmail) {
      showError('User email not found. Please refresh.');
      return;
    }
    if (!subscriptionId) {
      showError('Subscription ID not found.');
      return;
    }
    if (!siteDomain) {
      showError('Site domain not found.');
      return;
    }

    setIsCancelling(true);

    try {
      const response = await cancelSubscription(userEmail, siteDomain, subscriptionId);
      if (response.success) {
        const successMessage = response.message || `Subscription for "${siteDomain}" has been cancelled successfully.`;
        showSuccess(successMessage);

        // Update licenses cache
        queryClient.setQueryData(
          queryKeys.licenses(userEmail),
          (oldData) => {
            if (!oldData) return oldData;

            const updatedLicenses = oldData.licenses?.map((lic) => {
              // Match by subscription ID or site domain
              const matchesSubscription = 
                lic.subscription_id === subscriptionId ||
                lic.subscriptionId === subscriptionId;
              
              const matchesDomain = 
                (lic.used_site_domain || lic.site_domain || '').toLowerCase().trim() ===
                siteDomain.toLowerCase().trim();

              if (matchesSubscription || matchesDomain) {
                return {
                  ...lic,
                  status: 'cancelled', // backend status
                  subscription_id: lic.subscription_id || subscriptionId,
                  subscriptionId: lic.subscriptionId || subscriptionId,
                };
              }

              return lic;
            });

            return {
              ...oldData,
              licenses: updatedLicenses,
            };
          }
        );

        // Update dashboard cache - licenses
        queryClient.setQueryData(
          queryKeys.dashboard(userEmail),
          (oldData) => {
            if (!oldData) return oldData;

            // Update licenses in dashboard
            const updatedLicenses = oldData.licenses?.map((lic) => {
              const matchesSubscription = 
                lic.subscription_id === subscriptionId ||
                lic.subscriptionId === subscriptionId;
              
              const matchesDomain = 
                (lic.used_site_domain || lic.site_domain || '').toLowerCase().trim() ===
                siteDomain.toLowerCase().trim();

              if (matchesSubscription || matchesDomain) {
                return {
                  ...lic,
                  status: 'cancelled',
                  subscription_id: lic.subscription_id || subscriptionId,
                  subscriptionId: lic.subscriptionId || subscriptionId,
                };
              }

              return lic;
            });

            // Update sites
            const updatedSites = { ...oldData.sites };
            if (updatedSites[siteDomain]) {
              updatedSites[siteDomain] = {
                ...updatedSites[siteDomain],
                status: 'cancelled',
              };
            }

            // Update subscriptions
            const subscriptionsArray = Array.isArray(oldData.subscriptions)
              ? oldData.subscriptions
              : Object.values(oldData.subscriptions || {});
            
            const updatedSubscriptions = subscriptionsArray.map((sub) => {
              const subId = sub.subscription_id || sub.subscriptionId || sub.id;
              if (subId === subscriptionId) {
                return {
                  ...sub,
                  status: 'cancelled',
                };
              }
              return sub;
            });

            // Convert back to original format if it was an object
            const subscriptionsFormatted = Array.isArray(oldData.subscriptions)
              ? updatedSubscriptions
              : updatedSubscriptions.reduce((acc, sub) => {
                  const subId = sub.subscription_id || sub.subscriptionId || sub.id;
                  if (subId) {
                    acc[subId] = sub;
                  }
                  return acc;
                }, {});

            return {
              ...oldData,
              licenses: updatedLicenses,
              sites: updatedSites,
              subscriptions: subscriptionsFormatted,
            };
          }
        );

        // Invalidate queries to trigger UI updates
        queryClient.invalidateQueries({
          queryKey: queryKeys.licenses(userEmail),
          refetchType: 'none',
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.dashboard(userEmail),
          refetchType: 'none',
        });

        handleCloseCancelModal();
      }
    } catch (error) {
      showError(
        'Failed to cancel subscription: ' +
          (error.message || error.error || 'Unknown error'),
      );
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div className="dashboard-section">
      {/* Summary Statistics */}
      <div className="dashboard-stats">
        <div className="stat-card total-domains">
          <div className="stat-label">Total Domains</div>
          <div
            className="stat-value"
            style={{ fontSize: "80px", fontWeight: "200" }}
          >
            {dashboardStats.totalDomains}
          </div>
          <div className="stat-icons">
            <img src={total} alt="total" />
          </div>
        </div>

        <div className="stat-card webflow-card">
          <div className="stat-label">Webflow</div>
          <div className="stat-value">
            <span>{dashboardStats.webflow.count}</span>
            <span style={{ fontWeight: 400, color: "#5C577D" }}>
              /{dashboardStats.webflow.totalDomains}
            </span>
          </div>
          <div className="stat-background-icon webflow-bg">
            <img src={webflow} alt="webflow" />
          </div>
        </div>

        <div className="stat-card license-card">
          <div className="stat-label">Activated license keys</div>
          <div className="stat-value" style={{ color: "#5C577D" }}>
            {dashboardStats.activatedLicenseKeys}
          </div>
          <div className="stat-background-icon webflow-bg">
            <img style={{ width: "auto" }} src={www} alt="webflow" />
          </div>
        </div>

        <div className="stat-card framer-card">
          <div className="stat-label">Framer</div>
          <div className="stat-value">
            <span>{dashboardStats.framer.count}</span>
            <span style={{ fontWeight: 400, color: "#5C577D" }}>
              /{dashboardStats.framer.totalDomains}
            </span>
          </div>
          <div className="stat-background-icon framer-bg">
            <img src={Framer} alt="framer" />
          </div>
        </div>

        <div className="stat-card not-assigned-card">
          <div className="stat-label">
            <span>Unassigned </span>license keys
          </div>
          <div
            className="stat-value not-assigned-value"
            style={{ color: "#5C577D" }}
          >
            {dashboardStats.notAssignedLicenseKeys}
          </div>
        </div>
      </div>

      {/* Progress Banner - Show when license generation is in progress */}
     
{/* Progress Banner - Show when license generation is in progress */}
{isQueuePolling && queueProgress && (
  <div className="licenses-progress-banner" style={{ marginBottom: '24px' }}>
    <div className="licenses-progress-banner-content">
      <div className="licenses-progress-banner-icon">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2" strokeDasharray="12.566" strokeDashoffset="6.283">
            <animate attributeName="stroke-dashoffset" values="12.566;0;12.566" dur="1.5s" repeatCount="indefinite" />
          </circle>
        </svg>
      </div>
      <div className="licenses-progress-banner-text">
        <strong>Creating your licenses...</strong>
        <span>
          {queueProgress.completed || 0} of {queueProgress.total || '?'}
          {queueProgress.processing > 0 && ` (${queueProgress.processing} processing)`}
        </span>
      </div>
      <div className="licenses-progress-banner-bar-wrapper">
        <div className="licenses-progress-banner-bar">
          <div 
            className="licenses-progress-banner-bar-fill" 
            style={{ 
              width: queueProgress.total > 0 
                ? `${((queueProgress.completed || 0) / queueProgress.total) * 100}%` 
                : '0%' 
            }}
          />
        </div>
      </div>
    </div>
  </div>
)}



      {/* Recent Domains Table */}
      <div className="recent-domains-section">
        <div className="recent-domains-header">
          <h3 className="recent-domains-title">Recent domains</h3>
          <div className="filter-wraper" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <select
              className="domains-filter-select"
              value={billingPeriodFilter}
              onChange={(e) => setBillingPeriodFilter(e.target.value)}
            >
              <option value="">Billing Period</option>
              <option value="Monthly">Monthly</option>
              <option value="Yearly">Yearly</option>
            </select>
            <div
              className={`search-container ${
                searchExpanded ? "expanded" : ""
              }`}
            >
              {searchExpanded ? (
                <input
                  ref={searchInputRef}
                  type="text"
                  className="search-input"
                  placeholder="Search domains..."
                  value={searchQuery}
                  onChange={handleSearchChange}
                  onBlur={handleSearchBlur}
                />
              ) : (
                <button
                  className="search-icon-btn"
                  onClick={handleSearchClick}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 20 20"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M9 17A8 8 0 1 0 9 1a8 8 0 0 0 0 16zM19 19l-4.35-4.35"
                      stroke="#666"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="recent-domains-table-container">
          <table className="recent-domains-table">
            <thead>
              <tr>
                <th>Active</th>
                <th>Status</th>
                <th>Billing Period</th>
                <th>Expiration Date</th>
                <th>License Key</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredDomains.map((domain) => (
                <tr key={domain.id}>
                  <td className="black">{domain.domain}</td>
                  <td>
                    <span
                      className="status-tag"
                      style={{
                        backgroundColor:
                          statusColors[domain.status]?.bg || "#F3F4F6",
                        color:
                          statusColors[domain.status]?.text || "#374151",
                      }}
                    >
                      <span
                        className="status-dot"
                        style={{
                          backgroundColor:
                            statusColors[domain.status]?.dot ||
                            "#6B7280",
                        }}
                      ></span>
                      {domain.status}
                    </span>
                  </td>
                  <td>
                    <span
                      className={
                        domain.billingPeriod === "Monthly"
                          ? "billing-monthly"
                          : ""
                      }
                    >
                      {domain.billingPeriod}
                    </span>
                  </td>
                  <td className="black">{domain.expirationDate}</td>
                  <td className="black">
                    <div className="license-key-cell">
                      <span>{domain.licenseKey}</span>
                      {domain.licenseKey !== "N/A" && (
                        <button
                          className="copy-icon-btn"
                          onClick={() =>
                            handleCopyLicenseKey(domain.licenseKey)
                          }
                          title="Copy license key"
                        >
                          {copiedKey === domain.licenseKey ? (
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 16 16"
                              fill="none"
                              xmlns="http://www.w3.org/2000/svg"
                            >
                              <rect
                                width="16"
                                height="16"
                                rx="3"
                                fill="#10B981"
                              />
                              <path
                                d="M4 8L6.5 10.5L12 5"
                                stroke="white"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          ) : (
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 16 16"
                              fill="none"
                              xmlns="http://www.w3.org/2000/svg"
                            >
                              <rect
                                width="16"
                                height="16"
                                rx="3"
                                fill="#DEE8F4"
                              />
                              <path
                                d="M9.7333 8.46752V10.1825C9.7333 11.6117 9.16163 12.1834 7.73245 12.1834H6.01745C4.58827 12.1834 4.0166 11.6117 4.0166 10.1825V8.46752C4.0166 7.03834 4.58827 6.46667 6.01745 6.46667H7.73245C9.16163 6.46667 9.7333 7.03834 9.7333 8.46752Z"
                                stroke="#292D32"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              <path
                                d="M12.1835 6.01751V7.73251C12.1835 9.16169 11.6118 9.73336 10.1826 9.73336H9.73348V8.46752C9.73348 7.03834 9.16181 6.46667 7.73264 6.46667H6.4668V6.01751C6.4668 4.58833 7.03847 4.01666 8.46764 4.01666H10.1826C11.6118 4.01666 12.1835 4.58833 12.1835 6.01751Z"
                                stroke="#292D32"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="black">{domain.created}</td>
                  <td>
                    <div style={{ position: "relative" }}>
                      {domain.subscriptionId && domain.status !== "Cancelled" && domain.status !== "Expired" && (
                        <>
                          <button
                            className="actions-btn"
                            onClick={(e) => handleMenuClick(e, domain)}
                            title="Actions"
                          >
                            <svg width="17" height="3" viewBox="0 0 17 3">
                              <circle cx="1.5" cy="1.5" r="1.5" />
                              <circle cx="8.5" cy="1.5" r="1.5" />
                              <circle cx="15.5" cy="1.5" r="1.5" />
                            </svg>
                          </button>
                          {contextMenu?.id === domain.id && (
                            <div
                              ref={contextMenuRef}
                              className="license-context-menu"
                              style={{
                                position: "fixed",
                                top: contextMenu.top,
                                left: contextMenu.left,
                              }}
                            >
                              <button
                                className="context-menu-item context-menu-item-danger"
                                onClick={() =>
                                  handleOpenCancelModal(
                                    contextMenu.subscriptionId,
                                    contextMenu.domainName,
                                    contextMenu.siteDomain,
                                  )
                                }
                                disabled={isCancelling || domain.status === "Cancelled" || domain.status === "Expired"}
                              >
                                <span>Cancel Subscription</span>
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cancel Subscription Modal */}
      {cancelModal !== null && (
        <>
          <div
            className="modal-overlay"
            onClick={isCancelling ? undefined : handleCloseCancelModal}
            style={{ cursor: isCancelling ? 'not-allowed' : 'pointer' }}
          />
          <div className="cancel-modal">
            <div className="cancel-modal-header">
              <h2 className="cancel-modal-title">Cancel Subscription</h2>
              <button
                className="cancel-modal-close"
                onClick={isCancelling ? undefined : handleCloseCancelModal}
                title="Close"
                disabled={isCancelling}
                style={{ opacity: isCancelling ? 0.5 : 1, cursor: isCancelling ? 'not-allowed' : 'pointer' }}
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
                    stroke="#666"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
            <div className="cancel-modal-body">
              <p className="cancel-modal-message">
                Are you sure you want to cancel the subscription for{' '}
                <strong>"{cancelModal.domainName || cancelModal.siteDomain}"</strong>? The subscription will remain active until the end of the current billing period.
              </p>
              <div className="cancel-modal-actions">
                <button
                  className="cancel-modal-cancel-btn"
                  onClick={handleCloseCancelModal}
                  disabled={isCancelling}
                  style={{
                    opacity: isCancelling ? 0.6 : 1,
                    pointerEvents: isCancelling ? 'none' : 'auto',
                  }}
                >
                  Cancel
                </button>
                <button
                  className={`cancel-modal-confirm-btn ${isCancelling ? 'cancelling' : ''}`}
                  onClick={handleCancelSubscription}
                  disabled={isCancelling}
                >
                  {isCancelling ? (
                    <>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        className="cancel-spinner"
                      >
                        <circle
                          cx="8"
                          cy="8"
                          r="7"
                          stroke="#fff"
                          strokeWidth="2"
                          strokeDasharray="43.98"
                          strokeDashoffset="10"
                          strokeLinecap="round"
                        />
                      </svg>
                      Cancelling...
                    </>
                  ) : (
                    'Confirm Cancellation'
                  )}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}