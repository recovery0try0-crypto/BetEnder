import { useEffect, useState } from 'react';

/**
 * useDebounce Hook
 * Delays state updates by a specified duration
 * 
 * Useful for search inputs to avoid excessive API calls
 * Example: User types 5 characters rapidly
 * - Without debounce: 5 API calls
 * - With 300ms debounce: 1 API call
 * 
 * @param value The value to debounce
 * @param delayMs Debounce delay in milliseconds
 * @returns Debounced value
 */
export function useDebounce<T>(value: T, delayMs: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    // Set up timer to update debounced value after delay
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    // Clear timer if value changes before delay completes
    return () => {
      clearTimeout(handler);
    };
  }, [value, delayMs]);

  return debouncedValue;
}
