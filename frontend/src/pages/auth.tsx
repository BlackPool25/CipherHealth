/**
 * Unified Authentication Page - Neo-Brutalist Design
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
import { registerV2, loginV2, validateInviteToken, generatePublicInvite, getCurrentUser } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Wallet,
  KeyRound,
  User,
  Building2,
  Copy,
  Check,
  AlertCircle,
  CheckCircle,
  Ticket,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Zap
} from 'lucide-react';

type AuthMode = 'login' | 'register' | 'invite';
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
  const [showPassword, setShowPassword] = useState(false);

  // Form fields
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [email, setEmail] = useState('');
  const [inviteToken, setInviteToken] = useState('');
  const [masterSecret, setMasterSecret] = useState('');

  // Invite generation
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
      localStorage.setItem('jwt_token', result.data.access_token);
      const userResult = await getCurrentUser();

      setAuth(
        {
          id: result.data.user_id,
          uuid: userResult.data?.uuid,
          username,
          email: userResult.data?.email || '',
          role: result.data.role as 'patient' | 'hospital',
        },
        result.data.access_token
      );
      router.push('/dashboard');
    }

    setIsLoading(false);
  };

  // Wallet + Password login
  const handleWalletPasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!walletAddress) {
      setError('Please connect your wallet first');
      return;
    }

    setIsLoading(true);

    const walletUsername = `wallet_${walletAddress.slice(2, 10).toLowerCase()}`;
    const result = await loginV2({ username: walletUsername, password });

    if (result.error) {
      setError(result.error);
    } else if (result.data) {
      localStorage.setItem('jwt_token', result.data.access_token);
      const userResult = await getCurrentUser();

      setAuth(
        {
          id: result.data.user_id,
          uuid: userResult.data?.uuid,
          username: walletUsername,
          email: userResult.data?.email || '',
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

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    // Password strength validation
    const passwordErrors: string[] = [];
    if (password.length < 8) passwordErrors.push('8+ characters');
    if (!/[A-Z]/.test(password)) passwordErrors.push('uppercase');
    if (!/[a-z]/.test(password)) passwordErrors.push('lowercase');
    if (!/[0-9]/.test(password)) passwordErrors.push('number');
    if (!/[!@#$%^&*()_+\-=\[\]{}|;':",.\/<>?]/.test(password)) passwordErrors.push('symbol');

    if (passwordErrors.length > 0) {
      setError(`Password needs: ${passwordErrors.join(', ')}`);
      return;
    }

    if (!inviteToken.trim()) {
      setError('Invite token is required');
      return;
    }

    let finalUsername = username;
    if (loginMethod === 'wallet' && walletAddress) {
      finalUsername = `wallet_${walletAddress.slice(2, 10).toLowerCase()}`;
    }

    if (!finalUsername) {
      setError('Username is required');
      return;
    }

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
      localStorage.setItem('jwt_token', result.data.access_token);
      const userResult = await getCurrentUser();

      setAuth(
        {
          id: result.data.user_id,
          uuid: userResult.data?.uuid,
          username: finalUsername,
          email: email || userResult.data?.email || '',
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
      setSuccessMessage('Invite token generated!');
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

  // Password strength indicator
  const getPasswordStrength = () => {
    let strength = 0;
    if (password.length >= 8) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[a-z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[!@#$%^&*()_+\-=\[\]{}|;':",.\/<>?]/.test(password)) strength++;
    return strength;
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex items-center justify-center px-4 py-8">
      <div className="max-w-md w-full">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-16 h-16 rounded-2xl bg-[#14B8A6] border-[4px] border-black flex items-center justify-center shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] animate-float">
              <span className="text-3xl">🏥</span>
            </div>
          </div>
          <h1 className="text-4xl font-bold">
            <span className="highlight-teal">Cipher</span>Health
          </h1>
          <p className="text-gray-600 mt-2 font-medium">Secure Health Records</p>
        </div>

        {/* Auth Card */}
        <Card hoverable={false} className="p-0 overflow-hidden">
          {/* Tab Navigation */}
          <div className="flex border-b-[3px] border-black">
            <button
              onClick={() => { setMode('login'); setError(null); }}
              className={`flex-1 py-4 text-base font-bold transition-colors ${mode === 'login'
                  ? 'bg-black text-white'
                  : 'bg-white text-black hover:bg-gray-100'
                }`}
            >
              Login
            </button>
            <button
              onClick={() => { setMode('register'); setError(null); }}
              className={`flex-1 py-4 text-base font-bold transition-colors border-l-[3px] border-r-[3px] border-black ${mode === 'register'
                  ? 'bg-black text-white'
                  : 'bg-white text-black hover:bg-gray-100'
                }`}
            >
              Register
            </button>
            <button
              onClick={() => { setMode('invite'); setError(null); }}
              className={`flex-1 py-4 text-base font-bold transition-colors ${mode === 'invite'
                  ? 'bg-black text-white'
                  : 'bg-white text-black hover:bg-gray-100'
                }`}
            >
              Get Invite
            </button>
          </div>

          <CardContent className="p-6">
            {/* Error Message */}
            {error && (
              <div className="mb-4 p-3 bg-[#FEF2F2] border-2 border-[#EF4444] rounded-xl flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-[#DC2626]" />
                <span className="text-sm font-medium text-[#DC2626]">{error}</span>
              </div>
            )}

            {/* Success Message */}
            {successMessage && (
              <div className="mb-4 p-3 bg-[#ECFDF5] border-2 border-[#10B981] rounded-xl flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-[#059669]" />
                <span className="text-sm font-medium text-[#059669]">{successMessage}</span>
              </div>
            )}

            {/* =================== INVITE GENERATOR =================== */}
            {mode === 'invite' && (
              <div className="space-y-4">
                <div className="text-center mb-6">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#FFC224] border-[3px] border-black flex items-center justify-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    <Ticket className="w-8 h-8" />
                  </div>
                  <h3 className="text-xl font-bold">Generate Patient Invite</h3>
                  <p className="text-sm text-gray-600 mt-1 font-medium">
                    Enter admin password to generate tokens
                  </p>
                </div>

                <div>
                  <Label htmlFor="invite-password">Admin Password</Label>
                  <Input
                    id="invite-password"
                    type="password"
                    value={invitePassword}
                    onChange={(e) => setInvitePassword(e.target.value)}
                    className="mt-2"
                    placeholder="Enter admin password"
                    autoComplete="off"
                  />
                </div>

                <Button
                  onClick={handleGenerateInvite}
                  disabled={isGeneratingInvite || !invitePassword.trim()}
                  variant="yellow"
                  className="w-full"
                >
                  <Ticket className="w-5 h-5" />
                  {isGeneratingInvite ? 'Generating...' : 'Generate Token'}
                </Button>

                {/* Generated Tokens List */}
                {generatedTokens.length > 0 && (
                  <div className="mt-6">
                    <Label>Generated Tokens</Label>
                    <div className="space-y-2 mt-2 max-h-60 overflow-y-auto">
                      {generatedTokens.map((t, idx) => (
                        <div
                          key={`${t.token}-${idx}`}
                          className={`p-3 rounded-xl border-2 ${t.used || t.expired
                              ? 'bg-gray-50 border-gray-300'
                              : 'bg-[#ECFDF5] border-[#10B981]'
                            }`}
                        >
                          <div className="flex items-center justify-between">
                            <code className="text-xs font-mono text-gray-700 truncate flex-1 mr-2">
                              {t.token.substring(0, 24)}...
                            </code>
                            {!t.used && !t.expired ? (
                              <Button
                                onClick={() => handleCopyToken(t.token)}
                                size="sm"
                                variant={copiedToken === t.token ? 'green' : 'outline'}
                              >
                                {copiedToken === t.token ? (
                                  <><Check className="w-4 h-4" /> Copied</>
                                ) : (
                                  <><Copy className="w-4 h-4" /> Copy</>
                                )}
                              </Button>
                            ) : (
                              <Badge variant={t.used ? 'secondary' : 'warning'}>
                                {t.used ? 'Used' : 'Expired'}
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-xs text-gray-500 text-center mt-4 font-medium">
                  Each token can only be used once
                </p>
              </div>
            )}

            {/* =================== LOGIN FORM =================== */}
            {mode === 'login' && (
              <div className="space-y-4">
                {/* Login Method Toggle */}
                <div className="flex gap-2 mb-6">
                  <button
                    type="button"
                    onClick={() => setLoginMethod('password')}
                    className={`flex-1 py-3 px-4 text-sm font-bold rounded-xl border-[3px] border-black transition-all flex items-center justify-center gap-2 ${loginMethod === 'password'
                        ? 'bg-black text-white shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)]'
                        : 'bg-white text-black hover:bg-gray-50'
                      }`}
                  >
                    <KeyRound className="w-4 h-4" />
                    Username
                  </button>
                  <button
                    type="button"
                    onClick={() => setLoginMethod('wallet')}
                    className={`flex-1 py-3 px-4 text-sm font-bold rounded-xl border-[3px] border-black transition-all flex items-center justify-center gap-2 ${loginMethod === 'wallet'
                        ? 'bg-black text-white shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)]'
                        : 'bg-white text-black hover:bg-gray-50'
                      }`}
                  >
                    <Wallet className="w-4 h-4" />
                    Wallet
                  </button>
                </div>

                {loginMethod === 'password' ? (
                  /* Username + Password Login */
                  <form onSubmit={handlePasswordLogin} className="space-y-4">
                    <div>
                      <Label htmlFor="username">Username</Label>
                      <Input
                        id="username"
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        required
                        className="mt-2"
                        placeholder="Enter your username"
                      />
                    </div>

                    <div>
                      <Label htmlFor="password">Password</Label>
                      <div className="relative mt-2">
                        <Input
                          id="password"
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          placeholder="Enter your password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-1"
                        >
                          {showPassword ? <EyeOff className="w-5 h-5 text-gray-500" /> : <Eye className="w-5 h-5 text-gray-500" />}
                        </button>
                      </div>
                    </div>

                    <Button type="submit" disabled={isLoading} className="w-full" variant="teal">
                      <Lock className="w-5 h-5" />
                      {isLoading ? 'Signing in...' : 'Sign In'}
                    </Button>
                  </form>
                ) : (
                  /* Wallet + Password Login */
                  <div className="space-y-4">
                    {!isConnected ? (
                      <div className="text-center py-6">
                        <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-[#FF6B7A] border-[3px] border-black flex items-center justify-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                          <span className="text-4xl">🦊</span>
                        </div>
                        <p className="text-gray-600 font-medium mb-4">
                          {isMetaMaskInstalled
                            ? 'Connect your wallet to login'
                            : 'Please install MetaMask'}
                        </p>

                        {!isMetaMaskInstalled && (
                          <a
                            href="https://metamask.io/download/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block mb-4 text-[#2F81F7] font-bold hover:underline"
                          >
                            Download MetaMask →
                          </a>
                        )}

                        <Button
                          type="button"
                          onClick={handleConnectWallet}
                          disabled={isConnecting || !isMetaMaskInstalled}
                          variant="coral"
                          className="w-full"
                        >
                          <Wallet className="w-5 h-5" />
                          {isConnecting ? 'Connecting...' : 'Connect MetaMask'}
                        </Button>
                      </div>
                    ) : (
                      <form onSubmit={handleWalletPasswordLogin} className="space-y-4">
                        <div className="p-4 bg-[#ECFDF5] border-2 border-[#10B981] rounded-xl">
                          <div className="flex items-center gap-2">
                            <CheckCircle className="w-5 h-5 text-[#059669]" />
                            <span className="text-sm font-bold text-[#059669]">
                              Connected: {walletAddress?.slice(0, 6)}...{walletAddress?.slice(-4)}
                            </span>
                          </div>
                          {!isCorrectNetwork && (
                            <button
                              type="button"
                              onClick={switchToSepolia}
                              className="mt-2 text-sm font-bold text-[#D97706] hover:underline flex items-center gap-1"
                            >
                              ⚠️ Switch to Sepolia Network
                            </button>
                          )}
                        </div>

                        <div>
                          <Label htmlFor="wallet-password">Password</Label>
                          <Input
                            id="wallet-password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            className="mt-2"
                            placeholder="Enter your password"
                          />
                        </div>

                        <Button type="submit" disabled={isLoading} className="w-full" variant="teal">
                          <Zap className="w-5 h-5" />
                          {isLoading ? 'Signing in...' : 'Sign In with Wallet'}
                        </Button>
                      </form>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* =================== REGISTER FORM =================== */}
            {mode === 'register' && (
              <form onSubmit={handleRegister} className="space-y-4">
                {/* Role Toggle */}
                <div>
                  <Label>I am a</Label>
                  <div className="flex gap-3 mt-2">
                    <button
                      type="button"
                      onClick={() => setRegisterRole('patient')}
                      className={`flex-1 py-4 px-4 rounded-xl border-[3px] border-black font-bold transition-all flex items-center justify-center gap-2 ${registerRole === 'patient'
                          ? 'bg-[#14B8A6] text-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]'
                          : 'bg-white text-black hover:bg-gray-50'
                        }`}
                    >
                      <User className="w-5 h-5" />
                      Patient
                    </button>
                    <button
                      type="button"
                      onClick={() => setRegisterRole('hospital')}
                      className={`flex-1 py-4 px-4 rounded-xl border-[3px] border-black font-bold transition-all flex items-center justify-center gap-2 ${registerRole === 'hospital'
                          ? 'bg-[#2F81F7] text-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]'
                          : 'bg-white text-black hover:bg-gray-50'
                        }`}
                    >
                      <Building2 className="w-5 h-5" />
                      Hospital
                    </button>
                  </div>
                </div>

                {/* Registration Method Toggle */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setLoginMethod('password')}
                    className={`flex-1 py-2.5 px-3 text-sm font-bold rounded-lg border-2 border-black transition-all flex items-center justify-center gap-2 ${loginMethod === 'password'
                        ? 'bg-black text-white'
                        : 'bg-white text-black hover:bg-gray-50'
                      }`}
                  >
                    <KeyRound className="w-4 h-4" />
                    Username
                  </button>
                  <button
                    type="button"
                    onClick={() => setLoginMethod('wallet')}
                    className={`flex-1 py-2.5 px-3 text-sm font-bold rounded-lg border-2 border-black transition-all flex items-center justify-center gap-2 ${loginMethod === 'wallet'
                        ? 'bg-black text-white'
                        : 'bg-white text-black hover:bg-gray-50'
                      }`}
                  >
                    <Wallet className="w-4 h-4" />
                    Wallet
                  </button>
                </div>

                {loginMethod === 'wallet' && (
                  <div>
                    {!isConnected ? (
                      <Button
                        type="button"
                        onClick={handleConnectWallet}
                        disabled={isConnecting || !isMetaMaskInstalled}
                        variant="coral"
                        className="w-full"
                      >
                        <Wallet className="w-5 h-5" />
                        {isConnecting ? 'Connecting...' : 'Connect MetaMask'}
                      </Button>
                    ) : (
                      <div className="p-3 bg-[#ECFDF5] border-2 border-[#10B981] rounded-xl flex items-center gap-2">
                        <CheckCircle className="w-5 h-5 text-[#059669]" />
                        <span className="text-sm font-bold text-[#059669]">
                          {walletAddress?.slice(0, 6)}...{walletAddress?.slice(-4)}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {loginMethod === 'password' && (
                  <div>
                    <Label htmlFor="reg-username">Username</Label>
                    <Input
                      id="reg-username"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      className="mt-2"
                      placeholder="Choose a username"
                    />
                  </div>
                )}

                <div>
                  <Label htmlFor="email">Email (optional)</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-2"
                    placeholder="your@email.com"
                  />
                </div>

                <div>
                  <Label htmlFor="reg-password">Password *</Label>
                  <Input
                    id="reg-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    className="mt-2"
                    placeholder="Strong password required"
                  />
                  {/* Password Strength Indicator */}
                  <div className="mt-2 flex gap-1">
                    {[1, 2, 3, 4, 5].map((level) => (
                      <div
                        key={level}
                        className={`h-2 flex-1 rounded-full border border-black ${getPasswordStrength() >= level
                            ? level <= 2 ? 'bg-[#EF4444]' : level <= 4 ? 'bg-[#FFC224]' : 'bg-[#10B981]'
                            : 'bg-gray-200'
                          }`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-1 font-medium">
                    8+ chars, upper, lower, number, symbol
                  </p>
                </div>

                <div>
                  <Label htmlFor="confirm-password">Confirm Password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className="mt-2"
                    placeholder="Confirm your password"
                    success={confirmPassword.length > 0 && password === confirmPassword}
                    error={confirmPassword.length > 0 && password !== confirmPassword}
                  />
                </div>

                {/* Invite Token */}
                <div>
                  <Label htmlFor="invite-token">Invite Token *</Label>
                  <div className="relative mt-2">
                    <Input
                      id="invite-token"
                      type="text"
                      value={inviteToken}
                      onChange={(e) => setInviteToken(e.target.value)}
                      required
                      placeholder="Paste invite token"
                      success={inviteValid === true}
                      error={inviteValid === false}
                    />
                    {inviteValid !== null && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2">
                        {inviteValid ? (
                          <CheckCircle className="w-5 h-5 text-[#10B981]" />
                        ) : (
                          <AlertCircle className="w-5 h-5 text-[#EF4444]" />
                        )}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-500 font-medium">
                    Get one from the "Get Invite" tab
                  </p>
                </div>

                {/* Hospital-specific: Master Secret */}
                {registerRole === 'hospital' && (
                  <div className="p-4 bg-[#FFFBEB] border-2 border-[#F59E0B] rounded-xl">
                    <Label htmlFor="master-secret" className="text-[#B45309]">
                      🔐 Hospital Registration Secret
                    </Label>
                    <Input
                      id="master-secret"
                      type="password"
                      value={masterSecret}
                      onChange={(e) => setMasterSecret(e.target.value)}
                      required
                      className="mt-2"
                      placeholder="Enter the master secret"
                    />
                    <p className="mt-1 text-xs text-[#B45309] font-medium">
                      Contact system administrator
                    </p>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={isLoading || (loginMethod === 'wallet' && !isConnected)}
                  variant={registerRole === 'patient' ? 'teal' : 'blue'}
                  className="w-full"
                >
                  {isLoading ? 'Creating account...' : 'Create Account'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="mt-6 text-center">
          <Badge variant="outline" className="py-2 px-4">
            <Lock className="w-4 h-4 mr-2" />
            End-to-End Encrypted
          </Badge>
        </div>
      </div>
    </div>
  );
}
