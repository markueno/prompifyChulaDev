import { motion } from 'framer-motion';
import * as Tooltip from '@radix-ui/react-tooltip';
import { classNames } from '~/utils/classNames';
import type { TabVisibilityConfig } from '~/components/@settings/core/types';
import { TAB_LABELS, TAB_ICONS } from '~/components/@settings/core/constants';

interface TabTileProps {
  tab: TabVisibilityConfig;
  onClick?: () => void;
  isActive?: boolean;
  hasUpdate?: boolean;
  statusMessage?: string;
  description?: string;
  isLoading?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export const TabTile: React.FC<TabTileProps> = ({
  tab,
  onClick,
  isActive,
  hasUpdate,
  statusMessage,
  description,
  isLoading,
  className,
  children,
}: TabTileProps) => {
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <motion.div
            onClick={onClick}
            className={classNames(
              'relative flex flex-col items-center p-6 rounded-xl',
              'w-full h-full min-h-[160px]',
              'bg-white dark:bg-[#141414]',
              'border border-[#E5E5E5] dark:border-[#333333]',
              'group',
              'hover:bg-[#f0e4d5] dark:hover:bg-[#1a1a1a]',
              'hover:border-[#fed7aa] dark:hover:border-[#231710]/30',
              isActive ? 'border-[#f97316] dark:border-[#f97316]/50 bg-[#f97316]/5 dark:bg-[#f97316]/10' : '',
              isLoading ? 'cursor-wait opacity-70' : '',
              className || ''
            )}
          >
            {/* Main Content */}
            <div className="flex flex-col items-center justify-center flex-1 w-full">
              {/* Icon */}
              <motion.div
                className={classNames(
                  'relative',
                  'w-14 h-14',
                  'flex items-center justify-center',
                  'rounded-xl',
                  'bg-gray-100 dark:bg-gray-800',
                  'ring-1 ring-gray-200 dark:ring-gray-700',
                  'group-hover:bg-[#fed7aa] dark:group-hover:bg-gray-700/80',
                  'group-hover:ring-[#fed7aa] dark:group-hover:ring-[#231710]/30',
                  isActive ? 'bg-[#f97316]/10 dark:bg-[#f97316]/10 ring-[#f97316]/30 dark:ring-[#f97316]/20' : ''
                )}
              >
                <motion.div
                  className={classNames(
                    TAB_ICONS[tab.id],
                    'w-8 h-8',
                    'text-gray-600 dark:text-gray-300',
                    'group-hover:text-[#f97316] dark:group-hover:text-[#f97316]/80/80',
                    isActive ? 'text-[#f97316] dark:text-[#f97316]/80/90' : ''
                  )}
                />
              </motion.div>

              {/* Label and Description */}
              <div className="flex flex-col items-center mt-5 w-full">
                <h3
                  className={classNames(
                    'text-[15px] font-medium leading-snug mb-2',
                    'text-gray-700 dark:text-gray-200',
                    'group-hover:text-[#c2410c] dark:group-hover:text-[#fed7aa]/90',
                    isActive ? 'text-[#f97316] dark:text-[#f97316]/80/90' : ''
                  )}
                >
                  {TAB_LABELS[tab.id]}
                </h3>
                {description && (
                  <p
                    className={classNames(
                      'text-[13px] leading-relaxed',
                      'text-gray-500 dark:text-gray-400',
                      'max-w-[85%]',
                      'text-center',
                      'group-hover:text-[#f97316] dark:group-hover:text-[#f97316]/80/70',
                      isActive ? 'text-[#f97316]/80 dark:text-[#f97316]/80/80' : ''
                    )}
                  >
                    {description}
                  </p>
                )}
              </div>
            </div>

            {/* Update Indicator with Tooltip */}
            {hasUpdate && (
              <>
                <div className="absolute top-4 right-4 w-2 h-2 rounded-full bg-[#f97316] dark:bg-[#f97316] animate-pulse" />
                <Tooltip.Portal>
                  <Tooltip.Content
                    className={classNames(
                      'px-3 py-1.5 rounded-lg',
                      'bg-[#18181B] text-white',
                      'text-sm font-medium',
                      'select-none',
                      'z-[100]'
                    )}
                    side="top"
                    sideOffset={5}
                  >
                    {statusMessage}
                    <Tooltip.Arrow className="fill-[#18181B]" />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </>
            )}

            {/* Children (e.g. Beta Label) */}
            {children}
          </motion.div>
        </Tooltip.Trigger>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
};
