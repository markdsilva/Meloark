// Sharing this lock with local readers prevents stale File snapshots while a
// filename batch is staging or finalizing. It cannot lock out external apps.
export const FILESYSTEM_LOCK = 'meloark:filesystem-mutation'
export const withFilesystemLock = <T>(run: () => Promise<T>): Promise<T> => navigator.locks ? navigator.locks.request(FILESYSTEM_LOCK, run) : run()
