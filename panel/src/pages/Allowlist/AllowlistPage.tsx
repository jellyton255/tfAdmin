import { ListChecksIcon, TriangleAlertIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import TxAnchor from "@/components/TxAnchor";
import { useGlobalStatus } from "@/hooks/status";
import { useAdminPerms } from "@/hooks/auth";
import AllowlistRequestsCard from "./AllowlistRequestsCard";
import AllowlistApprovalsCard from "./AllowlistApprovalsCard";


export default function AllowlistPage() {
    const globalStatus = useGlobalStatus();
    const { hasPerm } = useAdminPerms();
    const canManage = hasPerm('players.whitelist');
    const whitelistMode = globalStatus?.server.whitelist;

    return (
        <div className="flex flex-col h-full w-full gap-4 max-w-screen-2xl mx-auto">
            <PageHeader title="Allowlist" icon={<ListChecksIcon />} />

            {whitelistMode && whitelistMode !== 'approvedLicense' && (
                <Alert variant="warning" className="mx-2 w-auto">
                    <TriangleAlertIcon className="size-4" />
                    <AlertTitle>Server Is Not in Approved License Mode</AlertTitle>
                    <AlertDescription>
                        Changes on this page do not affect who can join while the allowlist is disabled or in another mode.
                        Change it in <TxAnchor href="/settings#allowlist">Settings &gt; Allowlist</TxAnchor>.
                    </AlertDescription>
                </Alert>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 px-2 pb-4 items-start">
                <AllowlistRequestsCard canManage={canManage} />
                <AllowlistApprovalsCard canManage={canManage} />
            </div>
        </div>
    );
}
