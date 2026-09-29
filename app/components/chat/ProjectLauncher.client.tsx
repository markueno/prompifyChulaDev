/**
 * The user's projects on the landing surface of the app, in place of the row of framework logos
 * that used to sit there — those were decorative, not even clickable, and told a returning user
 * nothing they wanted to know. What someone opening Prompify usually wants is the thing they were
 * working on yesterday.
 *
 * Client-only: the shell route does not load chats, and the sidebar already reaches them this way.
 */
import { useCallback, useEffect, useState } from 'react';
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

export function ProjectLauncher() {
  const [projects, setProjects] = useState<ChatHistoryItem[]>([]);
  const [layout, setLayout] = useState<Layout>('tiles');
  const [loaded, setLoaded] = useState(false);

  const { filteredItems, handleSearchChange } = useSearchFilter({ items: projects, searchFields: ['description'] });

  useEffect(() => {
    setLayout(readLayout());

    let cancelled = false;

    /*
     * Via fetchServerChats rather than calling /api/chats directly: the endpoint returns raw rows
     * in snake_case, and this maps them to ChatHistoryItem. Reading the response unmapped silently
     * yields undefined for every camelCase field, so the "is it openable" filter below rejected
     * everything and the list rendered empty.
     */
    fetchServerChats()
      .then(chats => {
        if (cancelled) {
          return;
        }

        // Same filter the sidebar uses: a chat with no name or url cannot be opened.
        setProjects((chats ?? []).filter(c => c.urlId && c.description));
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const chooseLayout = useCallback((next: Layout) => {
    setLayout(next);

    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // A remembered preference is a convenience; losing it is not worth surfacing.
    }
  }, []);

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
     * The parent already supplies the page padding.
     */
    <div className="w-full">
      <div className="mb-4 flex items-center gap-3">
        <span className="text-lg font-semibold text-white">Your projects</span>
        <input
          type="search"
          onChange={handleSearchChange}
          placeholder="Search projects"
          aria-label="Search your projects"
          className="ml-auto w-48 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-base text-white placeholder:text-white/50 focus:w-64 focus:outline-none focus:ring-1 focus:ring-[#f97316] transition-all"
        />
        <div className="flex shrink-0 overflow-hidden rounded-lg border border-white/20">
          {(['tiles', 'list'] as const).map(option => (
            <button
              key={option}
              type="button"
              onClick={() => chooseLayout(option)}
              aria-label={option === 'tiles' ? 'Tile layout' : 'List layout'}
              aria-pressed={layout === option}
              className={classNames(
                'px-2.5 py-2 text-lg transition-colors',
                option === 'tiles' ? 'i-ph:squares-four' : 'i-ph:list',
                layout === option ? 'bg-white/20 text-white' : 'text-white/70 hover:text-white'
              )}
            />
          ))}
        </div>
      </div>

      {filteredItems.length === 0 ? (
        <p className="text-base text-white/60">No projects match that search.</p>
      ) : (
        <div
          className={classNames(
            'max-h-[22rem] overflow-y-auto pr-1',
            layout === 'tiles'
              ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
              : 'flex flex-col gap-2'
          )}
        >
          {filteredItems.map(project => (
            <a
              key={project.id}
              href={buildProjectChatPath(DEFAULT_PROJECT_ID, project.urlId ?? project.id)}
              title={project.description}
              className={classNames(
                'rounded-xl border border-white/15 bg-white/5 text-white/90 transition-colors hover:border-[#f97316] hover:bg-white/10',
                layout === 'tiles'
                  ? 'flex aspect-square flex-col items-start justify-between p-4'
                  : 'flex items-center gap-3 px-4 py-3'
              )}
            >
              <span
                className={classNames('i-ph:cube shrink-0 text-[#f97316]', layout === 'tiles' ? 'text-3xl' : 'text-xl')}
              />
              <span
                className={classNames(
                  'text-base',
                  // Tiles have height to spare, so a long name wraps instead of being cut short.
                  layout === 'tiles' ? 'line-clamp-3 w-full font-medium leading-snug' : 'truncate'
                )}
              >
                {project.description}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
