export default {
  fetch(): Response {
    return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } })
  },
}
