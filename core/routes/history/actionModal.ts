const modulename = 'WebServer:HistoryActionModal';
import consoleFactory from '@lib/console';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
import { HistoryActionModalResp } from '@shared/historyApiTypes';
import { now } from '@lib/misc';
import { visibleNotes } from '@lib/notes';
const console = consoleFactory(modulename);


/**
 *  Returns the history action modal data
 */
export default async function HistoryActionModal(ctx: AuthedCtx) {
    //Sanity check
    if (typeof ctx.query === 'undefined') {
        return ctx.utils.error(400, 'Invalid Request');
    }
    const { id: actionId } = ctx.query;
    const sendTypedResp = (data: HistoryActionModalResp) => ctx.send(data);

    //Checking action id
    if (typeof actionId !== 'string' || !actionId.length) {
        return sendTypedResp({ error: 'Invalid action ID.' });
    }

    //Getting the action data
    let actionData;
    try {
        actionData = txCore.database.actions.findOne(actionId)
        if (!actionData) return sendTypedResp({ error: 'Action not found' });
    } catch (error) {
        return sendTypedResp({ error: `Getting history action failed with error: ${(error as Error).message}` });
    }

    //Deleted notes are only shown to admins who can manage everyone's notes
    const notes = visibleNotes(actionData.notes, ctx.admin.hasPermission('manage.admins'));
    actionData.notes = notes.length ? notes : undefined;

    //Sending the data
    return sendTypedResp({
        serverTime: now(),
        action: actionData,
    });
};
