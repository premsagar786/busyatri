import colors from '@/constants/colors';
import { useTheme } from './ThemeContext';

/**
 * Returns the design tokens for the active color scheme.
 *
 * The scheme comes from ThemeContext (System / Light / Dark override chosen
 * in Settings, persisted per device), falling back to the OS appearance.
 */
export function useColors() {
  const { scheme } = useTheme();
  const palette = scheme === 'dark' ? colors.dark : colors.light;
  return { ...palette, radius: colors.radius };
}
