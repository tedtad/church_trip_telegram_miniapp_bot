import QRCode from 'qrcode'

export interface QRCodeOptions {
  width?: number
  margin?: number
  color?: {
    dark?: string
    light?: string
  }
}

/**
 * Generate QR code as data URL
 */
export async function generateQRCodeDataURL(
  text: string,
  options: QRCodeOptions = {}
): Promise<string> {
  try {
    const qrOptions = {
      width: options.width || 300,
      margin: options.margin || 2,
      color: {
        dark: options.color?.dark || '#000000',
        light: options.color?.light || '#FFFFFF',
      },
    }

    const dataURL = await QRCode.toDataURL(text, qrOptions)
    return dataURL
  } catch (error) {
    console.error('[v0] QR Code generation error:', error)
    throw error
  }
}

/**
 * Generate QR code as canvas
 */
export async function generateQRCodeCanvas(
  text: string,
  canvasElement: HTMLCanvasElement,
  options: QRCodeOptions = {}
): Promise<void> {
  try {
    const qrOptions = {
      width: options.width || 300,
      margin: options.margin || 2,
      color: {
        dark: options.color?.dark || '#000000',
        light: options.color?.light || '#FFFFFF',
      },
    }

    await QRCode.toCanvas(canvasElement, text, qrOptions)
  } catch (error) {
    console.error('[v0] QR Code canvas generation error:', error)
    throw error
  }
}

/**
 * Generate ticket QR code with serial number
 */
export async function generateTicketQRCode(
  ticketId: string,
  serialNumber: string,
  baseURL: string = process.env.NEXT_PUBLIC_APP_URL || 'https://tickethub.app'
): Promise<string> {
  const ticketURL = `${baseURL}/verify-ticket/${ticketId}?serial=${serialNumber}`
  return generateQRCodeDataURL(ticketURL, {
    width: 400,
    margin: 2,
    color: { dark: '#1a1a1a', light: '#ffffff' },
  })
}

/**
 * Generate invitation QR code
 */
export async function generateInvitationQRCode(
  invitationCode: string,
  baseURL: string = process.env.NEXT_PUBLIC_APP_URL || 'https://tickethub.app'
): Promise<string> {
  const inviteURL = `${baseURL}/invite/${invitationCode}`
  return generateQRCodeDataURL(inviteURL, {
    width: 400,
    margin: 2,
    color: { dark: '#1a1a1a', light: '#ffffff' },
  })
}

/**
 * Generate admin group invite QR code
 */
export async function generateAdminGroupQRCode(
  groupLink: string,
  options: QRCodeOptions = {}
): Promise<string> {
  return generateQRCodeDataURL(groupLink, {
    width: options.width || 400,
    margin: options.margin || 2,
    color: { dark: '#1a1a1a', light: '#ffffff' },
  })
}
