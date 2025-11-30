/**
 * Audit Page - Activity Log with Modern Colorful Theme
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import { useAuth } from '@/contexts/AuthContext';
import { getAuditLogs } from '@/lib/api';

interface AuditEntry {
  id: number;
  action: string;
  actor_id: number;
  target_id?: number;
  record_id?: number;
  details?: string;
  tx_hash?: string;
  created_at: string;
}

type FilterType = 'all' | 'access' | 'grant' | 'upload' | 'revoke';

const getActionInfo = (action: string) => {
  const actions: Record<string, { icon: string; bg: string; text: string; label: string }> = {
    access: { icon: '👁️', bg: 'bg-sky-50', text: 'text-sky-600', label: 'Access' },
    grant: { icon: '✅', bg: 'bg-emerald-50', text: 'text-emerald-600', label: 'Grant' },
    upload: { icon: '📤', bg: 'bg-purple-50', text: 'text-purple-600', label: 'Upload' },
    revoke: { icon: '🚫', bg: 'bg-red-50', text: 'text-red-600', label: 'Revoke' },
    request: { icon: '📨', bg: 'bg-amber-50', text: 'text-amber-600', label: 'Request' },
  };
  return actions[action.toLowerCase()] || { icon: '📋', bg: 'bg-gray-50', text: 'text-gray-600', label: action };
};

const formatTimeAgo = (dateStr: string) => {
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

export default function AuditPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/auth');
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (user?.id) loadAuditLog();
  }, [user]);

  const loadAuditLog = async () => {
    if (!user?.id) return;
    setIsLoading(true);
    try {
      const result = await getAuditLogs(user.id);
      if (result.data) setEntries(result.data.logs || []);
    } catch (error) {
      console.error('Failed to load audit log:', error);
    }
    setIsLoading(false);
  };

  const filteredEntries = entries.filter(entry => {
    if (filter !== 'all' && entry.action.toLowerCase() !== filter) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        entry.action.toLowerCase().includes(query) ||
        entry.details?.toLowerCase().includes(query) ||
        entry.tx_hash?.toLowerCase().includes(query)
      );
    }
    return true;
  });

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

  const filters: { value: FilterType; label: string; icon: string }[] = [
    { value: 'all', label: 'All', icon: '📋' },
    { value: 'access', label: 'Access', icon: '👁️' },
    { value: 'grant', label: 'Grants', icon: '✅' },
    { value: 'upload', label: 'Uploads', icon: '📤' },
    { value: 'revoke', label: 'Revokes', icon: '🚫' },
  ];

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-4">
            <div className="icon-box icon-box-sky">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Activity Log</h1>
              <p className="text-gray-500">Track all access and changes to your records</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="glass-card p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="flex items-center gap-2 overflow-x-auto">
              {filters.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setFilter(f.value)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 whitespace-nowrap transition-all ${
                    filter === f.value
                      ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-md'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <span>{f.icon}</span>
                  {f.label}
                </button>
              ))}
            </div>
            
            <div className="relative w-full sm:w-auto">
              <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search activity..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input-dark pl-12 w-full sm:w-64"
              />
            </div>
          </div>
        </div>

        {/* Activity List */}
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="relative">
              <div className="w-12 h-12 border-4 border-indigo-100 rounded-full"></div>
              <div className="absolute top-0 left-0 w-12 h-12 border-4 border-transparent border-t-indigo-500 rounded-full animate-spin"></div>
            </div>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
              <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">No activity found</h3>
            <p className="text-gray-500">
              {searchQuery || filter !== 'all' ? 'Try adjusting your filters' : 'Activity will appear here when actions occur'}
            </p>
          </div>
        ) : (
          <div className="glass-card overflow-hidden">
            <div className="divide-y divide-gray-100">
              {filteredEntries.map((entry) => {
                const actionInfo = getActionInfo(entry.action);
                return (
                  <div key={entry.id} className="flex items-start gap-4 p-4 hover:bg-gray-50 transition-colors">
                    <div className={`${actionInfo.bg} w-12 h-12 rounded-xl flex items-center justify-center border border-gray-100`}>
                      <span className="text-xl">{actionInfo.icon}</span>
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${actionInfo.bg} ${actionInfo.text}`}>
                          {actionInfo.label}
                        </span>
                        <span className="text-sm text-gray-500">{formatTimeAgo(entry.created_at)}</span>
                      </div>
                      
                      <p className="text-gray-900 font-medium">
                        {entry.details || `${actionInfo.label} action performed`}
                      </p>
                      
                      {entry.tx_hash && (
                        <div className="flex items-center gap-2 mt-2">
                          <span className="badge-info text-xs">⛓️ Blockchain Verified</span>
                          <code className="text-xs text-gray-400 truncate max-w-[200px]">
                            {entry.tx_hash}
                          </code>
                        </div>
                      )}
                    </div>
                    
                    <div className="text-right text-sm text-gray-500">
                      {new Date(entry.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          {[
            { label: 'Total Actions', count: entries.length, color: 'indigo' },
            { label: 'Access Events', count: entries.filter(e => e.action.toLowerCase() === 'access').length, color: 'sky' },
            { label: 'Grants Made', count: entries.filter(e => e.action.toLowerCase() === 'grant').length, color: 'emerald' },
            { label: 'Uploads', count: entries.filter(e => e.action.toLowerCase() === 'upload').length, color: 'purple' },
          ].map((stat) => (
            <div key={stat.label} className="glass-card p-4 text-center">
              <div className={`text-2xl font-bold text-${stat.color}-600`}>{stat.count}</div>
              <div className="text-sm text-gray-500">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}
