/*
 * Prompify does not self-update. The bolt.diy original compared the local package.json with the
 * upstream GitHub repo and drove an Update tab backed by /api/update; that route was deleted
 * (it ran git and pnpm inside the production container), and the check itself 404'd on
 * /package.json on every page load. The hook is kept as an inert stub so its callers, which only
 * read these three values, need no changes.
 */
export const useUpdateCheck = () => {
  return { hasUpdate: false, currentVersion: '', acknowledgeUpdate: async () => undefined };
};
