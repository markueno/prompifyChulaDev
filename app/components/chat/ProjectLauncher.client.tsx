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
    /* Breathing room at the sides and below, so nothing sits against the edge of the window. */
    <div className="w-full px-6 pb-16 sm:px-10">
      <div className="mb-4 flex items-center gap-3">
        <span className="text-lg font-semibold text-white">Your projects</span>
        <div className="ml-auto flex shrink-0 overflow-hidden rounded-lg border border-white/20">
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

      {/* Centred and wide: searching is the main thing you do here once there are more than a few. */}
      <div className="mb-5 flex justify-center">
        <input
          type="search"
          onChange={handleSearchChange}
          placeholder="Search projects"
          aria-label="Search your projects"
          className="w-full max-w-2xl rounded-lg border border-white/20 bg-white/10 px-4 py-2.5 text-base text-white backdrop-blur-md placeholder:text-white/50 focus:outline-none focus:ring-1 focus:ring-[#f97316]"
        />
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
          {filteredItems.map(project => {
            const icon = iconFor(project.description ?? project.id);

            return (
              <a
                key={project.id}
                href={buildProjectChatPath(DEFAULT_PROJECT_ID, project.urlId ?? project.id)}
                title={project.description}
                className={classNames(
                  /*
                   * One neutral frosted panel for every tile. The colour used to come from the
                   * name, which made a wall of them look like a paint chart; the icon carries
                   * that job alone now.
                   */
                  'group overflow-hidden rounded-xl border border-white/20 bg-white/10 backdrop-blur-md text-white shadow-md transition-all hover:border-[#f97316] hover:bg-white/20',
                  layout === 'tiles' ? 'flex aspect-square flex-col p-3' : 'flex items-center gap-3 px-4 py-3'
                )}
              >
                {layout === 'tiles' ? (
                  <>
                    <div className="flex flex-1 items-center justify-center">
                      <span className={classNames(icon, 'text-2xl text-white/70')} />
                    </div>
                    <span className="line-clamp-2 text-sm font-medium leading-snug">{project.description}</span>
                  </>
                ) : (
                  <>
                    <span className={classNames(icon, 'shrink-0 text-xl text-white/70')} />
                    <span className="truncate text-base">{project.description}</span>
                  </>
                )}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
