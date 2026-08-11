import type { VercelRequest, VercelResponse } from '@vercel/node'

export default function handler(_request: VercelRequest, response: VercelResponse): void {
  response.setHeader('Cache-Control', 'no-store')
  response.status(200).json({ status: 'ok' })
}
