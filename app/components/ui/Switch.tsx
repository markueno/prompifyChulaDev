import { memo } from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { classNames } from '~/utils/classNames';

interface SwitchProps {
  className?: string;
  checked?: boolean;
  onCheckedChange?: (event: boolean) => void;
}

export const Switch = memo(({ className, onCheckedChange, checked }: SwitchProps) => {
  return (
    <SwitchPrimitive.Root
      className={classNames(
        /*
         * The off track must be neutral. It used to be button-primary-background, which in the
         * dark theme resolves to accent.500 (brand orange) — so off and on were two shades of
         * the same orange and nothing read as "off".
         */
        'relative h-6 w-11 cursor-pointer rounded-full',
        'bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor',
        'transition-colors duration-200 ease-in-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:bg-accent-500 data-[state=checked]:border-accent-500',
        className
      )}
      checked={checked}
      onCheckedChange={e => onCheckedChange?.(e)}
    >
      <SwitchPrimitive.Thumb
        className={classNames(
          'block h-5 w-5 rounded-full bg-white',
          'shadow-lg shadow-black/20',
          'transition-transform duration-200 ease-in-out',
          'translate-x-0.5',
          'data-[state=checked]:translate-x-[1.375rem]',
          'will-change-transform'
        )}
      />
    </SwitchPrimitive.Root>
  );
});
