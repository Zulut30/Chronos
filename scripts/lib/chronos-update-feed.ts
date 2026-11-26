export function chronosUpdateFeed(url: string, channel: string) {
  // GitHub release assets support one byte range per request.
  return { provider: "generic", url, channel, useMultipleRangeRequest: false } as const;
}
