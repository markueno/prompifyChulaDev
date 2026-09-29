import { useRouteLoaderData } from '@remix-run/react';

/**
 * Whether the project on screen is being viewed by someone who may only look at it.
 *
 * True for a viewer — whether that comes from their workspace role or from a project they were
 * shared individually — and false everywhere else, including on pages that are not a project.
 *
 * Resolved from the project chat route's loader rather than a store, so it is settled before the
 * first paint and cannot go stale when navigating between projects. `chat.$id` always redirects
 * here, so this one route id covers every way of opening a project.
 *
 * What it is for: stripping the chrome that changes things. A viewer keeps the plain navigation
 * links, their own account menu and the preview itself; they lose renaming, deploying, the
 * workspace switcher and the project sidebar. None of that is access control — every one of those
 * actions is refused by the server independently — it is so a viewer is not handed controls that
 * would fail, on someone else's project, if they pressed them.
 */
export function useProjectViewOnly(): boolean {
  const data = useRouteLoaderData('routes/projects.$projectId.chats.$id') as { previewOnly?: boolean } | undefined;

  return data?.previewOnly === true;
}
