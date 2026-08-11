export default function handler(): Response {
  return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } })
}
