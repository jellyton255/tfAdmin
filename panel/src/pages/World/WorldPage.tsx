import { useState } from "react";
import { CloudSunIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useOpenConfirmDialog } from "@/hooks/dialogs";
import { useEverfallAction, useEverfallPermissions, useEverfallQuery } from "@/hooks/everfall";
import AllowlistSection from "@/pages/Allowlist/AllowlistSection";

/** Answer of `world.state`: ef_atmos' weather and time. */
type WorldState = {
    weather: string;
    weatherTypes: string[];
    hour: number;
    minute: number;
    freezeTime: boolean;
    freezeWeather: boolean;
    blackout: boolean;
};
type WorldToggle = 'freezeTime' | 'freezeWeather' | 'blackout';

const WEATHER_LABELS: Record<string, string> = {
    EXTRASUNNY: 'Extra Sunny',
    SNOWLIGHT: 'Light Snow',
    XMAS: 'Christmas',
};
const TOGGLES: { setting: WorldToggle; label: string }[] = [
    { setting: 'freezeTime', label: 'Freeze Time' },
    { setting: 'freezeWeather', label: 'Freeze Weather' },
    { setting: 'blackout', label: 'Blackout' },
];

function weatherLabel(weather: string) {
    return WEATHER_LABELS[weather] ?? weather.charAt(0) + weather.slice(1).toLowerCase();
}

function padTime(value: number) {
    return String(value).padStart(2, '0');
}

function WorldRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
            <span className="text-sm font-medium">{label}</span>
            <div className="flex items-center gap-2">{children}</div>
        </div>
    );
}

//Keyed on the server time, so a new reading replaces the draft
function TimeRow({ state, onSet }: { state: WorldState; onSet: (hour: number, minute: number) => void }) {
    const [draft, setDraft] = useState(`${padTime(state.hour)}:${padTime(state.minute)}`);
    const [hour, minute] = draft.split(':').map(Number);
    return (
        <WorldRow label="Time">
            <Input type="time" className="w-32 h-8" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <Button size="sm" variant="outline" disabled={!draft} onClick={() => onSet(hour, minute)}>
                Set Time
            </Button>
        </WorldRow>
    );
}

function AtmosphereSection() {
    const { can, isLoading: isLoadingPerms } = useEverfallPermissions();
    const canWeather = can('Weather');
    const query = useEverfallQuery<WorldState>(canWeather ? 'world.state' : null);
    const everfallAction = useEverfallAction();
    const state = query.data;

    const change = async (operation: string, payload: Record<string, unknown>, success: string) => {
        const data = await everfallAction<{ state: WorldState }>(operation, payload, { loading: 'Updating...', success });
        if (data) query.mutate(data.state, { revalidate: false });
    };

    return (
        <AllowlistSection
            title="Weather and Time"
            error={query.error}
            isLoading={isLoadingPerms || (canWeather && !state)}
            emptyMessage={canWeather ? null : 'Your staff rank does not include Weather.'}
        >
            {state && (<>
                <WorldRow label="Weather">
                    <Select
                        value={state.weather}
                        onValueChange={(weather) => change('world.setWeather', { weather }, `Weather set to ${weatherLabel(weather)}.`)}
                    >
                        <SelectTrigger className="w-40 h-8">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {state.weatherTypes.map((weather) => (
                                <SelectItem key={weather} value={weather} className="cursor-pointer">
                                    {weatherLabel(weather)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </WorldRow>
                <TimeRow
                    key={`${state.hour}:${state.minute}`}
                    state={state}
                    onSet={(hour, minute) => change('world.setTime', { hour, minute }, 'Time change started.')}
                />
                {TOGGLES.map(({ setting, label }) => (
                    <WorldRow key={setting} label={label}>
                        <Switch
                            checked={state[setting]}
                            onCheckedChange={(enabled) => change(
                                'world.toggle',
                                { setting, enabled },
                                `${label} turned ${enabled ? 'on' : 'off'}.`,
                            )}
                        />
                    </WorldRow>
                ))}
            </>)}
        </AllowlistSection>
    );
}

function PlayersSection() {
    const { can, isLoading } = useEverfallPermissions();
    const openConfirmDialog = useOpenConfirmDialog();
    const everfallAction = useEverfallAction();

    const handleHealAll = () => openConfirmDialog({
        title: 'Heal All Players?',
        message: 'Every player with a loaded character will be revived.',
        actionLabel: 'Heal All',
        onConfirm: async () => {
            await everfallAction<{ revived: number }>('world.healAll', {}, {
                loading: 'Reviving players...',
                success: 'Everyone was revived.',
            });
        },
    });

    return (
        <AllowlistSection
            title="Players"
            isLoading={isLoading}
            emptyMessage={can('PlayerState') ? null : 'Your staff rank does not include Player State.'}
        >
            <WorldRow label="Heal All">
                <Button size="sm" variant="outline" onClick={handleHealAll}>Heal All</Button>
            </WorldRow>
        </AllowlistSection>
    );
}

export default function WorldPage() {
    return (
        <div className="flex flex-col w-full gap-4 pb-4 [&>header]:mb-0">
            <PageHeader title="World" icon={<CloudSunIcon />} />
            <div className="flex flex-col gap-4 px-2 md:px-0">
                <AtmosphereSection />
                <PlayersSection />
            </div>
        </div>
    );
}
