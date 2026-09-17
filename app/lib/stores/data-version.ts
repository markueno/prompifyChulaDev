import { atom } from 'nanostores';

/*
 * Client-side signal that the app's data tables changed (the AI's
 * <boltAction type="data"> created/seeded tables). The workbench's Data panel
 * subscribes and re-lists tables when this bumps, so an open Data tab shows
 * AI-seeded sample data without requiring a manual refresh — the panel lists
 * once on mount/chatId-change, and since the data action registers tables under
 * the SAME chatId, that dep alone never re-triggers the list.
 */
export const dataProxyVersion = atom(0);

export function bumpDataProxyVersion(): void {
  dataProxyVersion.set((dataProxyVersion.get() ?? 0) + 1);
}
