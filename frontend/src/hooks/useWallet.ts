/**
 * MetaMask wallet connection hook
 */

import { useState, useEffect, useCallback } from 'react';
import { SEPOLIA_CHAIN_ID, SEPOLIA_CHAIN_ID_DECIMAL, SEPOLIA_NETWORK_CONFIG } from '@/lib/constants';

declare global {
  interface Window {
    ethereum?: {
      isMetaMask?: boolean;
      request: (args: { method: string; params?: any[] }) => Promise<any>;
      on: (event: string, callback: (...args: any[]) => void) => void;
      removeListener: (event: string, callback: (...args: any[]) => void) => void;
    };
  }
}

interface WalletState {
  isMetaMaskInstalled: boolean;
  isConnected: boolean;
  isCorrectNetwork: boolean;
  address: string | null;
  chainId: string | null;
  isLoading: boolean;
  error: string | null;
}

export function useWallet() {
  const [state, setState] = useState<WalletState>({
    isMetaMaskInstalled: false,
    isConnected: false,
    isCorrectNetwork: false,
    address: null,
    chainId: null,
    isLoading: true,
    error: null,
  });

  // Check if MetaMask is installed
  const checkMetaMask = useCallback(() => {
    const isInstalled = typeof window !== 'undefined' && Boolean(window.ethereum?.isMetaMask);
    setState(prev => ({ ...prev, isMetaMaskInstalled: isInstalled }));
    return isInstalled;
  }, []);

  // Check current chain
  const checkChain = useCallback((chainId: string) => {
    const isCorrect = chainId.toLowerCase() === SEPOLIA_CHAIN_ID.toLowerCase();
    setState(prev => ({ ...prev, chainId, isCorrectNetwork: isCorrect }));
    return isCorrect;
  }, []);

  // Connect wallet
  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setState(prev => ({ ...prev, error: 'MetaMask is not installed' }));
      return false;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts',
      });

      if (accounts.length > 0) {
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        const isCorrect = checkChain(chainId);

        setState(prev => ({
          ...prev,
          isConnected: true,
          address: accounts[0],
          isLoading: false,
        }));

        return true;
      }
    } catch (error: any) {
      setState(prev => ({
        ...prev,
        error: error.message || 'Failed to connect',
        isLoading: false,
      }));
    }

    return false;
  }, [checkChain]);

  // Switch to Sepolia network
  const switchToSepolia = useCallback(async () => {
    if (!window.ethereum) {
      setState(prev => ({ ...prev, error: 'MetaMask is not installed' }));
      return false;
    }

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: SEPOLIA_CHAIN_ID }],
      });
      return true;
    } catch (error: any) {
      // Chain not added, try to add it
      if (error.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [SEPOLIA_NETWORK_CONFIG],
          });
          return true;
        } catch (addError: any) {
          setState(prev => ({
            ...prev,
            error: addError.message || 'Failed to add Sepolia network',
          }));
        }
      } else {
        setState(prev => ({
          ...prev,
          error: error.message || 'Failed to switch network',
        }));
      }
    }
    return false;
  }, []);

  // Disconnect (clear local state)
  const disconnect = useCallback(() => {
    setState(prev => ({
      ...prev,
      isConnected: false,
      address: null,
      chainId: null,
      isCorrectNetwork: false,
    }));
  }, []);

  // Initialize and set up listeners
  useEffect(() => {
    const init = async () => {
      const isInstalled = checkMetaMask();
      
      if (!isInstalled || !window.ethereum) {
        setState(prev => ({ ...prev, isLoading: false }));
        return;
      }

      try {
        // Check if already connected
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });

        if (accounts.length > 0) {
          checkChain(chainId);
          setState(prev => ({
            ...prev,
            isConnected: true,
            address: accounts[0],
            isLoading: false,
          }));
        } else {
          setState(prev => ({ ...prev, isLoading: false }));
        }
      } catch (error) {
        setState(prev => ({ ...prev, isLoading: false }));
      }
    };

    init();

    // Set up event listeners
    if (window.ethereum) {
      const handleAccountsChanged = (accounts: string[]) => {
        if (accounts.length === 0) {
          disconnect();
        } else {
          setState(prev => ({ ...prev, address: accounts[0], isConnected: true }));
        }
      };

      const handleChainChanged = (chainId: string) => {
        checkChain(chainId);
      };

      window.ethereum.on('accountsChanged', handleAccountsChanged);
      window.ethereum.on('chainChanged', handleChainChanged);

      return () => {
        window.ethereum?.removeListener('accountsChanged', handleAccountsChanged);
        window.ethereum?.removeListener('chainChanged', handleChainChanged);
      };
    }
  }, [checkMetaMask, checkChain, disconnect]);

  return {
    ...state,
    connect,
    disconnect,
    switchToSepolia,
  };
}
