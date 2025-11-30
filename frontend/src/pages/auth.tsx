/**
 * Unified Authentication Page
 * 
 * Supports multiple authentication methods:
 * - MetaMask wallet connection + password
 * - Username/Password login
 * - Hospital registration (with master secret)
 * - Patient registration (with invite token)
 * - Public invite token generation (with admin password)
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/contexts/AuthContext';
import { useWallet } from '@/hooks/useWallet';
import { registerV2, loginV2, validateInviteToken, generatePublicInvite } from '@/lib/api';

type AuthMode = 'login' | 'register';
type LoginMethod = 'wallet' | 'password';
type RegisterRole = 'patient' | 'hospital';

interface InviteToken {
  token: string;
  created_at: string;
  expires_at: string | null;
  used: boolean;
  expired: boolean;
}

export default function UnifiedAuthPage() {
  const router = useRouter();
  const { login: setAuth, isAuthenticated } = useAuth();
  const { 
    address: walletAddress, 
    connect, 
    isLoading: isConnecting, 
    error: walletError, 
    switchToSepolia, 
    isMetaMaskInstalled, 
    isCorrectNetwork,
    isConnected
  } = useWallet();
  
  const [mode, setMode] = useState<AuthMode>('login');
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('password');
  const [registerRole, setRegisterRole] = useState<RegisterRole>('patient');
  
  // Form fields
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [email, setEmail] = useState('');
  const [inviteToken, setInviteToken] = useState('');
  const [masterSecret, setMasterSecret] = useState('');
  
  // Invite generation
  const [showInviteGenerator, setShowInviteGenerator] = useState(false);
  const [invitePassword, setInvitePassword] = useState('');
  const [generatedTokens, setGeneratedTokens] = useState<InviteToken[]>([]);
  const [isGeneratingInvite, setIsGeneratingInvite] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  
  // State
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [inviteValid, setInviteValid] = useState<boolean | null>(null);
  
  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      router.push('/dashboard');
    }
  }, [isAuthenticated, router]);

  // Validate invite token when entered
  useEffect(() => {
    const validateToken = async () => {
      if (inviteToken.length > 20) {
        const result = await validateInviteToken(inviteToken);
        if (result.data) {
          setInviteValid(result.data.valid);
        }
      } else {
        setInviteValid(null);
      }
    };
    
    const debounce = setTimeout(validateToken, 500);
    return () => clearTimeout(debounce);
  }, [inviteToken]);

  // Handle MetaMask connect
  const handleConnectWallet = async () => {
    setError(null);
    
    if (!isMetaMaskInstalled) {
      setError('MetaMask is not installed. Please install it from metamask.io');
      return;
    }
    
    const connected = await connect();
    if (!connected) {
      setError(walletError || 'Failed to connect wallet');
      return;
    }
    
    if (!isCorrectNetwork) {
      await switchToSepolia();
    }
  };

  // Password login (username + password)
  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    
    const result = await loginV2({ username, password });
    
    if (result.error) {
      setError(result.error);
    } else if (result.data) {
      setAuth(
        {
          id: result.data.user_id,
          username,
          email: '',
          role: result.data.role as 'patient' | 'hospital',
        },
        result.data.access_token
      );
      router.push('/dashboard');
    }
    
    setIsLoading(false);
  };

  // Wallet + Password login (for users who registered with wallet)
  const handleWalletPasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (!walletAddress) {
      setError('Please connect your wallet first');
      return;
    }
    
    setIsLoading(true);
    
    // Use wallet address as username for wallet users
    const walletUsername = `wallet_${walletAddress.slice(2, 10).toLowerCase()}`;
    const result = await loginV2({ username: walletUsername, password });
    
    if (result.error) {
      setError(result.error);
    } else if (result.data) {
      setAuth(
        {
          id: result.data.user_id,
          username: walletUsername,
          email: '',
          role: result.data.role as 'patient' | 'hospital',
          public_key: walletAddress,
        },
        result.data.access_token
      );
      router.push('/dashboard');
    }
    
    setIsLoading(false);
  };

  // Register new account
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    // Validation
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    
    // Password strength validation
    const passwordErrors: string[] = [];
    if (password.length < 8) {
      passwordErrors.push('at least 8 characters');
    }
    if (!/[A-Z]/.test(password)) {
      passwordErrors.push('one uppercase letter');
    }
    if (!/[a-z]/.test(password)) {
      passwordErrors.push('one lowercase letter');
    }
    if (!/[0-9]/.test(password)) {
      passwordErrors.push('one number');
    }
    if (!/[!@#$%^&*()_+\-=\[\]{}|;':",./<>?]/.test(password)) {
      passwordErrors.push('one special character (!@#$%^&*...)');
    }
    
    if (passwordErrors.length > 0) {
      setError(`Password must contain: ${passwordErrors.join(', ')}`);
      return;
    }
    
    // Invite token is required for both patient and hospital
    if (!inviteToken.trim()) {
      setError('Invite token is required');
      return;
    }
    
    // For wallet users, generate username from wallet address
    let finalUsername = username;
    if (loginMethod === 'wallet' && walletAddress) {
      finalUsername = `wallet_${walletAddress.slice(2, 10).toLowerCase()}`;
    }
    
    if (!finalUsername) {
      setError('Username is required');
      return;
    }
    
    // Hospital requires master secret
    if (registerRole === 'hospital' && !masterSecret.trim()) {
      setError('Hospital registration secret is required');
      return;
    }
    
    setIsLoading(true);
    
    const result = await registerV2(
      {
        role: registerRole,
        username: finalUsername,
        password,
        email: email || undefined,
        invite_token: inviteToken,
      },
      registerRole === 'hospital' ? masterSecret : undefined
    );
    
    if (result.error) {
      setError(result.error);
    } else if (result.data) {
      setAuth(
        {
          id: result.data.user_id,
          username: finalUsername,
          email: email || '',
          role: result.data.role as 'patient' | 'hospital',
          public_key: walletAddress || undefined,
        },
        result.data.access_token
      );
      router.push('/dashboard');
    }
    
    setIsLoading(false);
  };

  // Generate invite token
  const handleGenerateInvite = async () => {
    if (!invitePassword.trim()) {
      setError('Please enter the admin password');
      return;
    }
    
    setIsGeneratingInvite(true);
    setError(null);
    
    const result = await generatePublicInvite(invitePassword, 3600);
    
    if (result.error) {
      if (result.error.includes('403') || result.error.includes('Invalid')) {
        setError('Invalid admin password');
      } else {
        setError(result.error);
      }
    } else if (result.data) {
      setSuccessMessage('Invite token generated successfully!');
      setGeneratedTokens(prev => [{
        token: result.data!.invite_token,
        created_at: new Date().toISOString(),
        expires_at: result.data!.expires_at,
        used: false,
        expired: false,
      }, ...prev]);
      setTimeout(() => setSuccessMessage(null), 3000);
    }
    
    setIsGeneratingInvite(false);
  };

  // Copy token to clipboard
  const handleCopyToken = async (tokenStr: string) => {
    try {
      await navigator.clipboard.writeText(tokenStr);
      setCopiedToken(tokenStr);
      setTimeout(() => setCopiedToken(null), 2000);
    } catch {
      setError('Failed to copy token');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center px-4 py-8">
      <div className="max-w-md w-full">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 p-1 shadow-xl shadow-indigo-500/30">
              <div className="w-full h-full rounded-xl bg-white flex items-center justify-center">
                <span className="text-2xl">🏥</span>
              </div>
            </div>
          </div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 text-transparent bg-clip-text">
            CipherHealth
          </h1>
          <p className="text-gray-600 mt-1">Secure Health Records</p>
        </div>

        {/* Auth Card */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          {/* Mode Toggle */}
          <div className="flex rounded-xl bg-gray-100 p-1 mb-6">
            <button
              onClick={() => { setMode('login'); setShowInviteGenerator(false); }}
              className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all ${
                mode === 'login' && !showInviteGenerator
                  ? 'bg-white text-indigo-600 shadow'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Login
            </button>
            <button
              onClick={() => { setMode('register'); setShowInviteGenerator(false); }}
              className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all ${
                mode === 'register' && !showInviteGenerator
                  ? 'bg-white text-indigo-600 shadow'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Register
            </button>
            <button
              onClick={() => setShowInviteGenerator(true)}
              className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all ${
                showInviteGenerator
                  ? 'bg-white text-indigo-600 shadow'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Get Invite
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Success Message */}
          {successMessage && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">
              {successMessage}
            </div>
          )}

          {showInviteGenerator ? (
            /* ===================== INVITE GENERATOR ===================== */
            <div className="space-y-4">
              <div className="text-center mb-4">
                <h3 className="text-lg font-semibold text-gray-800">Generate Patient Invite</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Enter the admin password to generate invite tokens
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Admin Password
                </label>
                <input
                  type="password"
                  value={invitePassword}
                  onChange={(e) => setInvitePassword(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Enter admin password"
                  autoComplete="off"
                />
              </div>

              <button
                onClick={handleGenerateInvite}
                disabled={isGeneratingInvite || !invitePassword.trim()}
                className="w-full py-3 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-semibold rounded-lg hover:from-emerald-600 hover:to-teal-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGeneratingInvite ? 'Generating...' : '🎟️ Generate Invite Token'}
              </button>

              {/* Generated Tokens List */}
              {generatedTokens.length > 0 && (
                <div className="mt-6">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Generated Tokens</h4>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {generatedTokens.map((t, idx) => (
                      <div
                        key={`${t.token}-${idx}`}
                        className={`p-3 rounded-lg border ${
                          t.used || t.expired
                            ? 'bg-gray-50 border-gray-200'
                            : 'bg-green-50 border-green-200'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <code className="text-xs font-mono text-gray-600 truncate flex-1 mr-2">
                            {t.token.substring(0, 24)}...
                          </code>
                          {!t.used && !t.expired ? (
                            <button
                              onClick={() => handleCopyToken(t.token)}
                              className={`px-3 py-1 text-xs rounded ${
                                copiedToken === t.token
                                  ? 'bg-green-500 text-white'
                                  : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                              }`}
                            >
                              {copiedToken === t.token ? '✓ Copied' : 'Copy'}
                            </button>
                          ) : (
                            <span className="text-xs text-gray-500">
                              {t.used ? 'Used' : 'Expired'}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-xs text-gray-500 text-center mt-4">
                Each token can only be used once. Share it with a patient to allow them to register.
              </p>
            </div>
          ) : mode === 'login' ? (
            /* ===================== LOGIN FORM ===================== */
            <div className="space-y-4">
              {/* Login Method Toggle */}
              <div className="flex gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => setLoginMethod('password')}
                  className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg border-2 transition-all ${
                    loginMethod === 'password'
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  🔑 Username
                </button>
                <button
                  type="button"
                  onClick={() => setLoginMethod('wallet')}
                  className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg border-2 transition-all ${
                    loginMethod === 'wallet'
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  🦊 Wallet
                </button>
              </div>

              {loginMethod === 'password' ? (
                /* Username + Password Login */
                <form onSubmit={handlePasswordLogin} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Username
                    </label>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      placeholder="Enter your username"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Password
                    </label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      placeholder="Enter your password"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-3 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? 'Signing in...' : 'Sign In'}
                  </button>
                </form>
              ) : (
                /* Wallet + Password Login */
                <div className="space-y-4">
                  {!isConnected ? (
                    /* Connect Wallet First */
                    <div className="text-center py-4">
                      <div className="text-4xl mb-3">🦊</div>
                      <p className="text-sm text-gray-600 mb-4">
                        {isMetaMaskInstalled 
                          ? 'Connect your wallet to login'
                          : 'Please install MetaMask to use wallet login'}
                      </p>
                      
                      {!isMetaMaskInstalled && (
                        <a
                          href="https://metamask.io/download/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block mb-4 text-indigo-600 hover:underline text-sm"
                        >
                          Download MetaMask →
                        </a>
                      )}
                      
                      <button
                        type="button"
                        onClick={handleConnectWallet}
                        disabled={isConnecting || !isMetaMaskInstalled}
                        className="w-full py-3 bg-gradient-to-r from-orange-500 to-amber-600 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-amber-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isConnecting ? 'Connecting...' : '🦊 Connect MetaMask'}
                      </button>
                    </div>
                  ) : (
                    /* Wallet Connected - Enter Password */
                    <form onSubmit={handleWalletPasswordLogin} className="space-y-4">
                      <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-center">
                        <p className="text-sm text-green-700">
                          ✓ Wallet Connected: {walletAddress?.slice(0, 6)}...{walletAddress?.slice(-4)}
                        </p>
                        {!isCorrectNetwork && (
                          <button
                            type="button"
                            onClick={switchToSepolia}
                            className="mt-2 text-xs text-amber-600 hover:underline"
                          >
                            ⚠️ Switch to Sepolia Network
                          </button>
                        )}
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Password
                        </label>
                        <input
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                          placeholder="Enter your password"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full py-3 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isLoading ? 'Signing in...' : 'Sign In with Wallet'}
                      </button>
                      
                      <p className="text-xs text-gray-500 text-center">
                        Don't have an account?{' '}
                        <button
                          type="button"
                          onClick={() => setMode('register')}
                          className="text-indigo-600 hover:underline"
                        >
                          Register
                        </button>
                      </p>
                    </form>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* ===================== REGISTER FORM ===================== */
            <form onSubmit={handleRegister} className="space-y-4">
              {/* Role Toggle */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  I am a
                </label>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setRegisterRole('patient')}
                    className={`flex-1 py-3 px-4 rounded-xl border-2 font-medium transition-all flex items-center justify-center gap-2 ${
                      registerRole === 'patient'
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    <span className="text-xl">🧑</span>
                    <span>Patient</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRegisterRole('hospital')}
                    className={`flex-1 py-3 px-4 rounded-xl border-2 font-medium transition-all flex items-center justify-center gap-2 ${
                      registerRole === 'hospital'
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    <span className="text-xl">🏥</span>
                    <span>Hospital</span>
                  </button>
                </div>
              </div>

              {/* Registration Method Toggle */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setLoginMethod('password')}
                  className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg border-2 transition-all ${
                    loginMethod === 'password'
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  🔑 Username
                </button>
                <button
                  type="button"
                  onClick={() => setLoginMethod('wallet')}
                  className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg border-2 transition-all ${
                    loginMethod === 'wallet'
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  🦊 Wallet
                </button>
              </div>

              {loginMethod === 'wallet' && (
                /* Wallet connection for registration */
                <div>
                  {!isConnected ? (
                    <button
                      type="button"
                      onClick={handleConnectWallet}
                      disabled={isConnecting || !isMetaMaskInstalled}
                      className="w-full py-3 bg-gradient-to-r from-orange-500 to-amber-600 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-amber-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isConnecting ? 'Connecting...' : '🦊 Connect MetaMask'}
                    </button>
                  ) : (
                    <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-center">
                      <p className="text-sm text-green-700">
                        ✓ Wallet: {walletAddress?.slice(0, 6)}...{walletAddress?.slice(-4)}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {loginMethod === 'password' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder="Choose a username"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email (optional)
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="your@email.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Password <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Strong password required"
                />
                <div className="mt-1 text-xs text-gray-500">
                  <p>Password must contain:</p>
                  <ul className="list-disc list-inside ml-2 space-y-0.5">
                    <li className={password.length >= 8 ? 'text-green-600' : ''}>At least 8 characters</li>
                    <li className={/[A-Z]/.test(password) ? 'text-green-600' : ''}>One uppercase letter</li>
                    <li className={/[a-z]/.test(password) ? 'text-green-600' : ''}>One lowercase letter</li>
                    <li className={/[0-9]/.test(password) ? 'text-green-600' : ''}>One number</li>
                    <li className={/[!@#$%^&*()_+\-=\[\]{}|;':",./<>?]/.test(password) ? 'text-green-600' : ''}>One special character</li>
                  </ul>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Confirm your password"
                />
              </div>

              {/* Invite Token - Required for BOTH patient and hospital */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Invite Token <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={inviteToken}
                    onChange={(e) => setInviteToken(e.target.value)}
                    required
                    className={`w-full px-4 py-2.5 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 ${
                      inviteValid === true
                        ? 'border-green-300 bg-green-50'
                        : inviteValid === false
                        ? 'border-red-300 bg-red-50'
                        : 'border-gray-300'
                    }`}
                    placeholder="Paste invite token (required)"
                  />
                  {inviteValid !== null && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2">
                      {inviteValid ? '✅' : '❌'}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Get an invite token from the "Get Invite" tab.
                </p>
              </div>

              {/* Hospital-specific: Master Secret */}
              {registerRole === 'hospital' && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <label className="block text-sm font-medium text-amber-800 mb-1">
                    🔐 Hospital Registration Secret
                  </label>
                  <input
                    type="password"
                    value={masterSecret}
                    onChange={(e) => setMasterSecret(e.target.value)}
                    required
                    className="w-full px-4 py-2.5 border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 bg-white"
                    placeholder="Enter the master secret"
                  />
                  <p className="mt-1 text-xs text-amber-700">
                    Contact the system administrator to obtain this secret.
                  </p>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading || (loginMethod === 'wallet' && !isConnected)}
                className="w-full py-3 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Creating account...' : 'Create Account'}
              </button>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="mt-6 text-center text-sm text-gray-500">
          <span className="inline-flex items-center gap-2">
            🔒 End-to-End Encrypted
          </span>
        </div>
      </div>
    </div>
  );
}
