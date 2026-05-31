// Removed framer-motion imports as we no longer use animations

interface SendButtonProps {
  show: boolean;
  isStreaming?: boolean;
  disabled?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void;
  onImagesSelected?: (images: File[]) => void;
}

// Removed customEasingFn as we no longer use animations

export const SendButton = ({ show, isStreaming, disabled, onClick }: SendButtonProps) => {
  if (!show) {
    return null;
  }

  return (
    <button
      className="absolute flex justify-center items-center top-[18px] right-[22px] p-1 bg-accent-500 hover:brightness-94 color-white rounded-md w-[34px] h-[34px] transition-theme disabled:opacity-50 disabled:cursor-not-allowed"
      disabled={disabled}
      onClick={event => {
        event.preventDefault();

        if (!disabled) {
          onClick?.(event);
        }
      }}
    >
      <div className="text-lg">
        {!isStreaming ? <div className="i-ph:arrow-right"></div> : <div className="i-ph:stop-circle-bold"></div>}
      </div>
    </button>
  );
};
