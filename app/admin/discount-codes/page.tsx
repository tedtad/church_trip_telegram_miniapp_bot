'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertCircle, CheckCircle, Copy, Edit, Loader, Plus, Search, Trash2, X } from 'lucide-react'

interface DiscountCode {
  id: string
  code: string
  discountPercent: number
  maxUses: number | null
  currentUses: number
  tripId: string | null
  tripName: string | null
  validFrom: string | null
  expiresAt: string | null
  isActive: boolean
  createdAt: string
}

export default function DiscountCodesPage() {
  const [codes, setCodes] = useState<DiscountCode[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  // Form states
  const [formData, setFormData] = useState({
    code: '',
    discountPercent: 10,
    maxUses: null as number | null,
    tripId: '',
    validFrom: '',
    expiresAt: '',
    isActive: true,
  })

  useEffect(() => {
    loadCodes()
  }, [])

  async function loadCodes() {
    try {
      setLoading(true)
      const res = await fetch('/api/admin/discount-codes')
      if (res.ok) {
        const data = await res.json()
        setCodes(data.codes || [])
      }
    } catch (error) {
      console.error('[v0] Error loading discount codes:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    try {
      const endpoint = editingId ? `/api/admin/discount-codes/${editingId}` : '/api/admin/discount-codes/create'
      const method = editingId ? 'PUT' : 'POST'

      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          maxUses: formData.maxUses ? parseInt(String(formData.maxUses)) : null,
        }),
      })

      if (res.ok) {
        setFormData({
          code: '',
          discountPercent: 10,
          maxUses: null,
          tripId: '',
          validFrom: '',
          expiresAt: '',
          isActive: true,
        })
        setEditingId(null)
        setShowForm(false)
        await loadCodes()
      }
    } catch (error) {
      console.error('[v0] Error saving discount code:', error)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this discount code?')) return

    try {
      const res = await fetch(`/api/admin/discount-codes/${id}`, { method: 'DELETE' })
      if (res.ok) {
        await loadCodes()
      }
    } catch (error) {
      console.error('[v0] Error deleting discount code:', error)
    }
  }

  function handleEdit(code: DiscountCode) {
    setFormData({
      code: code.code,
      discountPercent: code.discountPercent,
      maxUses: code.maxUses,
      tripId: code.tripId || '',
      validFrom: code.validFrom ? code.validFrom.split('T')[0] : '',
      expiresAt: code.expiresAt ? code.expiresAt.split('T')[0] : '',
      isActive: code.isActive,
    })
    setEditingId(code.id)
    setShowForm(true)
  }

  function handleCopyCode(code: string) {
    navigator.clipboard.writeText(code)
    setCopiedCode(code)
    setTimeout(() => setCopiedCode(null), 2000)
  }

  const filteredCodes = codes.filter((c) => c.code.toLowerCase().includes(searchTerm.toLowerCase()))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Discount Codes</h1>
          <p className="text-muted-foreground mt-1">Manage promotional codes and vouchers</p>
        </div>
        <Button onClick={() => { setShowForm(true); setEditingId(null); }}>
          <Plus className="w-4 h-4 mr-2" />
          New Discount Code
        </Button>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Total Codes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{codes.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Active</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{codes.filter((c) => c.isActive).length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Total Uses</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{codes.reduce((sum, c) => sum + c.currentUses, 0)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Avg Discount</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {codes.length > 0 ? (codes.reduce((sum, c) => sum + c.discountPercent, 0) / codes.length).toFixed(1) : 0}%
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Create/Edit Form */}
      {showForm && (
        <Card className="border-blue-200 dark:border-blue-900">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{editingId ? 'Edit Discount Code' : 'Create New Discount Code'}</CardTitle>
              <button
                onClick={() => { setShowForm(false); setEditingId(null); }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Discount Code</label>
                  <input
                    type="text"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    placeholder="e.g., SAVE20"
                    className="w-full px-3 py-2 border rounded-md bg-background"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Discount Percentage (%)</label>
                  <input
                    type="number"
                    value={formData.discountPercent}
                    onChange={(e) => setFormData({ ...formData, discountPercent: parseFloat(e.target.value) })}
                    min="0"
                    max="100"
                    step="0.5"
                    className="w-full px-3 py-2 border rounded-md bg-background"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Max Uses (leave empty for unlimited)</label>
                  <input
                    type="number"
                    value={formData.maxUses || ''}
                    onChange={(e) => setFormData({ ...formData, maxUses: e.target.value ? parseInt(e.target.value) : null })}
                    min="1"
                    className="w-full px-3 py-2 border rounded-md bg-background"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Valid From</label>
                  <input
                    type="date"
                    value={formData.validFrom}
                    onChange={(e) => setFormData({ ...formData, validFrom: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md bg-background"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Expires At</label>
                  <input
                    type="date"
                    value={formData.expiresAt}
                    onChange={(e) => setFormData({ ...formData, expiresAt: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md bg-background"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Trip ID (optional)</label>
                  <input
                    type="text"
                    value={formData.tripId}
                    onChange={(e) => setFormData({ ...formData, tripId: e.target.value })}
                    placeholder="Leave empty for all trips"
                    className="w-full px-3 py-2 border rounded-md bg-background"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="rounded"
                />
                <label className="text-sm font-medium">Active</label>
              </div>

              <div className="flex gap-2">
                <Button type="submit">{editingId ? 'Update Code' : 'Create Code'}</Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { setShowForm(false); setEditingId(null); }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by code name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded-lg bg-background"
          />
        </div>
      </div>

      {/* Discount Codes Table */}
      <Card>
        <CardHeader>
          <CardTitle>Discount Codes</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">
              <Loader className="w-6 h-6 animate-spin mx-auto" />
            </div>
          ) : filteredCodes.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {codes.length === 0 ? 'No discount codes created yet' : 'No codes match your search'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr>
                    <th className="text-left py-3 px-4 font-semibold">Code</th>
                    <th className="text-left py-3 px-4 font-semibold">Discount</th>
                    <th className="text-left py-3 px-4 font-semibold">Uses</th>
                    <th className="text-left py-3 px-4 font-semibold">Valid Period</th>
                    <th className="text-left py-3 px-4 font-semibold">Status</th>
                    <th className="text-right py-3 px-4 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCodes.map((code) => (
                    <tr key={code.id} className="border-b hover:bg-muted/50">
                      <td className="py-3 px-4 font-mono font-semibold">
                        <div className="flex items-center gap-2">
                          {code.code}
                          <button
                            onClick={() => handleCopyCode(code.code)}
                            className="text-muted-foreground hover:text-foreground"
                            title="Copy code"
                          >
                            {copiedCode === code.code ? (
                              <CheckCircle className="w-4 h-4 text-green-600" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="py-3 px-4 font-semibold text-green-600">{code.discountPercent}%</td>
                      <td className="py-3 px-4 text-xs">
                        {code.currentUses}
                        {code.maxUses ? `/${code.maxUses}` : '/unlimited'}
                      </td>
                      <td className="py-3 px-4 text-xs">
                        {code.validFrom ? new Date(code.validFrom).toLocaleDateString() : 'Now'} to{' '}
                        {code.expiresAt ? new Date(code.expiresAt).toLocaleDateString() : 'Forever'}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1">
                          {code.isActive ? (
                            <>
                              <CheckCircle className="w-4 h-4 text-green-600" />
                              <span className="text-green-600">Active</span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="w-4 h-4 text-red-600" />
                              <span className="text-red-600">Inactive</span>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => handleEdit(code)}
                            className="text-blue-600 hover:text-blue-700"
                            title="Edit code"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(code.id)}
                            className="text-red-600 hover:text-red-700"
                            title="Delete code"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
