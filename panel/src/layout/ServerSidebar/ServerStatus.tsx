import { useGlobalStatus } from '@/hooks/status';
import { VariantProps, cva } from 'class-variance-authority';
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DiscordBotStatus, FxMonitorHealth } from '@shared/enums';
import type { ServiceSignal, ServiceSignalState } from '@shared/socketioTypes';
import { msToShortDuration } from '@/lib/dateTime';
import { cn } from '@/lib/utils';


const statusBadgeVariants = cva(
    `rounded-sm text-xs font-semibold px-1 py-[0.125rem] tracking-widest text-center cursor-help`,
    {
        variants: {
            type: {
                default: "bg-secondary text-secondary-foreground",
                destructive: "bg-destructive text-destructive-foreground",
                warning: "bg-warning text-warning-foreground",
                success: "bg-success text-success-foreground",
                info: "bg-info text-info-foreground",
                muted: "bg-muted text-muted-foreground",
            },
        },
        defaultVariants: {
            type: "default",
        },
    }
);
type StatusBadgeTypesVars = VariantProps<typeof statusBadgeVariants>['type'];
type StatusBadgeProps = {
    tooltip?: string | {
        title: string;
        description: string;
    };
    type?: StatusBadgeTypesVars;
    children: React.ReactNode;
};

function StatusBadge({ children, tooltip, type }: StatusBadgeProps) {
    //If no tooltip is provided, just show the text
    if (!tooltip) {
        return <span className={statusBadgeVariants({ type })}>
            {children}
        </span>
    }

    return <Tooltip>
        <TooltipTrigger asChild>
            <span className={statusBadgeVariants({ type })}>
                {children}
            </span>
        </TooltipTrigger>
        <TooltipContent side='right'>
            {typeof tooltip === 'string' ? (
                <p>{tooltip}</p>
            ) : (<>
                <h3>{tooltip.title}</h3>
                <p className={cn(
                    'text-xs tracking-wider text-muted-foreground whitespace-pre-wrap',
                    type === 'warning' && 'text-warning-inline',
                )}>
                    {tooltip.description}
                </p>
            </>)}
        </TooltipContent>
    </Tooltip>
}


const discordStatusMap = {
    [DiscordBotStatus.Disabled]: {
        text: 'DISABLED',
        color: 'default',
        description: 'Discord bot is disabled.',
    },
    [DiscordBotStatus.Starting]: {
        text: 'STARTING',
        color: 'warning',
        description: 'Discord bot is starting.',
    },
    [DiscordBotStatus.Ready]: {
        text: 'READY',
        color: 'default',
        description: 'Discord bot is ready.',
    },
    [DiscordBotStatus.Error]: {
        text: 'ERROR',
        color: 'destructive',
        description: 'Discord bot is in an error state.',
    },
} as const;

const serviceSignalStyles: Record<ServiceSignalState, { dot: string; text: string }> = {
    ok: { dot: 'bg-success', text: 'text-foreground/90' },
    degraded: { dot: 'bg-warning', text: 'text-warning-inline' },
    failing: { dot: 'bg-destructive', text: 'text-destructive-inline' },
    unknown: { dot: 'bg-muted-foreground/40', text: 'text-muted-foreground' },
};

const serviceRows = [
    { key: 'database', label: 'Database' },
    { key: 'logDelivery', label: 'Log Delivery' },
    { key: 'playerSaves', label: 'Player Saves' },
] as const;

//everfall: database, log delivery and save health that the game console no longer prints
function ServiceRow({ label, signal }: { label: string; signal?: ServiceSignal }) {
    const style = serviceSignalStyles[signal?.state ?? 'unknown'];
    const row = (
        <div className={cn('grid grid-cols-[0.5rem_1fr] items-center gap-x-2 gap-y-px', signal?.reason && 'cursor-help')}>
            <span className={cn('size-2 rounded-full', style.dot)} />
            <span className="text-sm text-muted-foreground">{label}</span>
            <span className={cn('col-start-2 text-xs leading-snug text-pretty', style.text)}>
                {signal?.text ?? '--'}
            </span>
        </div>
    );
    if (!signal?.reason) return row;

    return <Tooltip>
        <TooltipTrigger asChild>{row}</TooltipTrigger>
        <TooltipContent side='right'><p>{signal.reason}</p></TooltipContent>
    </Tooltip>
}

export default function ServerStatus() {
    const globalStatus = useGlobalStatus();

    //Preparing status
    let serverHealthText = '--';
    let serverHealthDescTitle = '--';
    let serverHealthDescInfo = '--';
    let serverHealthColor: StatusBadgeTypesVars = 'default';
    let serverUptimeText = '--';
    let serverUptimeDesc = '--';
    let allowlistText = '--';
    let allowlistDesc = '--';
    let allowlistColor: StatusBadgeTypesVars = 'default';
    let discordStatusText = '--';
    let discordStatusDesc = '--';
    let discordStatusColor: StatusBadgeTypesVars = 'default';

    if (globalStatus) {
        //Server uptime
        if (globalStatus.server.uptime > 0) {
            serverUptimeText = msToShortDuration(
                globalStatus.server.uptime,
                {
                    units: ['d', 'h', 'm'],
                    delimiter: ' ',
                }
            );
            serverUptimeDesc = 'Time since the server came online.';
        }

        //Server status
        serverHealthText = globalStatus.server.health;
        serverHealthDescInfo = globalStatus.server.healthReason;
        if (globalStatus.server.health === FxMonitorHealth.ONLINE) {
            serverHealthColor = 'success';
            serverHealthDescTitle = 'Resources running, accepting connections.';
        } else if (globalStatus.server.health === FxMonitorHealth.PARTIAL) {
            serverHealthColor = 'warning';
            serverHealthDescTitle = 'Resources not running or not accepting connections.';
        } else if (globalStatus.server.health === FxMonitorHealth.OFFLINE) {
            serverHealthColor = 'destructive';
            serverHealthDescTitle = 'Server is offline.';
        } else {
            serverHealthColor = 'destructive';
            serverHealthDescTitle = 'Unknown server status.';
        }

        //Allowlist - FIXME:NEXT:UPDATE: rename backend var
        if (globalStatus.server.whitelist === 'disabled') {
            allowlistText = 'DISABLED';
            allowlistDesc = 'Anyone can join.';
        } else if (globalStatus.server.whitelist === 'adminOnly') {
            allowlistText = 'ADMIN';
            allowlistColor = 'warning';
            allowlistDesc = 'Only admins can join.';
        } else if (globalStatus.server.whitelist === 'discordMember') {
            allowlistText = 'MEMBER';
            allowlistDesc = 'Only Discord server members can join.';
        } else if (globalStatus.server.whitelist === 'discordRoles') {
            allowlistText = 'ROLES';
            allowlistDesc = 'Only Discord server members with the specified roles can join.';
        } else if (globalStatus.server.whitelist === 'approvedLicense') {
            allowlistText = 'LICENSE';
            allowlistDesc = 'Only players with an approved license can join.';
        } else if (globalStatus.server.whitelist === 'external') {
            allowlistText = 'EXTERNAL';
            allowlistDesc = 'Player joins are handled by an external resource.';
        }

        //Bot status - too long to show all the text, so just show the code
        if (globalStatus.discord in discordStatusMap) {
            discordStatusText = discordStatusMap[globalStatus.discord].text;
            discordStatusColor = discordStatusMap[globalStatus.discord].color;
            discordStatusDesc = discordStatusMap[globalStatus.discord].description;
        } else {
            discordStatusText = `CODE-${globalStatus.discord}`;
            discordStatusColor = 'destructive';
            discordStatusDesc = 'Unknown status code';
        }
    }

    return (
        <div className="flex flex-col gap-[0.375rem]">
            <div className="flex justify-between items-center text-muted-foreground text-sm gap-1.5">
                Server:
                <StatusBadge
                    tooltip={{
                        title: serverHealthDescTitle,
                        description: serverHealthDescInfo
                    }}
                    type={serverHealthColor}
                >{serverHealthText}</StatusBadge>
            </div>
            <div className="flex justify-between items-center text-muted-foreground text-sm gap-1.5">
                Uptime:
                <StatusBadge
                    tooltip={serverUptimeDesc}
                >{serverUptimeText}</StatusBadge>
            </div>
            <div className="flex justify-between items-center text-muted-foreground text-sm gap-1.5">
                Allowlist:
                <StatusBadge
                    tooltip={allowlistDesc}
                    type={allowlistColor}
                >{allowlistText}</StatusBadge>
            </div>
            <div className="flex justify-between items-center text-muted-foreground text-sm gap-1.5">
                Discord Bot:
                <StatusBadge
                    tooltip={discordStatusDesc}
                    type={discordStatusColor}
                >{discordStatusText}</StatusBadge>
            </div>
            <div className="mt-1.5 flex flex-col gap-2.5 border-t pt-3">
                {serviceRows.map(({ key, label }) => (
                    <ServiceRow key={key} label={label} signal={globalStatus?.services[key]} />
                ))}
            </div>
        </div>
    )
}
