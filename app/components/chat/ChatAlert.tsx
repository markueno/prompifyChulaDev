import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { ActionAlert } from '~/types/actions';
import { classNames } from '~/utils/classNames';

const AUTO_FIX_STORAGE_KEY = 'prompify-auto-fix-errors';
const AUTO_FIX_CONSECUTIVE_KEY = 'prompify-auto-fix-consecutive-count';
const AUTO_FIX_CONSECUTIVE_LIMIT = 2; // Stop before 3rd: allow 2 consecutive auto-fixes

interface Props {
  alert: ActionAlert;
  clearAlert: () => void;
  postMessage: (message: string) => void;
}

export default function ChatAlert({ alert, clearAlert, postMessage }: Props) {
  const { description, content, source } = alert;

  const [autoFixEnabled, setAutoFixEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(AUTO_FIX_STORAGE_KEY) === 'true';
  });

  const isPreview = source === 'preview';
  const title = isPreview ? 'Preview Error' : 'Terminal Error';
  const message = isPreview
    ? 'We encountered an error while running the preview. Would you like Prompify to analyze and help resolve this issue?'
    : 'We encountered an error while running terminal commands. Would you like Prompify to analyze and help resolve this issue?';

  const formatErrorForPrompt = () =>
    `*Fix this ${isPreview ? 'preview' : 'terminal'} error*\n\`\`\`${isPreview ? 'js' : 'sh'}\n${content}\n\`\`\`\n`;

  // Auto-prompt to LLM when error appears and auto-fix is enabled (stop after 3 consecutive)
  useEffect(() => {
    if (!autoFixEnabled || !content || typeof window === 'undefined') return;

    const count = parseInt(sessionStorage.getItem(AUTO_FIX_CONSECUTIVE_KEY) ?? '0', 10);
    if (count >= AUTO_FIX_CONSECUTIVE_LIMIT) return;

    const timer = setTimeout(() => {
      const currentCount = parseInt(sessionStorage.getItem(AUTO_FIX_CONSECUTIVE_KEY) ?? '0', 10);
      if (currentCount >= AUTO_FIX_CONSECUTIVE_LIMIT) return;

      sessionStorage.setItem(AUTO_FIX_CONSECUTIVE_KEY, String(currentCount + 1));

      postMessage(`*Fix this ${isPreview ? 'preview' : 'terminal'} error*\n\`\`\`${isPreview ? 'js' : 'sh'}\n${content}\n\`\`\`\n`);
    }, 1500);
    return () => clearTimeout(timer);
  }, [autoFixEnabled, content, isPreview, postMessage]);

  const toggleAutoFix = () => {
    const next = !autoFixEnabled;
    setAutoFixEnabled(next);
    localStorage.setItem(AUTO_FIX_STORAGE_KEY, String(next));
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3 }}
        className={`rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4 mb-2`}
      >
        <div className="flex items-start">
          {/* Icon */}
          <motion.div
            className="flex-shrink-0"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2 }}
          >
            <div className={`i-ph:warning-duotone text-xl text-bolt-elements-button-danger-text`}></div>
          </motion.div>
          {/* Content */}
          <div className="ml-3 flex-1">
            <motion.h3
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1 }}
              className={`text-sm font-medium text-bolt-elements-textPrimary`}
            >
              {title}
            </motion.h3>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className={`mt-2 text-sm text-bolt-elements-textSecondary`}
            >
              <p>{message}</p>
              {description && (
                <div className="text-xs text-bolt-elements-textSecondary p-2 bg-bolt-elements-background-depth-3 rounded mt-4 mb-4">
                  Error: {description}
                </div>
              )}
            </motion.div>

            {/* Actions */}
            <motion.div
              className="mt-4"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => postMessage(formatErrorForPrompt())}
                    className={classNames(
                      `px-2 py-1.5 rounded-md text-sm font-medium`,
                      'bg-bolt-elements-button-primary-background',
                      'hover:bg-bolt-elements-button-primary-backgroundHover',
                      'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-bolt-elements-button-danger-background',
                      'text-bolt-elements-button-primary-text',
                      'flex items-center gap-1.5'
                    )}
                  >
                    <div className="i-ph:chat-circle-duotone"></div>
                    Ask Prompify
                  </button>
                  <button
                    onClick={clearAlert}
                    className={classNames(
                      `px-2 py-1.5 rounded-md text-sm font-medium`,
                      'bg-bolt-elements-button-secondary-background',
                      'hover:bg-bolt-elements-button-secondary-backgroundHover',
                      'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-bolt-elements-button-secondary-background',
                      'text-bolt-elements-button-secondary-text'
                    )}
                  >
                    Dismiss
                  </button>
                </div>
                <label className="flex items-center gap-2 text-xs text-bolt-elements-textSecondary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoFixEnabled}
                    onChange={toggleAutoFix}
                    className="rounded border-bolt-elements-borderColor"
                  />
                  Automatically prompt LLM to fix errors when they occur
                </label>
              </div>
            </motion.div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
