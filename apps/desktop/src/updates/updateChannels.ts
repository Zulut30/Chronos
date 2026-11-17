import { chronosUpstreamVersion } from "@t3tools/shared/cliRelease";

// Preview builds share nightly branding but ship without an update feed.
const PRERELEASE_VERSION_PATTERN = /^[^-+]+-(?:nightly|preview)\.\d{8}\.\d+$/;

export function isNightlyDesktopVersion(version: string): boolean {
  // chronos: a Chronos build is a nightly of the upstream build it is based on.
  return PRERELEASE_VERSION_PATTERN.test(chronosUpstreamVersion(version));
}
