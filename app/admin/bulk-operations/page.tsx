'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertCircle, CheckCircle, Send, Trash2 } from 'lucide-react'

interface BulkOperation {
  id: string
  type: 'notify' | 'approve' | 'reject' | 'cancel'
  status: 'pending' | 'completed' | 'failed'
  targetCount: number
  processedCount: number
  failedCount: number
  createdAt: string
}

export default function BulkOperationsPage() {
  const [operations, setOperations] = useState<BulkOperation[]>([])
  const [operationType, setOperationType] = useState<'notify' | 'approve' | 'reject'>('notify')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [processing, setProcessing] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [language, setLanguage] = useState<'en' | 'am'>('en')

  const t = {
    en: {
      title: 'Bulk Operations',
      subtitle: 'Perform actions on multiple customers or tickets',
      type: 'Operation Type',
      notify: 'Send Bulk Notification',
      approve: 'Bulk Approve Tickets',
      reject: 'Bulk Reject Tickets',
      uploadCSV: 'Upload CSV File',
      process: 'Process',
      history: 'Operation History',
      status: 'Status',
      processed: 'Processed',
      failed: 'Failed',
      completed: 'Completed',
      pending: 'Pending',
      selectFile: 'Select a CSV file',
      chooseFile: 'Choose File',
      processing: 'Processing...',
    },
    am: {
      title: 'ብዙ ተግባራት',
      subtitle: 'በብዙ ደንበኞች ወይም ትኬቶች ላይ ተግባራት ይስሩ',
      type: 'ተግባር ዓይነት',
      notify: 'ብዙ ማሳወቂያ ላክ',
      approve: 'ብዙ ትኬቶች ፍቀድ',
      reject: 'ብዙ ትኬቶች ምቃት',
      uploadCSV: 'CSV ፋይል ስቀል',
      process: 'ሂደት',
      history: 'ተግባር ታሪክ',
      status: 'ሁኔታ',
      processed: 'ተሰራ',
      failed: 'ወድቅ ደረሰ',
      completed: 'ተጠናቅቆ',
      pending: 'በሕዳፍ ላይ',
      selectFile: 'CSV ፋይል ይምረጡ',
      chooseFile: 'ፋይል ይምረጡ',
      processing: 'በሂደት ላይ...',
    },
  }

  const labels = t[language]

  useEffect(() => {
    loadOperations()
  }, [])

  async function loadOperations() {
    try {
      const res = await fetch('/api/admin/bulk-operations')
      if (!res.ok) return
      const data = await res.json()
      setOperations(data.operations || [])
    } catch (error) {
      console.error('[v0] Bulk operations load error:', error)
    }
  }

  async function handleProcess() {
    if (!selectedFile) return

    try {
      setProcessing(true)
      const formData = new FormData()
      formData.append('file', selectedFile)
      formData.append('type', operationType)

      const res = await fetch('/api/admin/bulk-operations', {
        method: 'POST',
        body: formData,
      })

      if (res.ok) {
        await loadOperations()
        setSelectedFile(null)
      }
    } catch (error) {
      console.error('[v0] Bulk operation error:', error)
    } finally {
      setProcessing(false)
    }
  }

  async function handleDeleteOperation(operationId: string) {
    const confirmed = window.confirm('Delete this bulk operation from history?')
    if (!confirmed) return

    try {
      setDeletingId(operationId)
      const res = await fetch(`/api/admin/bulk-operations?id=${operationId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setOperations((prev) => prev.filter((op) => op.id !== operationId))
      }
    } catch (error) {
      console.error('[v0] Bulk operation delete error:', error)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{labels.title}</h1>
          <p className="text-muted-foreground mt-1">{labels.subtitle}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setLanguage(language === 'en' ? 'am' : 'en')}
        >
          {language === 'en' ? 'አማርኛ' : 'English'}
        </Button>
      </div>

      {/* Operations Form */}
      <Card>
        <CardHeader>
          <CardTitle>New Bulk Operation</CardTitle>
          <CardDescription>Select operation type and CSV file</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">{labels.type}</label>
              <select
                value={operationType}
                onChange={(e) =>
                  setOperationType(e.target.value as 'notify' | 'approve' | 'reject')
                }
                className="w-full px-3 py-2 border rounded-md bg-background"
              >
                <option value="notify">{labels.notify}</option>
                <option value="approve">{labels.approve}</option>
                <option value="reject">{labels.reject}</option>
              </select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">{labels.uploadCSV}</label>
              <div className="flex gap-2">
                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  className="flex-1 px-3 py-2 border rounded-md"
                />
              </div>
            </div>
          </div>

          <Button onClick={handleProcess} disabled={!selectedFile || processing} className="w-full">
            {processing ? (
              <>
                <AlertCircle className="w-4 h-4 mr-2 animate-spin" />
                {labels.processing}
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                {labels.process}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Operations History */}
      <Card>
        <CardHeader>
          <CardTitle>{labels.history}</CardTitle>
        </CardHeader>
        <CardContent>
          {operations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No operations yet</div>
          ) : (
            <div className="space-y-3">
              {operations.map((op) => (
                <div key={op.id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <div className="flex items-center gap-2">
                      {op.status === 'completed' ? (
                        <CheckCircle className="w-4 h-4 text-green-600" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-yellow-600" />
                      )}
                      <span className="font-medium capitalize">{op.type}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {labels.processed}: {op.processedCount}/{op.targetCount} | {labels.failed}:{' '}
                      {op.failedCount}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-600"
                    onClick={() => handleDeleteOperation(op.id)}
                    disabled={deletingId === op.id}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
