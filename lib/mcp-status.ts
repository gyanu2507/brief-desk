/**
 * Status line for the MCP backend, or null when there's nothing to say.
 *
 * mcpOk is null while the first health check is in flight, false when the
 * check failed, and true when the backend answered. slow is true once the
 * first check has been pending for a few seconds.
 */
export function mcpStatusMessage(
  mcpOk: boolean | null,
  hasOrchestrate: boolean,
  slow: boolean,
): string | null {
  if (mcpOk === null) {
    return slow
      ? "Waking the backend. It sleeps when idle on the free tier and can take up to a minute to start."
      : null;
  }
  if (mcpOk === false) {
    return "Can't reach the backend yet. It may still be starting, so this page checks again every 5 seconds.";
  }
  if (!hasOrchestrate) {
    return "The backend is up but missing brief_orchestrate. Redeploy the MCP service.";
  }
  return null;
}
