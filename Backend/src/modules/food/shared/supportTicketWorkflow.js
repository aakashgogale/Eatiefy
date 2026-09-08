import { ValidationError } from '../../../core/auth/errors.js';

/**
 * Support-ticket status lifecycles.
 *
 * Two variants exist in the data model and both are kept as they are stored:
 *  - `standard` — user and restaurant tickets: open / in-progress / resolved
 *  - `delivery` — delivery-partner tickets, which add a terminal `closed`
 *    state and use the underscored `in_progress` spelling.
 *
 * Moving a ticket forward is always allowed. Moving it back is allowed only
 * along the explicit correction paths below, so an admin can reopen a ticket
 * that was resolved or closed by mistake without the status being able to
 * wander arbitrarily. Everything else is rejected.
 */
export const SUPPORT_TICKET_WORKFLOWS = {
    standard: {
        statuses: ['open', 'in-progress', 'resolved'],
        transitions: {
            open: ['in-progress', 'resolved'],
            'in-progress': ['open', 'resolved'],
            // Correction path: a resolved ticket can be reopened for more work.
            resolved: ['in-progress']
        }
    },
    delivery: {
        statuses: ['open', 'in_progress', 'resolved', 'closed'],
        transitions: {
            open: ['in_progress', 'resolved', 'closed'],
            in_progress: ['open', 'resolved', 'closed'],
            resolved: ['in_progress', 'closed'],
            // Correction path: a closed ticket reopens into active work.
            closed: ['in_progress']
        }
    }
};

export const getSupportTicketWorkflow = (kind) =>
    SUPPORT_TICKET_WORKFLOWS[kind] || SUPPORT_TICKET_WORKFLOWS.standard;

export const isKnownTicketStatus = (kind, status) =>
    getSupportTicketWorkflow(kind).statuses.includes(String(status || ''));

/**
 * Statuses the admin UI may offer for a ticket currently in `currentStatus`:
 * the current status itself plus every status it may legally move to, in the
 * lifecycle's own order. The UI renders exactly this list, so it can never
 * offer a move the backend would reject.
 */
export const getAllowedTicketTransitions = (kind, currentStatus) => {
    const workflow = getSupportTicketWorkflow(kind);
    const current = String(currentStatus || '');
    const reachable = workflow.transitions[current] || [];
    const allowed = new Set([current, ...reachable]);
    return workflow.statuses.filter((status) => allowed.has(status));
};

export const canTransitionTicketStatus = (kind, currentStatus, nextStatus) => {
    const current = String(currentStatus || '');
    const next = String(nextStatus || '');
    if (!isKnownTicketStatus(kind, next)) return false;
    // Re-submitting the current status is a no-op, not an invalid move.
    if (current === next) return true;
    return (getSupportTicketWorkflow(kind).transitions[current] || []).includes(next);
};

/**
 * Throws a 400 ValidationError when the move is not part of the lifecycle.
 * This is the authoritative gate — the UI mirrors it, but never replaces it.
 */
export const assertTicketStatusTransition = (kind, currentStatus, nextStatus) => {
    const current = String(currentStatus || '');
    const next = String(nextStatus || '');

    if (!isKnownTicketStatus(kind, next)) {
        throw new ValidationError(`Unknown support ticket status: ${next}`);
    }
    if (!canTransitionTicketStatus(kind, current, next)) {
        const allowed = getAllowedTicketTransitions(kind, current).filter((s) => s !== current);
        throw new ValidationError(
            allowed.length
                ? `Cannot move a ticket from "${current}" to "${next}". Allowed next statuses: ${allowed.join(', ')}.`
                : `A ticket in "${current}" cannot change status.`
        );
    }
};
