/**
 * Next.js App Component
 * Wraps all pages with providers
 */

import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { WalletProvider } from "@/contexts/WalletContext";
import { AuthProvider } from "@/contexts/AuthContext";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <WalletProvider>
      <AuthProvider>
        <Component {...pageProps} />
      </AuthProvider>
    </WalletProvider>
  );
}
