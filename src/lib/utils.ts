import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function normalizeVFAnswer(value: any): string {
  if (!value) return '';
  const valStr = String(value).trim().toUpperCase();
  if (
    valStr === 'A' || 
    valStr === 'VRAI' || 
    valStr === 'TRUE' || 
    valStr === 'V' || 
    valStr === 'CORRECT' || 
    valStr === 'YES' ||
    valStr === 'OUI' ||
    valStr === '1'
  ) {
    return 'A';
  }
  if (
    valStr === 'B' || 
    valStr === 'FAUX' || 
    valStr === 'FALSE' || 
    valStr === 'F' || 
    valStr === 'INCORRECT' || 
    valStr === 'NO' ||
    valStr === 'NON' ||
    valStr === '0'
  ) {
    return 'B';
  }
  return valStr;
}

// Safety check for localStorage to prevent crashes in restricted iframes (like Safari)
export const safeLocalStorage = {
  getItem: (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.warn("localStorage is blocked or unavailable", e);
      return null;
    }
  },
  setItem: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.warn("localStorage is blocked or unavailable", e);
    }
  },
  removeItem: (key: string) => {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.warn("localStorage is blocked or unavailable", e);
    }
  }
};

