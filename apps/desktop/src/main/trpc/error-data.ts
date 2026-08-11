export function redactTrpcErrorData(data: {
  code: string
  httpStatus: number
  path?: string
}): { code: string; httpStatus: number; path?: string } {
  return {
    code: data.code,
    httpStatus: data.httpStatus,
    ...(data.path ? { path: data.path } : {}),
  }
}
