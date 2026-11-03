import type { Metadata } from 'next';
import '@fontsource-variable/inter';
import './globals.css';
import { colors } from '@sro/design-tokens';
import type { CSSProperties } from 'react';
export const metadata: Metadata = {
  title: 'SRO Clinic | Connected care',
  description:
    'Social Responsibility Organization clinic management. Secure, connected patient care.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const tokens = {
    '--brand': colors.brand,
    '--brand-dark': colors.brandDark,
    '--green': colors.care,
    '--muted': colors.muted,
    '--ink': colors.text,
    '--border': colors.border,
  } as CSSProperties;
  return (
    <html lang="en">
      <body style={tokens}>{children}</body>
    </html>
  );
}
