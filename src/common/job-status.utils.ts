/**
 * Valid status transitions map
 * Key: current status, Value: array of allowed next statuses
 */
export const VALID_JOB_STATUS_TRANSITIONS: Record<string, string[]> = {
  pending_owner_approval: ['queued', 'pending', 'cancelled'],
  pending: ['queued', 'cancelled'],
  queued: ['printing', 'cancelled'],
  printing: ['completed', 'failed', 'cancelled'],
  completed: [], // Terminal state - no transitions allowed
  failed: [], // Terminal state - no transitions allowed
  cancelled: [], // Terminal state - no transitions allowed
};

/**
 * Validate if a job status transition is allowed
 * @throws Error if transition is invalid
 */
export function validateJobStatusTransition(
  fromStatus: string,
  toStatus: string,
): void {
  const allowedTransitions = VALID_JOB_STATUS_TRANSITIONS[fromStatus];

  if (!allowedTransitions) {
    throw new Error(`Unknown job status: ${fromStatus}`);
  }

  if (!allowedTransitions.includes(toStatus)) {
    throw new Error(
      `Cannot transition from ${fromStatus} to ${toStatus}. Allowed transitions: ${allowedTransitions.length > 0 ? allowedTransitions.join(', ') : 'none (terminal state)'}`,
    );
  }
}
