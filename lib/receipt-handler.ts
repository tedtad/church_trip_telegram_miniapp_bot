import { createClient } from '@/lib/supabase/client'

export interface CachedReceipt {
  id: string
  receiptId: string
  blob: Blob
  mimeType: string
  timestamp: number
  ttl: number
}

const RECEIPT_CACHE = new Map<string, CachedReceipt>()
const DEFAULT_TTL = 3600000 // 1 hour

export function generateThumbnail(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      if (file.type.startsWith('image/')) {
        // For images, create a thumbnail using canvas
        const img = new Image()
        img.onload = () => {
          const canvas = document.createElement('canvas')
          const maxDim = 200
          let width = img.width
          let height = img.height

          if (width > height) {
            if (width > maxDim) {
              height = Math.round((height * maxDim) / width)
              width = maxDim
            }
          } else if (height > maxDim) {
            width = Math.round((width * maxDim) / height)
            height = maxDim
          }

          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height)
          }

          resolve(canvas.toDataURL('image/jpeg', 0.7))
        }

        img.onerror = () => reject(new Error('Failed to load image'))
        img.src = e.target?.result as string
      } else if (file.type === 'application/pdf') {
        // For PDFs, return a PDF icon placeholder
        resolve('data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Crect fill="%23f3f4f6" width="100" height="100"/%3E%3Ctext x="50" y="55" text-anchor="middle" font-size="32" fill="%234b5563"%3EPDF%3C/text%3E%3C/svg%3E')
      } else {
        reject(new Error('Unsupported file type'))
      }
    }

    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

export function compressImage(file: File, maxSizeMB: number = 2): Promise<File> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      const img = new Image()

      img.onload = () => {
        const canvas = document.createElement('canvas')
        let { width, height } = img
        const aspectRatio = width / height
        const maxWidth = 1920
        const maxHeight = 1440

        if (width > maxWidth) {
          width = maxWidth
          height = Math.round(width / aspectRatio)
        }

        if (height > maxHeight) {
          height = maxHeight
          width = Math.round(height * aspectRatio)
        }

        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height)
        }

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Canvas conversion failed'))
              return
            }

            const maxSize = maxSizeMB * 1024 * 1024
            if (blob.size > maxSize) {
              reject(
                new Error(`Compressed image still exceeds ${maxSizeMB}MB limit. Size: ${(blob.size / 1024 / 1024).toFixed(2)}MB`)
              )
              return
            }

            resolve(new File([blob], file.name, { type: 'image/jpeg' }))
          },
          'image/jpeg',
          0.8
        )
      }

      img.onerror = () => reject(new Error('Failed to load image for compression'))
      img.src = e.target?.result as string
    }

    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

export function cacheReceipt(receiptId: string, blob: Blob, mimeType: string, ttl: number = DEFAULT_TTL): void {
  RECEIPT_CACHE.set(receiptId, {
    id: `cache-${Date.now()}`,
    receiptId,
    blob,
    mimeType,
    timestamp: Date.now(),
    ttl,
  })

  // Auto-cleanup after TTL
  setTimeout(() => {
    RECEIPT_CACHE.delete(receiptId)
  }, ttl)
}

export function getCachedReceipt(receiptId: string): Blob | null {
  const cached = RECEIPT_CACHE.get(receiptId)

  if (!cached) return null

  // Check if cache expired
  if (Date.now() - cached.timestamp > cached.ttl) {
    RECEIPT_CACHE.delete(receiptId)
    return null
  }

  return cached.blob
}

export async function downloadReceipt(receiptUrl: string, receiptId: string): Promise<Blob> {
  // Check cache first
  const cached = getCachedReceipt(receiptId)
  if (cached) return cached

  try {
    const response = await fetch(receiptUrl, {
      headers: {
        'Cache-Control': 'public, max-age=3600',
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to download receipt: ${response.statusText}`)
    }

    const blob = await response.blob()

    // Cache the receipt
    cacheReceipt(receiptId, blob, blob.type)

    return blob
  } catch (error) {
    console.error('[v0] Receipt download failed:', error)
    throw error
  }
}

export function createReceiptPreview(blob: Blob, mimeType: string): string {
  return URL.createObjectURL(blob)
}

export function revokeReceiptPreview(objectUrl: string): void {
  URL.revokeObjectURL(objectUrl)
}

export function validateReceiptFile(file: File, maxSizeMB: number = 10): { valid: boolean; error?: string } {
  const supportedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']

  if (!supportedTypes.includes(file.type)) {
    return {
      valid: false,
      error: `File type ${file.type} not supported. Supported: JPEG, PNG, WebP, PDF`,
    }
  }

  const maxSizeBytes = maxSizeMB * 1024 * 1024
  if (file.size > maxSizeBytes) {
    return {
      valid: false,
      error: `File size ${(file.size / 1024 / 1024).toFixed(2)}MB exceeds ${maxSizeMB}MB limit`,
    }
  }

  return { valid: true }
}

export function clearReceiptCache(): void {
  RECEIPT_CACHE.clear()
}

export function getReceiptCacheStats(): { size: number; entries: number } {
  let totalSize = 0
  RECEIPT_CACHE.forEach((receipt) => {
    totalSize += receipt.blob.size
  })

  return {
    size: totalSize,
    entries: RECEIPT_CACHE.size,
  }
}
