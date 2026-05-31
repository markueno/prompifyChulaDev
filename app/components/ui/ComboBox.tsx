import React, { useState, useRef, useEffect } from 'react';
import { classNames } from '~/utils/classNames';

interface ComboBoxOption {
  value: string;
  label: string;
}

interface ComboBoxProps {
  options: ComboBoxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
  inputClassName?: string;
  dropdownClassName?: string;
  allowCustomInput?: boolean;
  id?: string;
}

export const ComboBox: React.FC<ComboBoxProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Select or type...',
  label,
  className = '',
  inputClassName = '',
  dropdownClassName = '',
  allowCustomInput = true,
  id,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const [filteredOptions, setFilteredOptions] = useState(options);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Update input value when prop value changes
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  // Filter options based on input value
  useEffect(() => {
    if (inputValue.trim() === '') {
      setFilteredOptions(options);
    } else {
      const filtered = options.filter(
        option =>
          option.label.toLowerCase().includes(inputValue.toLowerCase()) ||
          option.value.toLowerCase().includes(inputValue.toLowerCase())
      );
      setFilteredOptions(filtered);
    }
  }, [inputValue, options]);

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    setIsOpen(true);

    // If custom input is allowed, update the value immediately
    if (allowCustomInput) {
      onChange(newValue);
    }
  };

  // Handle option selection
  const handleOptionSelect = (option: ComboBoxOption) => {
    setInputValue(option.label);
    onChange(option.value);
    setIsOpen(false);
    inputRef.current?.blur();
  };

  // Handle input focus
  const handleInputFocus = () => {
    setIsOpen(true);
  };

  // Handle input blur
  const handleInputBlur = (e: React.FocusEvent) => {
    // Don't close if clicking on dropdown
    if (dropdownRef.current?.contains(e.relatedTarget as Node)) {
      return;
    }

    // If custom input is not allowed and no valid option is selected, reset to empty
    if (!allowCustomInput && !options.find(opt => opt.value === inputValue)) {
      setInputValue('');
      onChange('');
    }

    setIsOpen(false);
  };

  // Handle key down events
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
    } else if (e.key === 'Enter' && filteredOptions.length === 1) {
      handleOptionSelect(filteredOptions[0]);
    }
  };

  return (
    <div className={classNames('relative', className)}>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-bolt-elements-textPrimary mb-3">
          {label}
        </label>
      )}

      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={classNames(
            'w-full p-4 rounded-lg border border-bolt-elements-borderColor',
            'bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary',
            'focus:outline-none focus:ring-2 focus:ring-bolt-elements-focus',
            'transition-all duration-200 text-base',
            'hover:border-bolt-elements-focus',
            'pr-10',
            inputClassName
          )}
        />

        {/* Dropdown arrow */}
        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
          <div
            className={classNames(
              'i-ph:caret-down text-bolt-elements-textSecondary transition-transform duration-200',
              isOpen ? 'rotate-180' : ''
            )}
          ></div>
        </div>
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div
          ref={dropdownRef}
          className={classNames(
            'absolute z-50 w-full mt-1 bg-bolt-elements-background-depth-2',
            'border border-bolt-elements-borderColor rounded-lg shadow-lg',
            'max-h-60 overflow-auto',
            dropdownClassName
          )}
        >
          {filteredOptions.length > 0 ? (
            filteredOptions.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleOptionSelect(option)}
                className={classNames(
                  'w-full px-4 py-3 text-left text-bolt-elements-textPrimary',
                  'hover:bg-bolt-elements-background-depth-3',
                  'transition-colors duration-150',
                  'first:rounded-t-lg last:rounded-b-lg'
                )}
              >
                {option.label}
              </button>
            ))
          ) : (
            <div className="px-4 py-3 text-bolt-elements-textSecondary text-sm">
              {allowCustomInput ? 'Type to add custom option' : 'No options found'}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
