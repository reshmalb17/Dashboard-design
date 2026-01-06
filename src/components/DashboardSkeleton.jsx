import styles from "./DashboardSkeleton.module.css"

export default function DashboardSkeleton() {
  return (
    <div className={styles.dashboardSection}>
      {/* Skeleton Stats */}
      <div className={styles.dashboardStats}>
        <div className={styles.statCardSkeleton + " " + styles.skeletonLarge}>
          <div className={styles.skeletonText + " " + styles.skeletonLabel}></div>
          <div className={styles.skeletonText + " " + styles.skeletonValue}></div>
          <div className={styles.skeletonIcon}></div>
        </div>

        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={styles.statCardSkeleton}>
            <div className={styles.skeletonText + " " + styles.skeletonLabel}></div>
            <div className={styles.skeletonText + " " + styles.skeletonValue}></div>
            <div className={styles.skeletonIcon}></div>
          </div>
        ))}
      </div>

      {/* Skeleton Table Section */}
      <div className={styles.recentDomainsSection}>
        <div className={styles.recentDomainsHeader}>
          <div className={styles.skeletonText + " " + styles.skeletonTitle}></div>
          <div className={styles.skeletonIcon + " " + styles.skeletonSearchIcon}></div>
        </div>

        {/* <div className={styles.recentDomainsTableContainer}>
          <table className={styles.recentDomainsTable}>
            <thead>
              <tr>
                <th>Active</th>
                <th>Status</th>
                <th>Billing Period</th>
                <th>Expiration Date</th>
                <th>License Key</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4, 5].map((i) => (
                <tr key={i}>
                  <td>
                    <div className={styles.skeletonText + " " + styles.skeletonCell}></div>
                  </td>
                  <td>
                    <div className={styles.skeletonText + " " + styles.skeletonCell}></div>
                  </td>
                  <td>
                    <div className={styles.skeletonText + " " + styles.skeletonCell}></div>
                  </td>
                  <td>
                    <div className={styles.skeletonText + " " + styles.skeletonCell}></div>
                  </td>
                  <td>
                    <div className={styles.skeletonText + " " + styles.skeletonCell}></div>
                  </td>
                  <td>
                    <div className={styles.skeletonText + " " + styles.skeletonCell}></div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div> */}
      </div>
    </div>
  )
}
