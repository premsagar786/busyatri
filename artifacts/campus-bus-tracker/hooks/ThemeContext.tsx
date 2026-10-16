import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';

export type ThemeMode = 'system' | 'light' | 'dark';

type Theme = 'light' | 'dark';

interface ThemeContextValue {
  mode: ThemeMode;
  scheme: Theme;
  setMode: (mode: ThemeMode) => void;
}

const STORAGE_KEY = 'bus-tracker-theme-mode';

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setModeState(stored);
        }
      })
      .catch(() => {});
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const scheme: Theme = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;

  return (
    <ThemeContext.Provider value={{ mode, scheme, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const system = useColorScheme();
  const ctx = useContext(ThemeContext);
  if (ctx) return ctx;
  return { mode: 'system', scheme: system === 'dark' ? 'dark' : 'light', setMode: () => {} };
}
