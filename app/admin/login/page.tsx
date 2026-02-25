'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { adminLogin } from '@/lib/admin-auth';
import { Lock, Mail } from 'lucide-react';

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await adminLogin(email, password);

    if (result.success) {
      router.push('/admin/dashboard');
    } else {
      setError(result.error || 'Login failed');
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 p-4">
      <Card className="w-full max-w-md bg-slate-800 border-slate-700 shadow-2xl">
        <div className="p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary mb-4">
              <Lock className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">TicketHub Admin</h1>
            <p className="text-slate-300 text-sm">Manage your ticket reservations</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email Input */}
            <div>
              <label className="block text-sm font-medium text-slate-200 mb-2">
                <Mail className="inline w-4 h-4 mr-2" />
                Email Address
              </label>
              <Input
                type="email"
                placeholder="admin@tickethub.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-700 border-slate-600 text-white placeholder:text-slate-400"
                disabled={loading}
                required
              />
            </div>

            {/* Password Input */}
            <div>
              <label className="block text-sm font-medium text-slate-200 mb-2">
                <Lock className="inline w-4 h-4 mr-2" />
                Password
              </label>
              <Input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-700 border-slate-600 text-white placeholder:text-slate-400"
                disabled={loading}
                required
              />
            </div>

            {/* Error Message */}
            {error && (
              <div className="p-3 rounded-lg bg-red-900/20 border border-red-800 text-red-200 text-sm">
                {error}
              </div>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-primary hover:bg-primary/90 text-white font-medium py-2"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>

          {/* Info Text */}
          <p className="text-center text-slate-400 text-xs mt-6">
            Secure admin login. Make sure to keep your credentials safe.
          </p>
        </div>
      </Card>
    </div>
  );
}
