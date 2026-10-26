import { ListChecksIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import TxAnchor from "@/components/TxAnchor";
import { useGlobalStatus } from "@/hooks/status";
import { useAdminPerms } from "@/hooks/auth";
import AllowlistRequestsCard from "./AllowlistRequestsCard";
import AllowlistApprovalsCard, { useAddApproval } from "./AllowlistApprovalsCard";


export default function AllowlistPage() {
    const globalStatus = useGlobalStatus();
    const { hasPerm } = useAdminPerms();
    const canManage = hasPerm('players.whitelist');
    const whitelistMode = globalStatus?.server.whitelist;
    const addApproval = useAddApproval();

    return (
        <div className="flex flex-col w-full gap-4 pb-4 [&>header]:mb-0">
            <PageHeader title="Allowlist" icon={<ListChecksIcon />}>
                {canManage && (
                    <Button size="sm" onClick={addApproval}>
                        <PlusIcon className="size-4 mr-1" /> Add Approval
                    </Button>
                )}
            </PageHeader>

            {whitelistMode && whitelistMode !== 'approvedLicense' && (
                <Alert variant="warning" className="mx-2 md:mx-0 w-auto">
                    <TriangleAlertIcon className="size-4" />
                    <AlertTitle>Server Is Not in Approved License Mode</AlertTitle>
                    <AlertDescription>
                        Changes on this page do not affect who can join while the allowlist is disabled or in another mode.
                        Change it in <TxAnchor href="/settings#allowlist">Settings &gt; Allowlist</TxAnchor>.
                    </AlertDescription>
                </Alert>
            )}

            <div className="flex flex-col gap-4 px-2 md:px-0">
                <AllowlistRequestsCard canManage={canManage} />
                <AllowlistApprovalsCard canManage={canManage} />
            </div>
        </div>
    );
}
