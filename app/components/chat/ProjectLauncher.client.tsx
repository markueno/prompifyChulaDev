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

    fetch('/api/chats')
      .then(r => (r.ok ? (r.json() as Promise<{ chats?: ChatHistoryItem[] }>) : { chats: [] }))
      .then(d => {
        if (cancelled) {
          return;
        }

        // Same filter the sidebar uses: a chat with no name or url is not openable.
        setProjects((d.chats ?? []).filter(c => c.urlId && c.description));
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
    <div className="w-full max-w-chat mx-auto">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm text-white/90">Your projects</span>
        <input
          type="search"
          onChange={handleSearchChange}
          placeholder="Search"
          aria-label="Search your projects"
          className="ml-auto w-40 rounded-md border border-white/20 bg-white/10 px-2 py-1 text-sm text-white placeholder:text-white/50 focus:w-56 focus:outline-none focus:ring-1 focus:ring-[#f97316] transition-all"
        />
        <div className="flex shrink-0 overflow-hidden rounded-md border border-white/20">
          {(['tiles', 'list'] as const).map(option => (
            <button
              key={option}
              type="button"
              onClick={() => chooseLayout(option)}
              aria-label={option === 'tiles' ? 'Tile layout' : 'List layout'}
              aria-pressed={layout === option}
              className={classNames(
                'px-2 py-1 text-sm transition-colors',
                option === 'tiles' ? 'i-ph:squares-four' : 'i-ph:list',
                layout === option ? 'bg-white/20 text-white' : 'text-white/70 hover:text-white'
              )}
            />
          ))}
        </div>
      </div>

      {filteredItems.length === 0 ? (
        <p className="text-sm text-white/60">No projects match that search.</p>
      ) : (
        <div
          className={classNames(
            'max-h-64 overflow-y-auto',
            layout === 'tiles' ? 'grid grid-cols-2 gap-2 sm:grid-cols-3' : 'flex flex-col gap-1'
          )}
        >
          {filteredItems.map(project => (
            <a
              key={project.id}
              href={buildProjectChatPath(DEFAULT_PROJECT_ID, project.urlId ?? project.id)}
              title={project.description}
              className={classNames(
                'flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 text-white/90 transition-colors hover:border-[#f97316] hover:bg-white/10',
                layout === 'tiles' ? 'py-3' : 'py-2'
              )}
            >
              <span className="i-ph:cube shrink-0 text-base text-[#f97316]" />
              <span className="truncate text-sm">{project.description}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
