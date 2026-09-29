/**
 * The user's projects on the landing surface of the app, in place of the row of framework logos
 * that used to sit there — those were decorative, not even clickable, and told a returning user
 * nothing they wanted to know. What someone opening Prompify usually wants is the thing they were
 * working on yesterday.
 *
 * Client-only: the shell route does not load chats, and the sidebar already reaches them this way.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLoaderData } from '@remix-run/react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { toast } from 'react-toastify';
import { classNames } from '~/utils/classNames';
import { useSearchFilter } from '~/lib/hooks/useSearchFilter';
import { buildProjectChatPath, DEFAULT_PROJECT_ID } from '~/utils/chatRoutes';
import type { ChatHistoryItem } from '~/lib/persistence';
import { fetchServerChats } from '~/lib/persistence/chatSync';

const LAYOUT_KEY = 'prompify.projectLayout';

type Layout = 'tiles' | 'list';

/** Reading localStorage throws in some privacy modes; a failed read just means the default. */
function readLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'tiles';
  } catch {
    return 'tiles';
  }
}

/*
 * A project's icon is derived from its name rather than stored.
 *
 * Only the shape varies, not the colour: eight tinted gradients turned the page into a paint
 * chart and competed with the background. Every tile is the same neutral frosted panel, and the
 * glyph alone is what makes one recognisable before its name is read.
 *
 * Hashed so it is stable — an icon that changed on reload would read as a glitch — and derived
 * rather than fetched, so no assets ship and no image can fail to load.
 */
const ICONS = [
  'i-ph:rocket-launch',
  'i-ph:compass',
  'i-ph:leaf',
  'i-ph:sparkle',
  'i-ph:lightning',
  'i-ph:waves',
  'i-ph:planet',
  'i-ph:tree-structure',
];

function iconFor(name: string) {
  let hash = 0;

  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }

  return ICONS[Math.abs(hash) % ICONS.length];
}

/** Every project action posts to /api/chats, which is the source of truth for the listing. */
async function postChatAction(action: string, fields: Record<string, string>) {
  const body = new FormData();
  body.set('action', action);

  for (const [key, value] of Object.entries(fields)) {
    body.set(key, value);
  }

  const res = await fetch('/api/chats', { method: 'POST', body });
  const data = (await res.json().catch(() => ({}))) as { error?: string; urlId?: string };

  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

export function ProjectLauncher() {
  const loaderData = useLoaderData<{ user?: { id?: string }; ownsWorkspace?: boolean }>();
  const currentUserId = loaderData?.user?.id;

  /*
   * The workspace owner outranks every project owner in it, so they administer any project here,
   * not only the ones they made. That rule is what stands in for ownership transfer, which does
   * not exist: nothing can be handed over, so someone has to be able to deal with work left
   * behind by a member who has gone.
   */
  const ownsWorkspace = loaderData?.ownsWorkspace === true;

  const [projects, setProjects] = useState<ChatHistoryItem[]>([]);
  const [layout, setLayout] = useState<Layout>('tiles');
  const [loaded, setLoaded] = useState(false);

  /** The project whose name is being edited inline, and the text as typed so far. */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  /** The project the delete confirmation is asking about. Deleting is the one unrecoverable one. */
  const [pendingDelete, setPendingDelete] = useState<ChatHistoryItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { filteredItems, handleSearchChange } = useSearchFilter({ items: projects, searchFields: ['description'] });

  const load = useCallback(async () => {
    const chats = await fetchServerChats();

    // Same filter the sidebar uses: a chat with no name or url cannot be opened.
    setProjects((chats ?? []).filter(c => c.urlId && c.description));
  }, []);

  useEffect(() => {
    setLayout(readLayout());

    let cancelled = false;

    /*
     * Via fetchServerChats rather than calling /api/chats directly: the endpoint returns raw rows
     * in snake_case, and this maps them to ChatHistoryItem. Reading the response unmapped silently
     * yields undefined for every camelCase field, so the "is it openable" filter above rejected
     * everything and the list rendered empty.
     */
    load()
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [load]);

  const chooseLayout = useCallback((next: Layout) => {
    setLayout(next);

    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // A remembered preference is a convenience; losing it is not worth surfacing.
    }
  }, []);

  const startRename = useCallback((project: ChatHistoryItem) => {
    setRenamingId(project.id);
    setRenameDraft(project.description ?? '');
  }, []);

  const commitRename = useCallback(async () => {
    const id = renamingId;
    const description = renameDraft.trim();

    setRenamingId(null);

    const project = projects.find(p => p.id === id);

    if (!id || !description || description === project?.description) {
      return;
    }

    /*
     * Optimistic: the tile shows the new name immediately and is put back if the server refuses.
     * Renaming is the one action here with no visible side effect to wait for, so a round trip
     * before the text changes reads as lag.
     */
    setProjects(prev => prev.map(p => (p.id === id ? { ...p, description } : p)));

    try {
      await postChatAction('rename', { chatId: id, description });
    } catch (error) {
      setProjects(prev => prev.map(p => (p.id === id ? { ...p, description: project?.description } : p)));
      toast.error(error instanceof Error ? error.message : 'Failed to rename project');
    }
  }, [renamingId, renameDraft, projects]);

  const duplicate = useCallback(
    async (project: ChatHistoryItem) => {
      setBusyId(project.id);

      try {
        await postChatAction('duplicate', { chatId: project.id });
        await load();
        toast.success('Project duplicated');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to duplicate project');
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  /*
   * Download the whole conversation as JSON, matching the sidebar's export format. The listing
   * query omits `messages` to stay fast, so the content has to be fetched before it can be saved.
   */
  const download = useCallback(async (project: ChatHistoryItem) => {
    setBusyId(project.id);

    try {
      const res = await fetch(`/api/chat/${project.id}`);

      if (!res.ok) {
        throw new Error('Could not load this project');
      }

      const { chat } = (await res.json()) as { chat?: { messages?: unknown; description?: string } };
      const payload = {
        messages: chat?.messages ?? [],
        description: chat?.description ?? project.description,
        exportDate: new Date().toISOString(),
      };

      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;

      // A filename made from the project's own name, so a folder of these stays readable.
      a.download = `${(project.description ?? 'project').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to download project');
    } finally {
      setBusyId(null);
    }
  }, []);

  const confirmDelete = useCallback(async () => {
    const project = pendingDelete;

    setPendingDelete(null);

    if (!project) {
      return;
    }

    setBusyId(project.id);

    try {
      await postChatAction('delete', { chatId: project.id });
      setProjects(prev => prev.filter(p => p.id !== project.id));
      toast.success('Project deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete project');
    } finally {
      setBusyId(null);
    }
  }, [pendingDelete]);

  /*
   * Render nothing until loaded, and nothing at all for someone with no projects. A brand-new
   * account should see the prompt box on an uncluttered page, not an empty shelf.
   */
  if (!loaded || projects.length === 0) {
    return null;
  }

  return (
    /*
     * Full width rather than the chat column's max-w-chat: this is a gallery of everything you
     * have built, and the reading width that suits a prompt box makes it a cramped two columns.
     * Breathing room at the sides and below, so nothing sits against the edge of the window.
     */
    <div className="w-full px-6 pb-16 sm:px-10">
      <div className="mb-4 text-lg font-semibold text-white">Your projects</div>

      {/*
       * Search and the layout toggle share one row so their heights line up — the toggle used to
       * sit above at icon size and was easy to miss entirely. The empty first column is what keeps
       * the search box centred on the page rather than centred in the space left over beside the
       * toggle; it collapses below sm, where there is no room to spare.
       */}
      <div className="mb-5 flex items-center gap-3">
        <div className="hidden flex-1 sm:block" />
        <input
          type="search"
          onChange={handleSearchChange}
          placeholder="Search projects"
          aria-label="Search your projects"
          className="h-12 w-full max-w-2xl rounded-lg border border-white/20 bg-white/10 px-4 text-base text-white backdrop-blur-md placeholder:text-white/50 focus:outline-none focus:ring-1 focus:ring-[#f97316]"
        />
        <div className="flex flex-1 justify-end">
          <div className="flex h-12 shrink-0 overflow-hidden rounded-lg border border-white/20 bg-white/10 backdrop-blur-md">
            {(['tiles', 'list'] as const).map(option => (
              <button
                key={option}
                type="button"
                onClick={() => chooseLayout(option)}
                aria-label={option === 'tiles' ? 'Tile layout' : 'List layout'}
                aria-pressed={layout === option}
                className={classNames(
                  // Full height of the row, but only as wide as the glyph needs.
                  'flex w-11 items-center justify-center text-xl transition-colors',
                  layout === option ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white'
                )}
              >
                <span className={option === 'tiles' ? 'i-ph:squares-four' : 'i-ph:list'} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {filteredItems.length === 0 ? (
        <p className="text-center text-base text-white/60">No projects match that search.</p>
      ) : (
        /*
         * No inner scroll: the grid grows and the PAGE scrolls, so you can scroll past the prompt
         * box and browse. A scroll area nested inside a scrolling page traps the wheel and makes
         * the list feel like a separate little window.
         */
        <div
          className={classNames(
            layout === 'tiles'
              ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
              : 'flex flex-col gap-2'
          )}
        >
          {filteredItems.map(project => (
            <ProjectCard
              key={project.id}
              project={project}
              layout={layout}
              busy={busyId === project.id}
              /*
               * A workspace listing is shared, so offering a colleague controls that can only
               * fail would be worse than not offering them. Mirrors the server's own rule.
               */
              owned={ownsWorkspace || !currentUserId || project.ownerId === currentUserId}
              renaming={renamingId === project.id}
              renameDraft={renameDraft}
              onRenameDraftChange={setRenameDraft}
              onRenameCommit={commitRename}
              onRenameCancel={() => setRenamingId(null)}
              onRenameStart={() => startRename(project)}
              onDuplicate={() => duplicate(project)}
              onDownload={() => download(project)}
              onDelete={() => setPendingDelete(project)}
            />
          ))}
        </div>
      )}

      {pendingDelete && (
        <DeleteConfirmation
          name={pendingDelete.description ?? 'this project'}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}

interface ProjectCardProps {
  project: ChatHistoryItem;
  layout: Layout;
  busy: boolean;
  owned: boolean;
  renaming: boolean;
  renameDraft: string;
  onRenameDraftChange: (value: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onRenameStart: () => void;
  onDuplicate: () => void;
  onDownload: () => void;
  onDelete: () => void;
}

function ProjectCard({
  project,
  layout,
  busy,
  owned,
  renaming,
  renameDraft,
  onRenameDraftChange,
  onRenameCommit,
  onRenameCancel,
  onRenameStart,
  onDuplicate,
  onDownload,
  onDelete,
}: ProjectCardProps) {
  const icon = useMemo(() => iconFor(project.description ?? project.id), [project.description, project.id]);
  const href = buildProjectChatPath(DEFAULT_PROJECT_ID, project.urlId ?? project.id);
  const isTiles = layout === 'tiles';

  return (
    <div
      className={classNames(
        /*
         * One neutral frosted panel for every tile. The colour used to come from the name, which
         * made a wall of them look like a paint chart; the icon carries that job alone now.
         */
        'group relative overflow-hidden rounded-xl border border-white/20 bg-white/10 text-white shadow-md backdrop-blur-md transition-all hover:border-[#f97316] hover:bg-white/20',
        isTiles ? 'aspect-square' : '',
        busy ? 'opacity-60' : ''
      )}
    >
      {/*
       * The link fills the card and the menu sits above it, rather than the menu living inside an
       * anchor — a button nested in a link still navigates on click in some browsers, which would
       * open the project the moment you reached for its menu.
       */}
      <a
        href={href}
        title={project.description}
        className={classNames('flex h-full w-full', isTiles ? 'flex-col p-3' : 'items-center gap-3 px-4 py-3')}
        onClick={event => {
          if (renaming) {
            event.preventDefault();
          }
        }}
      >
        {isTiles ? (
          <>
            <div className="flex flex-1 items-center justify-center">
              <span className={classNames(icon, 'text-2xl text-white/70')} />
            </div>
            {!renaming && (
              // Room at the right for the menu button, so a long name does not run under it.
              <span className="line-clamp-2 pr-7 text-sm font-medium leading-snug">{project.description}</span>
            )}
          </>
        ) : (
          <>
            <span className={classNames(icon, 'shrink-0 text-xl text-white/70')} />
            {!renaming && <span className="truncate pr-7 text-base">{project.description}</span>}
          </>
        )}
      </a>

      {renaming && (
        <form
          className={classNames('absolute inset-x-3 z-20', isTiles ? 'bottom-3' : 'inset-y-2 flex items-center')}
          onSubmit={event => {
            event.preventDefault();
            onRenameCommit();
          }}
        >
          <input
            autoFocus
            value={renameDraft}
            maxLength={100}
            aria-label="Project name"
            onChange={event => onRenameDraftChange(event.target.value)}
            onBlur={onRenameCommit}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                onRenameCancel();
              }
            }}
            className="w-full rounded-md border border-[#f97316] bg-black/60 px-2 py-1 text-sm text-white focus:outline-none"
          />
        </form>
      )}

      {/*
       * Always visible rather than revealed on hover: there is no hover on a touch screen, and a
       * menu you cannot reach on a phone may as well not exist.
       */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label={`Actions for ${project.description ?? 'project'}`}
            className="absolute bottom-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-md text-white/50 transition-colors hover:bg-white/20 hover:text-white focus:outline-none focus:ring-1 focus:ring-[#f97316]"
          >
            <span className="i-ph:dots-three-bold text-lg" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className="z-[100] min-w-[11rem] rounded-lg border border-[#fed7aa]/60 bg-[#f0e4d5] p-1 shadow-lg dark:border-white/10 dark:bg-[#231710]"
          >
            {owned && <MenuItem icon="i-ph:pencil-simple" label="Rename" onSelect={onRenameStart} />}
            {owned && <MenuItem icon="i-ph:copy" label="Duplicate" onSelect={onDuplicate} />}
            <MenuItem icon="i-ph:download-simple" label="Download" onSelect={onDownload} />
            {owned && (
              <>
                <DropdownMenu.Separator className="my-1 h-px bg-[#231710]/10 dark:bg-white/10" />
                <MenuItem icon="i-ph:trash" label="Delete" destructive onSelect={onDelete} />
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

function MenuItem({
  icon,
  label,
  destructive,
  onSelect,
}: {
  icon: string;
  label: string;
  destructive?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={classNames(
        'flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none transition-colors',
        destructive
          ? 'text-red-600 focus:bg-red-500/10 dark:text-red-400'
          : 'text-[#231710] focus:bg-[#fed7aa]/60 dark:text-white dark:focus:bg-white/10'
      )}
    >
      <span className={classNames(icon, 'text-base')} />
      {label}
    </DropdownMenu.Item>
  );
}

/**
 * Deleting a project cannot be undone — there is no archive for chats the way there now is for
 * workspaces — so it is the only action here that asks first.
 */
function DeleteConfirmation({
  name,
  onCancel,
  onConfirm,
}: {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Delete project"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl border border-[#fed7aa]/60 bg-[#f0e4d5] p-6 shadow-xl dark:border-white/10 dark:bg-[#231710]"
        onClick={event => event.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-[#231710] dark:text-white">Delete project?</h2>
        <p className="mt-2 text-sm text-[#231710]/70 dark:text-white/70">
          <span className="font-medium">{name}</span> and its whole conversation will be removed. This cannot be undone.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-[#231710]/20 px-4 py-2 text-sm text-[#231710] transition-colors hover:bg-[#231710]/5 dark:border-white/20 dark:text-white dark:hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
