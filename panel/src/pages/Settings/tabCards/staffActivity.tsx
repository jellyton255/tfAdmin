import { Input } from "@/components/ui/input"
import { SettingItem, SettingItemDesc } from '../settingsItems'
import { useEffect, useRef, useMemo, useReducer } from "react"
import { getConfigEmptyState, getConfigAccessors, SettingsCardProps, getPageConfig, configsReducer, getConfigDiff } from "../utils"
import SettingsCardShell from "../SettingsCardShell"

//everfall: where the Staff Activity page reads ticket and Discord activity from


export const pageConfigs = {
    ticketsUrl: getPageConfig('staffActivity', 'ticketsUrl'),
    ticketsToken: getPageConfig('staffActivity', 'ticketsToken'),
    discordUrl: getPageConfig('staffActivity', 'discordUrl'),
    discordSecret: getPageConfig('staffActivity', 'discordSecret'),
} as const;

export default function ConfigCardStaffActivity({ cardCtx, pageCtx }: SettingsCardProps) {
    const [states, dispatch] = useReducer(
        configsReducer<typeof pageConfigs>,
        null,
        () => getConfigEmptyState(pageConfigs),
    );
    const cfg = useMemo(() => {
        return getConfigAccessors(cardCtx.cardId, pageConfigs, pageCtx.apiData, dispatch);
    }, [pageCtx.apiData, dispatch]);

    //Effects - handle changes
    useEffect(() => {
        updatePageState();
    }, [states]);

    //Refs for configs that don't use state
    const ticketsUrlRef = useRef<HTMLInputElement | null>(null);
    const ticketsTokenRef = useRef<HTMLInputElement | null>(null);
    const discordUrlRef = useRef<HTMLInputElement | null>(null);
    const discordSecretRef = useRef<HTMLInputElement | null>(null);

    //Marshalling Utils
    const emptyToNull = (str?: string) => {
        if (str === undefined) return undefined;
        const trimmed = str.trim();
        return trimmed.length ? trimmed : null;
    };

    //Processes the state of the page and sets the card as pending save if needed
    const updatePageState = () => {
        const overwrites = {
            ticketsUrl: ticketsUrlRef.current?.value.trim(),
            ticketsToken: emptyToNull(ticketsTokenRef.current?.value),
            discordUrl: discordUrlRef.current?.value.trim(),
            discordSecret: emptyToNull(discordSecretRef.current?.value),
        };

        const res = getConfigDiff(cfg, states, overwrites, false);
        pageCtx.setCardPendingSave(res.hasChanges ? cardCtx : null);
        return res;
    }

    //Trigger the save API
    const handleOnSave = () => {
        const { hasChanges, localConfigs } = updatePageState();
        if (!hasChanges) return;
        pageCtx.saveChanges(cardCtx, localConfigs);
    }

    return (
        <SettingsCardShell
            cardCtx={cardCtx}
            pageCtx={pageCtx}
            onClickSave={handleOnSave}
        >
            <SettingItem label="Tickets API URL" htmlFor={cfg.ticketsUrl.eid}>
                <Input
                    id={cfg.ticketsUrl.eid}
                    ref={ticketsUrlRef}
                    defaultValue={cfg.ticketsUrl.initialValue}
                    onInput={updatePageState}
                    disabled={pageCtx.isReadOnly}
                    placeholder="https://everfallcommunity.com/api/tickets/agent"
                />
            </SettingItem>
            <SettingItem label="Tickets Agent Token" htmlFor={cfg.ticketsToken.eid} showOptional>
                <Input
                    id={cfg.ticketsToken.eid}
                    ref={ticketsTokenRef}
                    defaultValue={cfg.ticketsToken.initialValue}
                    onInput={updatePageState}
                    disabled={pageCtx.isReadOnly}
                    placeholder="efa_..."
                    autoComplete="off"
                    className="blur-input"
                />
                <SettingItemDesc>
                    An agent token with the <strong>staff:read</strong> scope. Leave it blank to hide ticket activity.
                </SettingItemDesc>
            </SettingItem>
            <SettingItem label="EF Bot API URL" htmlFor={cfg.discordUrl.eid}>
                <Input
                    id={cfg.discordUrl.eid}
                    ref={discordUrlRef}
                    defaultValue={cfg.discordUrl.initialValue}
                    onInput={updatePageState}
                    disabled={pageCtx.isReadOnly}
                    placeholder="http://127.0.0.1:46946"
                />
            </SettingItem>
            <SettingItem label="EF Bot Secret" htmlFor={cfg.discordSecret.eid} showOptional>
                <Input
                    id={cfg.discordSecret.eid}
                    ref={discordSecretRef}
                    defaultValue={cfg.discordSecret.initialValue}
                    onInput={updatePageState}
                    disabled={pageCtx.isReadOnly}
                    autoComplete="off"
                    className="blur-input"
                />
                <SettingItemDesc>
                    EF Bot's <strong>STAFF_ACTIVITY_SECRET</strong>. Leave it blank to hide Discord activity.
                </SettingItemDesc>
            </SettingItem>
        </SettingsCardShell>
    )
}
