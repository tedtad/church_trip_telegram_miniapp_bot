'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MessageSquare, Download } from 'lucide-react';
import { TelegramUser } from '@/lib/types';

interface CustomerWithStats extends TelegramUser {
  total_tickets?: number;
  total_spent?: number;
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    loadCustomers();
  }, []);

  const loadCustomers = async () => {
    try {
      setLoading(true);
      const supabase = createClient();

      const { data, error } = await supabase
        .from('telegram_users')
        .select(`
          *,
          tickets: tickets (count),
          receipts: receipts (amount_paid)
        `)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[customers] Error loading:', error);
        return;
      }

      const customersWithStats = data?.map((customer) => ({
        ...customer,
        total_tickets: customer.tickets?.[0]?.count || 0,
        total_spent: customer.receipts?.reduce((sum: number, r: any) => sum + (r.amount_paid || 0), 0) || 0,
      })) || [];

      setCustomers(customersWithStats);
    } catch (error) {
      console.error('[customers] Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredCustomers = customers.filter((customer) => {
    const query = searchQuery.toLowerCase();
    return (
      customer.first_name?.toLowerCase().includes(query) ||
      customer.username?.toLowerCase().includes(query) ||
      customer.phone_number?.includes(query)
    );
  });

  const exportToCSV = async () => {
    try {
      setExporting(true);
      const csv = [
        ['ID', 'Name', 'Username', 'Phone', 'Tickets', 'Total Spent', 'Joined'],
        ...filteredCustomers.map((c) => [
          c.id,
          `${c.first_name} ${c.last_name || ''}`,
          c.username || '',
          c.phone_number || '',
          c.total_tickets || 0,
          c.total_spent || 0,
          new Date(c.created_at).toLocaleDateString(),
        ]),
      ]
        .map((row) => row.map((cell) => `"${cell}"`).join(','))
        .join('\n');

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `customers-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const sendNotification = async (customer: CustomerWithStats) => {
    try {
      await fetch('/api/telegram/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegramUserId: customer.id,
          type: 'announcement',
          title: 'Hello!',
          message: 'Thank you for using TicketHub!',
        }),
      });

      alert('Notification sent!');
    } catch (error) {
      alert('Error sending notification');
      console.error(error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-300">Loading customers...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-white">Customers</h1>
        <Button
          onClick={exportToCSV}
          disabled={exporting}
          className="bg-primary hover:bg-primary/90 text-white flex items-center gap-2"
        >
          <Download size={18} />
          {exporting ? 'Exporting...' : 'Export CSV'}
        </Button>
      </div>

      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="Search by name, username, or phone..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-4 py-2 bg-slate-800 border border-slate-700 text-white rounded-lg placeholder:text-slate-400 focus:outline-none focus:border-primary"
        />
      </div>

      {/* Customers Table */}
      <Card className="bg-slate-800 border-slate-700 overflow-hidden">
        {filteredCustomers.length === 0 ? (
          <div className="p-6 text-center text-slate-400">
            No customers found
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-900 border-b border-slate-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Username</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Phone</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Tickets</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Total Spent</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Joined</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {filteredCustomers.map((customer) => (
                  <tr key={customer.id} className="hover:bg-slate-700/50 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium text-white">
                      {customer.first_name} {customer.last_name}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-300">
                      @{customer.username || '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-300">
                      {customer.phone_number || '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-300">
                      {customer.total_tickets}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-300">
                      {customer.total_spent} ETB
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-300">
                      {new Date(customer.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-sm flex gap-2">
                      <button
                        onClick={() => sendNotification(customer)}
                        className="text-blue-400 hover:text-blue-300"
                        title="Send notification"
                      >
                        <MessageSquare size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Summary */}
      <Card className="bg-slate-800 border-slate-700 mt-6">
        <div className="p-6">
          <h3 className="text-white font-semibold mb-4">Summary</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-slate-400">Total Customers</p>
              <p className="text-2xl font-bold text-white">{customers.length}</p>
            </div>
            <div>
              <p className="text-slate-400">Total Tickets Sold</p>
              <p className="text-2xl font-bold text-white">
                {customers.reduce((sum, c) => sum + (c.total_tickets || 0), 0)}
              </p>
            </div>
            <div>
              <p className="text-slate-400">Total Revenue</p>
              <p className="text-2xl font-bold text-white">
                {customers.reduce((sum, c) => sum + (c.total_spent || 0), 0).toFixed(2)} ETB
              </p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
