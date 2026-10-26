import InlineCode from "@/components/InlineCode";
import { useAdminPerms } from "@/hooks/auth";
import { useRef, useState } from "react";
import { ApiAddLegacyBanReqSchema, GetBanTemplatesSuccessResp, SaveBanTemplatesReq } from "@shared/otherTypes";
import { useBackendApi } from "@/hooks/fetch";
import { GavelIcon, Loader2Icon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import BanForm, { BanFormType } from "@/components/BanForm";
import { txToast } from "@/components/TxToaster";
import { GenericApiOkResp } from "@shared/genericApiTypes";
import useSWR from "swr";


export default function AddLegacyBanPage() {
    const idsTextareaRef = useRef<HTMLTextAreaElement>(null);
    const banFormRef = useRef<BanFormType>(null);
    const [isSaving, setIsSaving] = useState(false);
    const { hasPerm } = useAdminPerms();

    const getBanTemplatesApi = useBackendApi<GetBanTemplatesSuccessResp>({
        method: 'GET',
        path: `/settings/banTemplates`,
        throwGenericErrors: true,
    });

    const legacyBanApi = useBackendApi<GenericApiOkResp, ApiAddLegacyBanReqSchema>({
        method: 'POST',
        path: `/history/addLegacyBan`,
        throwGenericErrors: true,
    });


    const handleSave = () => {
        if (!idsTextareaRef.current || !banFormRef.current) return;
        const { reason, duration } = banFormRef.current.getData();

        if (!reason || reason.length < 3) {
            txToast.warning(`The reason must be at least 3 characters long.`);
            banFormRef.current.focusReason();
            return;
        }
        const rawIds = idsTextareaRef.current.value;
        if (!rawIds) {
            txToast.warning(`You must enter at least one identifier.`);
            idsTextareaRef.current.focus();
            return;
        }
        const identifiers = rawIds
            .toLowerCase()
            .split(/[,;\s\n]+/g)
            .map(id => id.trim())
            .filter(Boolean);
        if (!identifiers.length) {
            txToast.warning(`You must enter at least one valid identifier.`);
            idsTextareaRef.current.focus();
            return;
        }

        setIsSaving(true);
        legacyBanApi({
            data: { identifiers, reason, duration },
            toastLoadingMessage: 'Banning identifiers...',
            genericHandler: {
                successMsg: 'Identifiers banned.',
            },
            finally: () => setIsSaving(false),
            success: (data) => {
                idsTextareaRef.current!.value = '';
                idsTextareaRef.current!.focus();
            },
            error: (error) => {
                idsTextareaRef.current!.focus();
            },
        });
    };

    const swrBanTemplates = useSWR('/settings/banTemplates', async () => {
        const data = await getBanTemplatesApi({});
        if (!data) throw new Error('No data returned');
        return data;
    });

    const canBan = hasPerm('players.ban');
    return (
        <div className="flex flex-col w-full pb-4">
            <PageHeader title="Ban Identifiers" icon={<GavelIcon />} />
            <div className="flex flex-col gap-4 px-2 md:px-0">
                {!canBan && (
                    <Alert variant="warning">
                        <AlertDescription>You need the Player: Ban permission to use this page.</AlertDescription>
                    </Alert>
                )}
                <div className="border bg-card rounded-lg">
                    <div className="grid lg:grid-cols-2 gap-4 p-4">
                        <div className="flex flex-col gap-3">
                            <Label htmlFor="banIdentifiers">
                                Identifiers
                            </Label>
                            <Textarea
                                id="banIdentifiers"
                                ref={idsTextareaRef}
                                className="h-full min-h-32"
                                disabled={isSaving || !canBan}
                                placeholder="discord:xxxx, fivem:xxxx, license:xxxx, steam:xxxx, etc..."
                            />
                        </div>
                        <BanForm
                            ref={banFormRef}
                            banTemplates={swrBanTemplates.data}
                            disabled={isSaving || !canBan}
                        />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t">
                        <p className="text-sm text-muted-foreground">
                            Include a <InlineCode>license</InlineCode> identifier when you can. Bans without one are legacy bans.
                        </p>
                        <div className="flex gap-2 ml-auto">
                            <Button
                                size="sm"
                                variant="outline-muted"
                                disabled={isSaving || !canBan}
                                onClick={() => {
                                    banFormRef.current?.clearData()
                                }}
                            >
                                Clear
                            </Button>
                            <Button
                                size="sm"
                                variant="destructive"
                                disabled={isSaving || !canBan}
                                onClick={handleSave}
                            >
                                {isSaving ? (
                                    <span className="flex items-center leading-relaxed">
                                        <Loader2Icon className="inline animate-spin h-4" /> Banning...
                                    </span>
                                ) : 'Apply Ban'}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
