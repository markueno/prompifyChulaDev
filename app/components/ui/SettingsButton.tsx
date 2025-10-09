import { memo } from 'react';
import { IconButton } from '~/components/ui/IconButton';
interface SettingsButtonProps {
  onClick: () => void;
}

export const SettingsButton = memo(({ onClick }: SettingsButtonProps) => {
  // Check if settings button should be shown via environment variable
  const showSettingsButton = process.env.SHOW_SETTINGS_BUTTON !== 'false';
  
  // Don't render if disabled via environment variable
  if (!showSettingsButton) {
    return null;
  }

  return (
    <IconButton
      onClick={onClick}
      icon="i-ph:gear"
      size="xl"
      title="Settings"
      className="text-[#666] hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive/10 transition-colors"
    />
  );
});
