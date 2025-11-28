/**
 * CID Display Component
 * Shows IPFS Content Identifier with copy functionality
 */

import { useState } from 'react';

interface CidDisplayProps {
  cid: string;
  label?: string;
  showGatewayLink?: boolean;
}

export default function CidDisplay({ cid, label = 'CID', showGatewayLink = true }: CidDisplayProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(cid);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const gatewayUrl = `https://w3s.link/ipfs/${cid}`;

  return (
    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-500">{label}</span>
        <button
          onClick={handleCopy}
          className="text-xs text-blue-600 hover:text-blue-800 transition-colors"
        >
          {copied ? '✓ Copied!' : 'Copy'}
        </button>
      </div>
      <div className="font-mono text-sm text-gray-800 break-all bg-white p-2 rounded border">
        {cid}
      </div>
      {showGatewayLink && (
        <a
          href={gatewayUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center text-sm text-blue-600 hover:text-blue-800"
        >
          View on IPFS Gateway
          <svg className="ml-1 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      )}
    </div>
  );
}
