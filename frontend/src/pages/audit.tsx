/**
 * Audit Page - Activity Log with Modern Colorful Theme
 * Features:
 * - Tabbed sections for All Activity, Grants, Access Events, and Revokes
 * - Blockchain verification indicators
 * - Search and filtering
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import { useAuth } from '@/contexts/AuthContext';
import { getMyAuditLogs, CategorizedAuditResponse, getAuditLogs } from '@/lib/api';

// Tab types
type TabType = 'activity' | 'grants' | 'access' | 'revokes';

interface AuditEntry {
  id: number;
  event_type?: string;
  actor_id?: number;
  actor_name?: string;
  actor_role?: string;
  target_id?: number;
  target_name?: string;
  target_role?: string;
  filename?: string;
  cid?: string;
  details?: string | Record<string, any>;
  tx_hash?: string;
  block_number?: number;
  timestamp?: string;
  verified_onchain?: boolean;
}

interface GrantEntry {
  id: number;
  grantee_id?: number;
  grantee_name?: string;
  grantee_role?: string;
  file_id?: number;
  filename?: string;
  cid?: string;
  status?: string;
  is_expired?: boolean;
  expires_at?: string;
  tx_hash?: string;
  timestamp?: string;
}

interface AccessEntry {
  id: number;
  actor_id?: number;
  actor_name?: string;
  actor_role?: string;
  filename?: string;
  cid?: string;
  details?: string | Record<string, any>;
  tx_hash?: string;
  block_number?: number;
  timestamp?: string;
  verified_onchain?: boolean;
}

interface RevokeEntry {
  id: number;
  actor_id?: number;
  actor_name?: string;
  target_id?: number;
  target_name?: string;
  target_role?: string;
  filename?: string;
  cid?: string;
  details?: string | Record<string, any>;
  tx_hash?: string;
  timestamp?: string;
  verified_onchain?: boolean;
}

const formatDetails = (details: string | Record<string, any> | undefined): string => {
  if (!details) return '';
  if (typeof details === 'string') {
    try {
      const parsed = JSON.parse(details);
      return formatDetails(parsed);
    } catch {
      return details;
    }
  }
  
  const parts: string[] = [];
  if (details.filename) parts.push(`File: ${details.filename}`);
  if (details.accessor_name) parts.push(`By: ${details.accessor_name}`);
  if (details.status) parts.push(`Status: ${details.status}`);
  if (details.grantee_id) parts.push(`To user #${details.grantee_id}`);
  
  return parts.length > 0 ? parts.join(' • ') : '';
};

const formatTimeAgo = (dateStr: string | undefined) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
};

const getEventIcon = (eventType: string | undefined) => {
  const icons: Record<string, { icon: string; bg: string; text: string }> = {
    access: { icon: '👁️', bg: 'bg-sky-50', text: 'text-sky-600' },
    grant: { icon: '✅', bg: 'bg-emerald-50', text: 'text-emerald-600' },
    upload: { icon: '📤', bg: 'bg-purple-50', text: 'text-purple-600' },
    revoke: { icon: '🚫', bg: 'bg-red-50', text: 'text-red-600' },
    access_granted: { icon: '🔓', bg: 'bg-green-50', text: 'text-green-600' },
  };
  return icons[eventType?.toLowerCase() || ''] || { icon: '📋', bg: 'bg-gray-50', text: 'text-gray-600' };
};

export default function AuditPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();

  const [activeTab, setActiveTab] = useState<TabType>('activity');
  const [allLogs, setAllLogs] = useState<AuditEntry[]>([]);
  const [grants, setGrants] = useState<GrantEntry[]>([]);
  const [accessEvents, setAccessEvents] = useState<AccessEntry[]>([]);
  const [revokes, setRevokes] = useState<RevokeEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Stats
  const [stats, setStats] = useState({
    total: 0,
    grants: 0,
    access: 0,
    revokes: 0,
  });

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (user?.id) loadAuditData();
  }, [user]);

  const loadAuditData = async () => {
    if (!user?.id) return;
    setIsLoading(true);
    
    try {
      // Use the secure endpoint - JWT authenticated, users only see their own data
      const result = await getMyAuditLogs();
      if (result.data) {
        setAllLogs(result.data.all_logs || []);
        setGrants(result.data.grants || []);
        setAccessEvents(result.data.access_events || []);
        setRevokes(result.data.revokes || []);
        setStats({
          total: result.data.total_count || 0,
          grants: result.data.grants_count || 0,
          access: result.data.access_count || 0,
          revokes: result.data.revokes_count || 0,
        });
      } else if (result.error) {
        console.error('Failed to load audit logs:', result.error);
      }
    } catch (error) {
      console.error('Failed to load categorized audit logs, falling back:', error);
      // Fallback to old endpoint
      try {
        const result = await getAuditLogs(user.id);
        if (result.data) {
          setAllLogs(result.data.logs || []);
          setStats({
            total: result.data.count || 0,
            grants: 0,
            access: 0,
            revokes: 0,
          });
        }
      } catch (fallbackError) {
        console.error('Failed to load audit logs:', fallbackError);
      }
    }
    
    setIsLoading(false);
  };

  // Filter entries based on search
  const filterEntries = <T extends { filename?: string; cid?: string; tx_hash?: string }>(entries: T[]): T[] => {
    if (!searchQuery) return entries;
    const query = searchQuery.toLowerCase();
    return entries.filter(entry => 
      entry.filename?.toLowerCase().includes(query) ||
      entry.cid?.toLowerCase().includes(query) ||
      entry.tx_hash?.toLowerCase().includes(query)
    );
  };

  if (authLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="relative">
            <div className="w-16 h-16 border-4 border-indigo-100 rounded-full"></div>
            <div className="absolute top-0 left-0 w-16 h-16 border-4 border-transparent border-t-indigo-500 rounded-full animate-spin"></div>
          </div>
        </div>
      </Layout>
    );
  }

  if (!isAuthenticated) return null;

  const tabs: { value: TabType; label: string; icon: string; count: number }[] = [
    { value: 'activity', label: 'All Activity', icon: '📋', count: stats.total },
    { value: 'grants', label: 'Grants', icon: '✅', count: stats.grants },
    { value: 'access', label: 'Access Events', icon: '👁️', count: stats.access },
    { value: 'revokes', label: 'Revokes', icon: '🚫', count: stats.revokes },
  ];

  const renderBlockchainBadge = (tx_hash?: string, block_number?: number) => {
    if (!tx_hash) return null;
    return (
      <div className="flex items-center gap-2 mt-2">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
          ⛓️ Blockchain Verified
        </span>
        <a 
          href={`https://sepolia.etherscan.io/tx/${tx_hash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-indigo-600 hover:text-indigo-800 truncate max-w-[180px]"
        >
          {tx_hash.slice(0, 10)}...{tx_hash.slice(-8)}
        </a>
        {block_number && (
          <span className="text-xs text-gray-400">Block #{block_number}</span>
        )}
      </div>
    );
  };

  const renderActivityTab = () => {
    const filtered = filterEntries(allLogs);
    if (filtered.length === 0) {
      return renderEmptyState('No activity found', 'Activity will appear here when events occur');
    }
    
    return (
      <div className="divide-y divide-gray-100">
        {filtered.map((entry) => {
          const iconInfo = getEventIcon(entry.event_type);
          return (
            <div key={entry.id} className="flex items-start gap-4 p-4 hover:bg-gray-50 transition-colors">
              <div className={`${iconInfo.bg} w-12 h-12 rounded-xl flex items-center justify-center border border-gray-100 flex-shrink-0`}>
                <span className="text-xl">{iconInfo.icon}</span>
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${iconInfo.bg} ${iconInfo.text} capitalize`}>
                    {entry.event_type || 'Unknown'}
                  </span>
                  {entry.timestamp && (
                    <span className="text-sm text-gray-500">{formatTimeAgo(entry.timestamp)}</span>
                  )}
                </div>
                
                <p className="text-gray-900 font-medium">
                  {entry.actor_name && <span className="text-indigo-600">{entry.actor_name}</span>}
                  {entry.actor_role && <span className="text-gray-500 text-sm"> ({entry.actor_role})</span>}
                  {entry.filename && <span> • {entry.filename}</span>}
                </p>
                
                {formatDetails(entry.details) && (
                  <p className="text-sm text-gray-500 mt-1">{formatDetails(entry.details)}</p>
                )}
                
                {renderBlockchainBadge(entry.tx_hash, entry.block_number)}
              </div>
              
              {entry.timestamp && (
                <div className="text-right text-sm text-gray-500 flex-shrink-0">
                  {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderGrantsTab = () => {
    const filtered = filterEntries(grants);
    if (filtered.length === 0) {
      return renderEmptyState('No grants found', 'Grants you have given will appear here');
    }
    
    return (
      <div className="divide-y divide-gray-100">
        {filtered.map((grant) => (
          <div key={grant.id} className="flex items-start gap-4 p-4 hover:bg-gray-50 transition-colors">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center border border-gray-100 flex-shrink-0 ${
              grant.status === 'revoked' ? 'bg-red-50' : grant.is_expired ? 'bg-amber-50' : 'bg-emerald-50'
            }`}>
              <span className="text-xl">{grant.status === 'revoked' ? '🚫' : grant.is_expired ? '⏰' : '✅'}</span>
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  grant.status === 'revoked' 
                    ? 'bg-red-100 text-red-700' 
                    : grant.is_expired 
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-emerald-100 text-emerald-700'
                }`}>
                  {grant.status === 'revoked' ? 'Revoked' : grant.is_expired ? 'Expired' : 'Active'}
                </span>
                {grant.tx_hash && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                    ⛓️ On-Chain
                  </span>
                )}
                {grant.timestamp && (
                  <span className="text-sm text-gray-500">Granted {formatTimeAgo(grant.timestamp)}</span>
                )}
              </div>
              
              <p className="text-gray-900 font-medium">
                Granted to: <span className="text-indigo-600">{grant.grantee_name || `User #${grant.grantee_id}`}</span>
                {grant.grantee_role && <span className="text-gray-500 text-sm"> ({grant.grantee_role})</span>}
              </p>
              
              {grant.filename && (
                <p className="text-sm text-gray-600 mt-1">📄 {grant.filename}</p>
              )}
              
              {grant.expires_at ? (
                <p className={`text-sm mt-1 ${grant.is_expired ? 'text-red-600' : 'text-amber-600'}`}>
                  {grant.is_expired ? '⏰ Expired on: ' : '⏰ Expires: '}
                  {new Date(grant.expires_at).toLocaleString()}
                </p>
              ) : (
                <p className="text-sm text-gray-500 mt-1">🔓 No expiration set (permanent until revoked)</p>
              )}
              
              {renderBlockchainBadge(grant.tx_hash)}
            </div>
            
            <div className="text-right text-sm text-gray-500 flex-shrink-0">
              {grant.timestamp && new Date(grant.timestamp).toLocaleDateString()}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const getAccessDetails = (details: string | Record<string, any> | undefined) => {
    if (!details) return null;
    try {
      const parsed = typeof details === 'string' ? JSON.parse(details) : details;
      return parsed;
    } catch {
      return null;
    }
  };

  const renderAccessTab = () => {
    const filtered = filterEntries(accessEvents);
    if (filtered.length === 0) {
      return renderEmptyState('No access events', 'When someone accesses your records, it will be recorded here');
    }
    
    return (
      <div className="divide-y divide-gray-100">
        {filtered.map((access) => {
          const details = getAccessDetails(access.details);
          return (
          <div key={access.id} className="flex items-start gap-4 p-4 hover:bg-gray-50 transition-colors">
            <div className="bg-sky-50 w-12 h-12 rounded-xl flex items-center justify-center border border-gray-100 flex-shrink-0">
              <span className="text-xl">{details?.action === 'file_downloaded' ? '📥' : '👁️'}</span>
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-sky-100 text-sky-700">
                  {details?.action === 'file_downloaded' ? 'File Downloaded' : 'Record Accessed'}
                </span>
                {access.verified_onchain && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                    ⛓️ On-Chain
                  </span>
                )}
                {access.timestamp && (
                  <span className="text-sm text-gray-500">{formatTimeAgo(access.timestamp)}</span>
                )}
              </div>
              
              <p className="text-gray-900 font-medium">
                <span className="text-indigo-600">{access.actor_name || details?.accessor_name || `User #${access.actor_id}`}</span>
                {(access.actor_role || details?.accessor_role) && (
                  <span className="text-gray-500 text-sm"> ({access.actor_role || details?.accessor_role})</span>
                )}
                <span> {details?.action === 'file_downloaded' ? 'downloaded' : 'accessed'} your record</span>
              </p>
              
              {(access.filename || details?.filename) && (
                <p className="text-sm text-gray-600 mt-1">📄 {access.filename || details?.filename}</p>
              )}
              
              {details?.grant_expires_at && (
                <p className="text-sm text-amber-600 mt-1">
                  ⏰ Grant expires: {new Date(details.grant_expires_at).toLocaleDateString()}
                </p>
              )}
              
              {renderBlockchainBadge(access.tx_hash, access.block_number)}
            </div>
            
            {access.timestamp && (
              <div className="text-right text-sm text-gray-500 flex-shrink-0">
                {new Date(access.timestamp).toLocaleDateString()}<br/>
                {new Date(access.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
          </div>
          );
        })}
      </div>
    );
  };

  const renderRevokesTab = () => {
    const filtered = filterEntries(revokes);
    if (filtered.length === 0) {
      return renderEmptyState('No revocations', 'Access revocations will appear here');
    }
    
    return (
      <div className="divide-y divide-gray-100">
        {filtered.map((revoke) => (
          <div key={revoke.id} className="flex items-start gap-4 p-4 hover:bg-gray-50 transition-colors">
            <div className="bg-red-50 w-12 h-12 rounded-xl flex items-center justify-center border border-gray-100 flex-shrink-0">
              <span className="text-xl">🚫</span>
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                  Access Revoked
                </span>
                {revoke.verified_onchain && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                    ⛓️ On-Chain
                  </span>
                )}
                {revoke.timestamp && (
                  <span className="text-sm text-gray-500">{formatTimeAgo(revoke.timestamp)}</span>
                )}
              </div>
              
              <p className="text-gray-900 font-medium">
                Revoked access from: <span className="text-red-600">{revoke.target_name || `User #${revoke.target_id}`}</span>
                {revoke.target_role && <span className="text-gray-500 text-sm"> ({revoke.target_role})</span>}
              </p>
              
              {revoke.filename && (
                <p className="text-sm text-gray-600 mt-1">📄 {revoke.filename}</p>
              )}
              
              {renderBlockchainBadge(revoke.tx_hash)}
            </div>
            
            {revoke.timestamp && (
              <div className="text-right text-sm text-gray-500 flex-shrink-0">
                {new Date(revoke.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  const renderEmptyState = (title: string, message: string) => (
    <div className="p-12 text-center">
      <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
        <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-gray-900 mb-1">{title}</h3>
      <p className="text-gray-500">{message}</p>
    </div>
  );

  const renderTabContent = () => {
    switch (activeTab) {
      case 'activity':
        return renderActivityTab();
      case 'grants':
        return renderGrantsTab();
      case 'access':
        return renderAccessTab();
      case 'revokes':
        return renderRevokesTab();
      default:
        return renderActivityTab();
    }
  };

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-500 flex items-center justify-center shadow-lg">
              <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Activity Log</h1>
              <p className="text-gray-500">Track all access and changes to your records • Blockchain verified</p>
            </div>
          </div>
        </div>

        {/* Tabs and Search */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-gray-100 p-4 mb-6">
          <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
            {/* Tabs */}
            <div className="flex items-center gap-2 overflow-x-auto w-full lg:w-auto pb-2 lg:pb-0">
              {tabs.map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => setActiveTab(tab.value)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 whitespace-nowrap transition-all ${
                    activeTab === tab.value
                      ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-md'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <span>{tab.icon}</span>
                  {tab.label}
                  {tab.count > 0 && (
                    <span className={`px-1.5 py-0.5 rounded-full text-xs ${
                      activeTab === tab.value ? 'bg-white/20' : 'bg-gray-200'
                    }`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
            
            {/* Search - Fixed overlap issue */}
            <div className="relative w-full lg:w-72">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                type="text"
                placeholder="Search by file, CID, or tx..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50 text-sm transition-all"
              />
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="relative">
                <div className="w-12 h-12 border-4 border-indigo-100 rounded-full"></div>
                <div className="absolute top-0 left-0 w-12 h-12 border-4 border-transparent border-t-indigo-500 rounded-full animate-spin"></div>
              </div>
            </div>
          ) : (
            renderTabContent()
          )}
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          {[
            { label: 'Total Events', count: stats.total, color: 'indigo', icon: '📋' },
            { label: 'Active Grants', count: grants.filter(g => g.status === 'active' && !g.is_expired).length, color: 'emerald', icon: '✅' },
            { label: 'Access Events', count: stats.access, color: 'sky', icon: '👁️' },
            { label: 'Revocations', count: stats.revokes, color: 'red', icon: '🚫' },
          ].map((stat) => (
            <div key={stat.label} className="bg-white/80 backdrop-blur-sm rounded-xl shadow-sm border border-gray-100 p-4 text-center">
              <div className="text-2xl mb-1">{stat.icon}</div>
              <div className={`text-2xl font-bold text-${stat.color}-600`}>{stat.count}</div>
              <div className="text-sm text-gray-500">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Blockchain Info */}
        <div className="mt-6 p-4 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl border border-indigo-100">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⛓️</span>
            <div>
              <h3 className="font-medium text-gray-900">Blockchain Verified Audit Trail</h3>
              <p className="text-sm text-gray-600">
                Access events marked with &quot;⛓️ On-Chain&quot; are permanently recorded on the Sepolia blockchain, 
                providing an immutable and tamper-proof audit trail.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
