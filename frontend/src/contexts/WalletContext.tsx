/**
 * Wallet Context Provider
 * Provides wallet state and functions to all components
 */

import React, { createContext, useContext, ReactNode } from 'react';
import { useWallet } from '@/hooks/useWallet';

interface WalletContextType {
  isMetaMaskInstalled: boolean;
  isConnected: boolean;
  isCorrectNetwork: boolean;
  address: string | null;
  chainId: string | null;
  isLoading: boolean;
  error: string | null;
  connect: () => Promise<boolean>;
  disconnect: () => void;
  switchToSepolia: () => Promise<boolean>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();

  return (
    <WalletContext.Provider value={wallet}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWalletContext() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWalletContext must be used within a WalletProvider');
  }
  return context;
}
