import { UpdateDataType } from '@shared/otherTypes';
import { UpdateAvailableEventType } from '@shared/socketioTypes';
import { atom, useAtom, useSetAtom } from 'jotai';


/**
 * Atoms
 */
const fxUpdateDataAtom = atom<UpdateDataType>(window.txConsts.fxsOutdated);
const txUpdateDataAtom = atom<UpdateDataType>(window.txConsts.txaOutdated);


/**
 * Hooks
 */
export default function useWarningBar() {
    const [fxUpdateData, setFxUpdateData] = useAtom(fxUpdateDataAtom);
    const [txUpdateData, setTxUpdateData] = useAtom(txUpdateDataAtom);

    return {
        fxUpdateData, setFxUpdateData,
        txUpdateData, setTxUpdateData,
    };
}

export const useProcessUpdateAvailableEvent = () => {
    const setFxUpdateData = useSetAtom(fxUpdateDataAtom);
    const setTxUpdateData = useSetAtom(txUpdateDataAtom);

    return (event: UpdateAvailableEventType) => {
        setFxUpdateData(event.fxserver);
        setTxUpdateData(event.txadmin);

        //Hacky override to prevent sticky update warnings after updating
        //NOTE: after adding the version check on socket handshake, i'm not sure if this is still required
        window.txConsts.fxsOutdated = event.fxserver;
        window.txConsts.txaOutdated = event.txadmin;
    }
};
