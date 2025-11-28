/**
 * Transaction Hash Display Component
 * Shows Ethereum transaction hash with link to Etherscan
 */

import { useState } from 'react';
import { SEPOLIA_ETHERSCAN_TX } from '@/lib/constants';

interface TxHashDisplayProps {
  txHash: string;
  label?: string;
  status?: 'pending' | 'confirmed' | 'failed';
}

export default function TxHashDisplay({ txHash, label = 'Transaction', status = 'confirmed' }: TxHashDisplayProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(txHash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const etherscanUrl = `${SEPOLIA_ETHERSCAN_TX}/${txHash}`;

  const statusColors = {
    pending: 'bg-yellow-100 text-yellow-800',
    confirmed: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
  };

  const statusLabels = {
    pending: 'Pending',
    confirmed: 'Confirmed',
    failed: 'Failed',
  };

  return (
    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-2">
          <span className="text-sm font-medium text-gray-500">{label}</span>
          <span className={`px-2 py-0.5 text-xs rounded-full ${statusColors[status]}`}>
            {statusLabels[status]}
          </span>
        </div>
        <button
          onClick={handleCopy}
          className="text-xs text-blue-600 hover:text-blue-800 transition-colors"
        >
          {copied ? '✓ Copied!' : 'Copy'}
        </button>
      </div>
      <div className="font-mono text-sm text-gray-800 break-all bg-white p-2 rounded border">
        {txHash}
      </div>
      <a
        href={etherscanUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex items-center text-sm text-blue-600 hover:text-blue-800"
      >
        View on Sepolia Etherscan
        <svg className="ml-1 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      </a>
    </div>
  );
}
