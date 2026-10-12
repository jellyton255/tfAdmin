import { useState } from "react";
import useSWR from "swr";
import { CheckIcon, KeyRoundIcon, Loader2Icon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { startRegistration } from "@simplewebauthn/browser";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { TabsContent } from "@/components/ui/tabs";
import { txToast } from "@/components/TxToaster";
import { useAuth } from "@/hooks/auth";
import { useOpenConfirmDialog } from "@/hooks/dialogs";
import { useAuthedFetcher, useBackendApi } from "@/hooks/fetch";
import { tsToLocaleDateString } from "@/lib/dateTime";
import {
    canUsePasskeys,
    isPasskeyPromptDismissed,
    PasskeyRegisterOptionsResp,
    signalAcceptedPasskeys,
} from "@/lib/passkeys";
import type {
    ApiPasskeyListResp,
    ApiPasskeyRegisterResp,
    ApiPasskeyRemoveReq,
    ApiPasskeyRenameReq,
    PasskeyInfo,
    PasskeyProvider,
} from "@shared/authApiTypes";
import type { GenericApiOkResp } from "@shared/genericApiTypes";

type PasskeyListData = Exclude<ApiPasskeyListResp, { error: string }>;


/**
 * The passkey manager's logo, with a light and a dark variant that follow the panel theme.
 */
function ProviderLogo({ provider }: { provider: PasskeyProvider | null }) {
    if (!provider?.iconLight || !provider.iconDark) {
        return (
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                <KeyRoundIcon className="size-4 text-muted-foreground" />
            </div>
        );
    }
    return (
        <>
            <img src={provider.iconLight} alt={provider.name} title={provider.name} className="size-8 shrink-0 dark:hidden" />
            <img src={provider.iconDark} alt={provider.name} title={provider.name} className="hidden size-8 shrink-0 dark:block" />
        </>
    );
}


function PasskeyRow({ passkey, isCurrent, onRename, onRemove }: {
    passkey: PasskeyInfo;
    isCurrent: boolean;
    onRename: (name: string) => Promise<boolean>;
    onRemove: () => void;
}) {
    const [draftName, setDraftName] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const otherSite = passkey.rpId !== window.location.hostname;

    const saveName = async () => {
        if (draftName === null) return;
        const name = draftName.trim();
        if (!name || name === passkey.name) {
            setDraftName(null);
            return;
        }
        setIsSaving(true);
        const renamed = await onRename(name);
        setIsSaving(false);
        if (renamed) setDraftName(null);
    };

    return (
        <li className="flex items-center gap-3 rounded-md border bg-secondary/20 px-3 py-2">
            <ProviderLogo provider={passkey.provider} />
            <div className="min-w-0 grow">
                {draftName === null ? (
                    <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{passkey.name}</span>
                        {isCurrent && (
                            <Badge variant="outline" className="shrink-0 border-success/30 bg-success/15 text-success">
                                This Session
                            </Badge>
                        )}
                    </div>
                ) : (
                    <form
                        className="flex items-center gap-1"
                        onSubmit={(e) => { e.preventDefault(); saveName(); }}
                    >
                        <Input
                            value={draftName}
                            maxLength={48}
                            autoFocus
                            className="h-7"
                            disabled={isSaving}
                            onChange={(e) => setDraftName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                    e.stopPropagation();
                                    setDraftName(null);
                                }
                            }}
                        />
                        <Button type="submit" size="sm" variant="ghost" className="h-7 px-2" disabled={isSaving} title="Save Name">
                            {isSaving ? <Loader2Icon className="size-4 animate-spin" /> : <CheckIcon className="size-4" />}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" className="h-7 px-2" disabled={isSaving} title="Cancel" onClick={() => setDraftName(null)}>
                            <XIcon className="size-4" />
                        </Button>
                    </form>
                )}
                <div className="flex flex-wrap gap-x-1 text-xs leading-snug text-muted-foreground">
                    {[
                        passkey.provider && passkey.provider.name !== passkey.name ? passkey.provider.name : null,
                        passkey.synced ? 'Synced' : 'This Device Only',
                        passkey.lastUsedAt
                            ? `Last Used ${tsToLocaleDateString(passkey.lastUsedAt, 'medium')}`
                            : `Added ${tsToLocaleDateString(passkey.createdAt, 'medium')}`,
                        otherSite ? passkey.rpId : null,
                    ].filter((part) => part !== null).map((part, index, parts) => (
                        <span key={part} className="whitespace-nowrap">{part}{index < parts.length - 1 && ' ·'}</span>
                    ))}
                </div>
            </div>
            {draftName === null && (
                <div className="flex shrink-0">
                    <Button size="sm" variant="ghost" className="px-2" title="Rename" onClick={() => setDraftName(passkey.name)}>
                        <PencilIcon className="size-4" />
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="px-2 text-destructive hover:text-destructive"
                        title="Remove"
                        onClick={onRemove}
                    >
                        <Trash2Icon className="size-4" />
                    </Button>
                </div>
            )}
        </li>
    );
}


/**
 * Passkeys tab of the account dialog
 */
export default function AccountPasskeysTab() {
    const { logout } = useAuth();
    const authedFetcher = useAuthedFetcher();
    const openConfirmDialog = useOpenConfirmDialog();
    const [isAdding, setIsAdding] = useState(false);
    const [error, setError] = useState('');
    const passkeysUsable = canUsePasskeys();

    const listResp = useSWR<PasskeyListData>(
        '/auth/passkeys',
        async () => {
            const data = await authedFetcher<ApiPasskeyListResp>('/auth/passkeys');
            if ('error' in data) throw new Error(data.error);
            return data;
        },
        {
            revalidateOnFocus: false,
            //Lets the browser's passkey manager drop passkeys this server no longer accepts
            onSuccess: (data) => {
                if (!passkeysUsable || !data.userHandle) return;
                const hostname = window.location.hostname;
                signalAcceptedPasskeys(
                    data.userHandle,
                    data.passkeys.filter((p) => p.rpId === hostname).map((p) => p.id),
                );
            },
        }
    );

    const registerOptionsApi = useBackendApi<PasskeyRegisterOptionsResp>({
        method: 'POST',
        path: '/auth/passkeys/registerOptions',
    });
    const registerApi = useBackendApi<ApiPasskeyRegisterResp>({
        method: 'POST',
        path: '/auth/passkeys/register',
    });
    const renameApi = useBackendApi<GenericApiOkResp, ApiPasskeyRenameReq>({
        method: 'POST',
        path: '/auth/passkeys/rename',
    });
    const removeApi = useBackendApi<GenericApiOkResp, ApiPasskeyRemoveReq>({
        method: 'POST',
        path: '/auth/passkeys/remove',
    });

    const handleAdd = async () => {
        setError('');
        setIsAdding(true);
        try {
            const optionsResp = await registerOptionsApi({ data: {}, error: setError });
            if (!optionsResp) return;
            if ('error' in optionsResp) {
                setError(optionsResp.error);
                return;
            }
            const response = await startRegistration({ optionsJSON: optionsResp.options });
            const resp = await registerApi({ data: { response }, error: setError });
            if (!resp) return;
            if ('error' in resp) {
                setError(resp.error);
                return;
            }
            txToast.success(`Added passkey "${resp.passkey.name}".`);
            listResp.mutate();
        } catch (error) {
            if (isPasskeyPromptDismissed(error)) return;
            setError(error instanceof Error ? error.message : 'Failed to add the passkey.');
        } finally {
            setIsAdding(false);
        }
    };

    const handleRename = async (passkey: PasskeyInfo, name: string) => {
        const resp = await renameApi({ data: { id: passkey.id, name }, error: setError });
        if (!resp) return false;
        if ('error' in resp) {
            setError(resp.error);
            return false;
        }
        listResp.mutate();
        return true;
    };

    const handleRemove = (passkey: PasskeyInfo, isCurrent: boolean) => {
        openConfirmDialog({
            title: `Remove passkey "${passkey.name}"?`,
            message: isCurrent
                ? 'You signed in with this passkey, so removing it will sign you out.'
                : 'Any session started with this passkey will be signed out.',
            actionLabel: 'Remove',
            confirmBtnVariant: 'destructive',
            onConfirm: async () => {
                const resp = await removeApi({
                    data: { id: passkey.id },
                    toastLoadingMessage: 'Removing passkey...',
                    genericHandler: { successMsg: 'Passkey removed.' },
                });
                if (!resp || !('success' in resp)) return;
                if (isCurrent) {
                    logout();
                } else {
                    listResp.mutate();
                }
            },
        });
    };

    const passkeys = listResp.data?.passkeys ?? [];
    return (
        <TabsContent value="passkeys" tabIndex={undefined}>
            {listResp.isLoading ? (
                <div className="flex justify-center py-8">
                    <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
                </div>
            ) : passkeys.length ? (
                <ul className="flex flex-col gap-2 pb-6">
                    {passkeys.map((passkey) => {
                        const isCurrent = passkey.id === listResp.data?.currentPasskeyId;
                        return (
                            <PasskeyRow
                                key={passkey.id}
                                passkey={passkey}
                                isCurrent={isCurrent}
                                onRename={(name) => handleRename(passkey, name)}
                                onRemove={() => handleRemove(passkey, isCurrent)}
                            />
                        );
                    })}
                </ul>
            ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">No Passkeys</p>
            )}

            {!passkeysUsable && (
                <p className="text-sm text-warning-inline text-center -mt-2 mb-4">
                    Open the panel from its domain over HTTPS to add a passkey.
                </p>
            )}
            {(error || listResp.error) && (
                <p className="text-destructive text-center -mt-2 mb-4">{error || listResp.error?.message}</p>
            )}
            <Button
                className="w-full"
                disabled={!passkeysUsable || isAdding}
                onClick={handleAdd}
            >
                {isAdding ? (
                    <Loader2Icon className="mr-2 size-4 animate-spin" />
                ) : (
                    <PlusIcon className="mr-2 size-4" />
                )} Add Passkey
            </Button>
        </TabsContent>
    );
}
