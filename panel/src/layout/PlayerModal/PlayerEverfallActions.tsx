import { useState } from "react";
import { ChevronDownIcon, ZapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { txToast } from "@/components/TxToaster";
import { useOpenPromptDialog } from "@/hooks/dialogs";
import { useEverfallPermissions, useEverfallRequest } from "@/hooks/everfall";
import type { EverfallPlayerScreenshot } from "@shared/everfallApiTypes";
import type { PlayerModalPlayerData } from "@shared/playerApiTypes";

type Action = {
    label: string;
    operation: string;
    permission: string;
    done: string;
    payload?: Record<string, unknown>;
};

const stateActions: Action[] = [
    { label: 'Revive', operation: 'player.revive', permission: 'PlayerState', done: 'Player revived.' },
    { label: 'Heal', operation: 'player.heal', permission: 'PlayerState', done: 'Player healed.' },
    { label: 'Feed', operation: 'player.feed', permission: 'PlayerState', done: 'Hunger and thirst restored.' },
    { label: 'Relieve Stress', operation: 'player.relieveStress', permission: 'PlayerState', done: 'Stress relieved.' },
    { label: 'Clear Effects', operation: 'player.clearEffects', permission: 'PlayerState', done: 'Effects cleared.' },
];
const freezeActions: Action[] = [
    { label: 'Freeze', operation: 'player.freeze', permission: 'Teleport', done: 'Player frozen.', payload: { frozen: true } },
    { label: 'Unfreeze', operation: 'player.freeze', permission: 'Teleport', done: 'Player unfrozen.', payload: { frozen: false } },
];
const itemPattern = /^(\S+)(?:\s+(\d+))?$/;

type PlayerEverfallActionsProps = {
    player: PlayerModalPlayerData & { netid: number; license: string };
};

/**
 * Everfall: ef_administration's live actions for a connected player, offered by the admin's
 * Everfall staff rank. Teleports and vehicle spawns stay in game.
 */
export default function PlayerEverfallActions({ player }: PlayerEverfallActionsProps) {
    const { can } = useEverfallPermissions();
    const everfallRequest = useEverfallRequest();
    const openPromptDialog = useOpenPromptDialog();
    const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
    const target = { serverId: player.netid, license: player.license };

    async function run<Data>(operation: string, payload: Record<string, unknown>, loading: string, done: string) {
        const toastId = txToast.loading(loading);
        try {
            const data = await everfallRequest<Data>(operation, { ...target, ...payload });
            txToast.success(done, { id: toastId });
            return data;
        } catch (error) {
            txToast.error(error instanceof Error ? error.message : String(error), { id: toastId });
        }
    }

    function handleGiveItem() {
        openPromptDialog({
            title: `Give Item to ${player.displayName}`,
            message: 'Type the item name, then the quantity if more than one.',
            placeholder: 'water 5',
            submitLabel: 'Give',
            required: true,
            onSubmit: (input) => {
                const match = itemPattern.exec(input.trim());
                if (!match) {
                    txToast.warning('Type the item name, then an optional quantity.');
                    return;
                }
                const amount = match[2] ? Number(match[2]) : 1;
                run('player.giveItem', { item: match[1], amount }, 'Giving item...', `Gave ${amount}x ${match[1]}.`);
            },
        });
    }

    function handleSetModel() {
        openPromptDialog({
            title: `Set Model for ${player.displayName}`,
            placeholder: 'mp_m_freemode_01',
            submitLabel: 'Set Model',
            required: true,
            onSubmit: (input) => {
                run('player.setModel', { model: input.trim() }, 'Setting model...', 'Model set.');
            },
        });
    }

    async function handleScreenshot() {
        const data = await run<EverfallPlayerScreenshot>('player.screenshot', {}, 'Taking screenshot...', 'Screenshot taken.');
        if (data) setScreenshotUrl(data.url);
    }

    function actionItem(action: Action) {
        return (
            <DropdownMenuItem
                key={action.label}
                className="cursor-pointer"
                onClick={() => run(action.operation, action.payload ?? {}, `${action.label}...`, action.done)}
            >
                {action.label}
            </DropdownMenuItem>
        );
    }

    const sections = [
        [
            ...stateActions.filter((action) => can(action.permission)).map(actionItem),
            can('PlayerState') && <DropdownMenuItem key="model" className="cursor-pointer" onClick={handleSetModel}>Set Model</DropdownMenuItem>,
        ],
        freezeActions.filter((action) => can(action.permission)).map(actionItem),
        [
            can('SpawnItemsVehicles') && <DropdownMenuItem key="item" className="cursor-pointer" onClick={handleGiveItem}>Give Item</DropdownMenuItem>,
            can('Punishments') && <DropdownMenuItem key="screenshot" className="cursor-pointer" onClick={handleScreenshot}>Take Screenshot</DropdownMenuItem>,
        ],
    ].map((items) => items.filter(Boolean)).filter((items) => items.length > 0);
    if (!sections.length) return null;

    return (<>
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant='outline' size='sm' className="pl-2">
                    <ZapIcon className="h-5 mr-1" /> Player Actions <ChevronDownIcon className="h-4 ml-1 opacity-60" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
                {sections.map((items, index) => [
                    index > 0 && <DropdownMenuSeparator key={`separator-${index}`} />,
                    ...items,
                ])}
            </DropdownMenuContent>
        </DropdownMenu>

        <Dialog open={screenshotUrl !== null} onOpenChange={(open) => !open && setScreenshotUrl(null)}>
            <DialogContent className="max-w-5xl">
                <DialogHeader>
                    <DialogTitle>Screenshot of {player.displayName}</DialogTitle>
                </DialogHeader>
                {screenshotUrl && (
                    <a href={screenshotUrl} target="_blank" rel="noopener noreferrer">
                        <img src={screenshotUrl} alt={`Screenshot of ${player.displayName}`} className="w-full rounded-md border" />
                    </a>
                )}
            </DialogContent>
        </Dialog>
    </>);
}
