export const DEFAULT_PROJECT_ID = 'personal';

export function buildProjectChatPath(projectId: string | undefined, chatId: string) {
  const resolvedProjectId = projectId?.trim() || DEFAULT_PROJECT_ID;
  return `/projects/${encodeURIComponent(resolvedProjectId)}/chats/${encodeURIComponent(chatId)}`;
}

export function resolveProjectIdFromPathname(pathname: string) {
  const match = pathname.match(/^\/projects\/([^/]+)\/chats(?:\/|$)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}
