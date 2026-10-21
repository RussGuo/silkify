export const metadata = { title: 'silkify in Next.js', icons: { icon: 'data:,' } };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui', margin: 0 }}>{children}</body>
    </html>
  );
}
