import { useId, useState, type ReactNode } from "react";
import useSWR, { useSWRConfig } from "swr";
import { z } from "zod";
import { ChevronDownIcon } from "lucide-react";
import { useAuthedFetcher } from "@/hooks/fetch";
import { useEverfallQuery, useEverfallRequest } from "@/hooks/everfall";
import { txToast } from "@/components/TxToaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PlayerCharacter, PlayerCharacterDetailResp } from "@shared/playerApiTypes";
import type { EverfallCharacterActionResult, EverfallCharacterSection } from "@shared/everfallApiTypes";


/*
 * Staff changes to a character, sent as ef_administration character actions (character.action).
 * The payloads follow the game's preparers in modules/tickets/sv_ticket_character_actions.lua, and
 * the limits mirror the website's character-admin-contracts.ts; the game checks both again.
 */

type MenuKind =
    | 'setMoney' | 'setGroupGrade' | 'updateGroup' | 'editIdentity'
    | 'giveItem' | 'removeItem'
    | 'giveVehicle' | 'editVehicle' | 'transferVehicle' | 'bulkVehicles'
    | 'editState' | 'revive' | 'clothingMenu' | 'characterMenu'
    | 'editMetadata' | 'repairSlot' | 'deleteCharacter';

/** An open action dialog. Progression edits open from a row of the Progression section. */
export type OpenCharacterAction =
    | { kind: MenuKind }
    | { kind: 'editProgression'; adapterId: ProgressionSource; row: Record<string, unknown> };

type MenuEntry = {
    kind: MenuKind;
    label: string;
    permission: string;
    when?: (character: PlayerCharacter) => boolean;
};

// ef_administration's permission for each kind (permissionByKind in sv_ticket_character_actions.lua).
const menuGroups: MenuEntry[][] = [
    [
        { kind: 'setMoney', label: 'Set Money', permission: 'EditCharacterMoney' },
        { kind: 'setGroupGrade', label: 'Set Job or Gang Grade', permission: 'EditCharacterGroups' },
        { kind: 'updateGroup', label: 'Remove or Make Primary', permission: 'EditCharacterGroups' },
        { kind: 'editIdentity', label: 'Edit Identity', permission: 'EditCharacterIdentity' },
    ],
    [
        { kind: 'giveItem', label: 'Give Item', permission: 'EditCharacterInventory' },
        { kind: 'removeItem', label: 'Remove Item', permission: 'EditCharacterInventory' },
    ],
    [
        { kind: 'giveVehicle', label: 'Give Vehicle', permission: 'EditCharacterVehicles' },
        { kind: 'editVehicle', label: 'Edit Vehicle', permission: 'EditCharacterVehicles' },
        { kind: 'transferVehicle', label: 'Transfer Vehicle', permission: 'TransferCharacterVehicleOwnership' },
        { kind: 'bulkVehicles', label: 'Move All Vehicles', permission: 'EditCharacterVehicles' },
    ],
    [
        { kind: 'editState', label: 'Edit Condition', permission: 'EditCharacterState' },
        { kind: 'revive', label: 'Revive', permission: 'EditCharacterState', when: (character) => character.online },
        { kind: 'clothingMenu', label: 'Give Clothing Menu', permission: 'EditCharacterState', when: (character) => character.online },
        { kind: 'characterMenu', label: 'Give Character Menu', permission: 'EditCharacterState', when: (character) => character.online },
    ],
    [
        { kind: 'editMetadata', label: 'Edit Raw Metadata', permission: 'EditCharacterRawMetadata' },
        { kind: 'repairSlot', label: 'Change Slot', permission: 'RepairCharacterSlot', when: (character) => !character.online },
        { kind: 'deleteCharacter', label: 'Delete Character', permission: 'DeleteCharacter' },
    ],
];

export function CharacterActionsMenu({ character, can, onSelect }: {
    character: PlayerCharacter;
    can: (permission: string) => boolean;
    onSelect: (action: OpenCharacterAction) => void;
}) {
    const groups = menuGroups
        .map((group) => group.filter((entry) => can(entry.permission) && (!entry.when || entry.when(character))))
        .filter((group) => group.length);
    if (!groups.length) return null;

    // Not modal: a modal menu that opens a dialog leaves the page unclickable after both close.
    return (
        <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline-muted" className="shrink-0 gap-1.5">
                    Actions <ChevronDownIcon className="size-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                {groups.map((group, index) => [
                    index > 0 && <DropdownMenuSeparator key={`separator-${index}`} />,
                    ...group.map((entry) => (
                        <DropdownMenuItem
                            key={entry.kind}
                            onSelect={() => onSelect({ kind: entry.kind })}
                            className={entry.kind === 'deleteCharacter' ? 'text-destructive-inline' : undefined}
                        >
                            {entry.label}
                        </DropdownMenuItem>
                    )),
                ])}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}


// =============================================
// Validation shared by the forms
// =============================================

const reasonSchema = z.string().trim()
    .min(4, 'Give a reason of at least 4 characters.')
    .max(240, 'Keep the reason within 240 characters.');

/** A text field that must hold a whole number within the game's limits. */
function wholeNumber(name: string, min: number, max: number) {
    return z.string().trim().min(1, `Enter the ${name}.`).pipe(
        z.coerce.number()
            .int(`Enter a whole number for ${name}.`)
            .min(min, `The ${name} must be at least ${min.toLocaleString('en-US')}.`)
            .max(max, `The ${name} must be at most ${max.toLocaleString('en-US')}.`)
    );
}

const moneyMax = 1_000_000_000_000;
const groupNameSchema = z.string().trim().min(1, 'Enter the job or gang name.').max(50)
    .regex(/^[A-Za-z0-9_-]+$/, 'Use the exact job or gang name.');
const itemNameSchema = z.string().trim().min(1, 'Enter the item name.').max(64)
    .regex(/^[A-Za-z0-9_.-]+$/, 'Use the exact item name.');
const namePartSchema = z.string().trim().min(1, 'Enter a name.').max(30, 'Keep names within 30 characters.')
    // eslint-disable-next-line no-control-regex
    .regex(/^[^\u0000-\u001f\u007f]*$/, 'Names cannot contain control characters.');

function pick<T extends string>(options: readonly T[], value: string) {
    return options.find((option) => option === value);
}

const numberFormatter = new Intl.NumberFormat('en-US');
const moneyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });


// =============================================
// Form building blocks
// =============================================

type CharacterActionPayload = { kind: string } & Record<string, unknown>;

function isCharacterKey(key: unknown, citizenId: string) {
    if (typeof key === 'string') return key.startsWith('/player/character');
    if (typeof key !== 'object' || key === null || !('payload' in key)) return false;
    const payload = key.payload;
    return typeof payload === 'object' && payload !== null && 'citizenId' in payload && payload.citizenId === citizenId;
}

/** Sends one character action, then toasts the game's answer and reloads what it changed. */
function useCharacterAction(citizenId: string, onDone: () => void) {
    const everfallRequest = useEverfallRequest();
    const { mutate } = useSWRConfig();
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function submit(characterAction: CharacterActionPayload, reason: string) {
        setPending(true);
        setError(null);
        try {
            const result = await everfallRequest<EverfallCharacterActionResult>('character.action', {
                citizenId,
                reason,
                characterAction,
            });
            txToast.success(result.message);
            onDone();
            mutate((key) => isCharacterKey(key, citizenId));
        } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : String(requestError));
        } finally {
            setPending(false);
        }
    }

    return { submit, pending, error, setError };
}

type ActionApi = ReturnType<typeof useCharacterAction>;

/** Parses the form, showing the first problem, and sends the action when it is valid. */
function submitParsed<Schema extends z.ZodTypeAny>(
    action: ActionApi,
    schema: Schema,
    values: unknown,
    build: (parsed: z.infer<Schema>) => CharacterActionPayload,
) {
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
        action.setError(parsed.error.issues[0]?.message ?? 'Check the form.');
        return;
    }
    action.submit(build(parsed.data), parsed.data.reason);
}

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
    const id = useId();
    return (
        <div className="flex flex-col space-y-1.5">
            <Label htmlFor={id}>{label}</Label>
            {children(id)}
        </div>
    );
}

function ChoiceField({ label, value, onValueChange, options, placeholder }: {
    label: string;
    value: string;
    onValueChange: (value: string) => void;
    options: readonly { value: string; label: string }[];
    placeholder?: string;
}) {
    return (
        <Field label={label}>
            {(id) => (
                <Select value={value} onValueChange={onValueChange}>
                    <SelectTrigger id={id}>
                        <SelectValue placeholder={placeholder} />
                    </SelectTrigger>
                    <SelectContent>
                        {options.map((option) => (
                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            )}
        </Field>
    );
}

function TextField({ label, value, onValueChange, ...props }: {
    label: string;
    value: string;
    onValueChange: (value: string) => void;
} & Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'id'>) {
    return (
        <Field label={label}>
            {(id) => <Input id={id} autoComplete="off" value={value} onChange={(event) => onValueChange(event.target.value)} {...props} />}
        </Field>
    );
}

function ActionForm({ title, submitLabel, destructive, action, reason, onReasonChange, onSubmit, children }: {
    title: string;
    submitLabel: string;
    destructive?: boolean;
    action: ActionApi;
    reason: string;
    onReasonChange: (reason: string) => void;
    onSubmit: () => void;
    children?: ReactNode;
}) {
    const reasonId = useId();
    function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!action.pending) onSubmit();
    }
    return (
        <form onSubmit={handleSubmit} className="grid gap-4">
            <DialogHeader>
                <DialogTitle>{title}</DialogTitle>
            </DialogHeader>
            {children}
            <div className="flex flex-col space-y-1.5">
                <Label htmlFor={reasonId}>Reason</Label>
                <Textarea
                    id={reasonId}
                    rows={2}
                    maxLength={240}
                    value={reason}
                    onChange={(event) => onReasonChange(event.target.value)}
                />
            </div>
            {action.error && <p className="text-sm text-destructive-inline">{action.error}</p>}
            <DialogFooter>
                <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={action.pending}>
                    {action.pending ? 'Working...' : submitLabel}
                </Button>
            </DialogFooter>
        </form>
    );
}

type FormProps = { character: PlayerCharacter; action: ActionApi };

/** Local form state with one setter per field. */
function useFormValues<Values extends Record<string, string>>(initial: Values) {
    const [values, setValues] = useState(initial);
    function set(key: keyof Values) {
        return (value: string) => setValues((current) => ({ ...current, [key]: value }));
    }
    return { values, set, setValues };
}


// =============================================
// Character reads the forms choose from
// =============================================

function useCharacterSection(citizenId: string, section: 'groups' | 'vehicles') {
    const query = useEverfallQuery<EverfallCharacterSection>('character.section', { citizenId, section, page: 1 });
    const source = query.data?.adapters.find((adapter) => adapter.id === (section === 'groups' ? 'group-memberships' : 'vehicles'));
    return { rows: source && Array.isArray(source.rows) ? source.rows : [], loading: !query.data && !query.error };
}

function text(value: unknown) {
    return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

type CharacterVehicle = { id: number; plate: string; model: string; garage: string; state: number; depotPrice: number };

function useCharacterVehicles(citizenId: string) {
    const { rows, loading } = useCharacterSection(citizenId, 'vehicles');
    const vehicles: CharacterVehicle[] = rows.flatMap((row) => typeof row.id === 'number' ? [{
        id: row.id,
        plate: text(row.plate),
        model: text(row.vehicle),
        garage: text(row.garage),
        state: typeof row.state === 'number' ? row.state : 1,
        depotPrice: typeof row.depotPrice === 'number' ? row.depotPrice : 0,
    }] : []);
    return { vehicles, loading };
}

function vehicleOptions(vehicles: CharacterVehicle[]) {
    return vehicles.map((vehicle) => ({ value: String(vehicle.id), label: `${vehicle.plate} · ${vehicle.model}` }));
}


// =============================================
// The forms
// =============================================

const moneyTypes = ['cash', 'bank', 'cosmo'] as const;

function SetMoneyForm({ character, action }: FormProps) {
    const { values, set } = useFormValues({ moneyType: 'bank', amount: '', reason: '' });
    const schema = z.object({ moneyType: z.enum(moneyTypes), amount: wholeNumber('amount', 0, moneyMax), reason: reasonSchema });
    const balance = (value: number | null) => value === null ? '' : ` (${moneyFormatter.format(value)})`;
    return (
        <ActionForm
            title="Set Money"
            submitLabel="Set Balance"
            action={action}
            reason={values.reason}
            onReasonChange={set('reason')}
            onSubmit={() => submitParsed(action, schema, values, (parsed) => ({
                kind: 'setMoney', moneyType: parsed.moneyType, amount: parsed.amount,
            }))}
        >
            <ChoiceField
                label="Account"
                value={values.moneyType}
                onValueChange={set('moneyType')}
                options={[
                    { value: 'cash', label: `Cash${balance(character.cash)}` },
                    { value: 'bank', label: `Bank${balance(character.bank)}` },
                    { value: 'cosmo', label: 'Cosmo' },
                ]}
            />
            <TextField label="New Balance" inputMode="numeric" value={values.amount} onValueChange={set('amount')} />
        </ActionForm>
    );
}

const groupTypeOptions = [{ value: 'job', label: 'Job' }, { value: 'gang', label: 'Gang' }];

function SetGroupGradeForm({ action }: FormProps) {
    const { values, set } = useFormValues({ groupType: 'job', group: '', grade: '', reason: '' });
    const schema = z.object({
        groupType: z.enum(['job', 'gang']),
        group: groupNameSchema,
        grade: wholeNumber('grade', 0, 100),
        reason: reasonSchema,
    });
    return (
        <ActionForm
            title="Set Job or Gang Grade"
            submitLabel="Set Grade"
            action={action}
            reason={values.reason}
            onReasonChange={set('reason')}
            onSubmit={() => submitParsed(action, schema, values, (parsed) => ({
                kind: 'setGroupGrade', groupType: parsed.groupType, group: parsed.group, grade: parsed.grade,
            }))}
        >
            <ChoiceField label="Type" value={values.groupType} onValueChange={set('groupType')} options={groupTypeOptions} />
            <TextField label="Name" placeholder="police" value={values.group} onValueChange={set('group')} />
            <TextField label="Grade" inputMode="numeric" value={values.grade} onValueChange={set('grade')} />
        </ActionForm>
    );
}

function UpdateGroupForm({ character, action }: FormProps) {
    const { values, set } = useFormValues({ membership: '', operation: 'remove', reason: '' });
    const { rows, loading } = useCharacterSection(character.citizenId, 'groups');
    const memberships = rows.flatMap((row) => {
        const type = pick(['job', 'gang'], text(row.type));
        const group = text(row.group);
        return type && group ? [{ value: `${type}:${group}`, label: `${group} (${type === 'job' ? 'Job' : 'Gang'}) · Grade ${text(row.grade)}` }] : [];
    });
    const schema = z.object({
        membership: z.string().regex(/^(job|gang):[A-Za-z0-9_-]+$/, 'Choose a job or gang.'),
        operation: z.enum(['remove', 'primary']),
        reason: reasonSchema,
    });
    return (
        <ActionForm
            title="Remove or Make Primary"
            submitLabel={values.operation === 'remove' ? 'Remove' : 'Make Primary'}
            destructive={values.operation === 'remove'}
            action={action}
            reason={values.reason}
            onReasonChange={set('reason')}
            onSubmit={() => submitParsed(action, schema, values, (parsed) => {
                const [groupType, group] = parsed.membership.split(':');
                return { kind: 'updateGroup', groupType, group, operation: parsed.operation };
            })}
        >
            <ChoiceField
                label="Job or Gang"
                value={values.membership}
                onValueChange={set('membership')}
                options={memberships}
                placeholder={loading ? 'Loading...' : memberships.length ? 'Choose a job or gang' : 'No jobs or gangs'}
            />
            <ChoiceField
                label="Change"
                value={values.operation}
                onValueChange={set('operation')}
                options={[{ value: 'remove', label: 'Remove' }, { value: 'primary', label: 'Make Primary' }]}
            />
        </ActionForm>
    );
}

function EditIdentityForm({ character, action }: FormProps) {
    const { values, set } = useFormValues({
        firstName: character.firstName ?? '',
        lastName: character.lastName ?? '',
        dateOfBirth: character.dateOfBirth ?? '',
        gender: character.gender === null ? '' : String(character.gender),
        reason: '',
    });
    const schema = z.object({
        firstName: namePartSchema,
        lastName: namePartSchema,
        dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date of birth.'),
        gender: z.enum(['0', '1'], { errorMap: () => ({ message: 'Choose a gender.' }) }),
        reason: reasonSchema,
    });
    return (
        <ActionForm
            title="Edit Identity"
            submitLabel="Save Identity"
            action={action}
            reason={values.reason}
            onReasonChange={set('reason')}
            onSubmit={() => submitParsed(action, schema, values, (parsed) => ({
                kind: 'editIdentity',
                firstName: parsed.firstName,
                lastName: parsed.lastName,
                dateOfBirth: parsed.dateOfBirth,
                gender: Number(parsed.gender),
            }))}
        >
            <div className="grid grid-cols-2 gap-4">
                <TextField label="First Name" maxLength={30} value={values.firstName} onValueChange={set('firstName')} />
                <TextField label="Last Name" maxLength={30} value={values.lastName} onValueChange={set('lastName')} />
            </div>
            <div className="grid grid-cols-2 gap-4">
                <TextField label="Date of Birth" type="date" value={values.dateOfBirth} onValueChange={set('dateOfBirth')} />
                <ChoiceField
                    label="Gender"
                    value={values.gender}
                    onValueChange={set('gender')}
                    options={[{ value: '0', label: 'Male' }, { value: '1', label: 'Female' }]}
                    placeholder="Choose"
                />
            </div>
        </ActionForm>
    );
}

function GiveItemForm({ character, action }: FormProps) {
    const { values, set } = useFormValues({
        name: '',
        count: '1',
        destination: character.online ? 'inventory' : 'postOffice',
        reason: '',
    });
    const schema = z.object({
        name: itemNameSchema,
        count: wholeNumber('count', 1, 1000),
        destination: z.enum(['inventory', 'postOffice']),
        reason: reasonSchema,
    });
    return (
        <ActionForm
            title="Give Item"
            submitLabel="Give Item"
            action={action}
            reason={values.reason}
            onReasonChange={set('reason')}
            onSubmit={() => submitParsed(action, schema, values, (parsed) => ({
                kind: 'giveItem', item: { name: parsed.name, count: parsed.count }, destination: parsed.destination,
            }))}
        >
            <div className="grid grid-cols-[1fr_6rem] gap-4">
                <TextField label="Item Name" placeholder="water" value={values.name} onValueChange={set('name')} />
                <TextField label="Count" inputMode="numeric" value={values.count} onValueChange={set('count')} />
            </div>
            <ChoiceField
                label="Send To"
                value={values.destination}
                onValueChange={set('destination')}
                options={[
                    ...(character.online ? [{ value: 'inventory', label: 'Inventory' }] : []),
                    { value: 'postOffice', label: 'PO Box' },
                ]}
            />
        </ActionForm>
    );
}

function RemoveItemForm({ character, action }: FormProps) {
    const authedFetcher = useAuthedFetcher();
    const detail = useSWR(
        `/player/characterDetail?${new URLSearchParams({ citizenId: character.citizenId })}`,
        (url: string) => authedFetcher<PlayerCharacterDetailResp>(url),
        { revalidateOnFocus: false },
    );
    const items = detail.data && 'status' in detail.data && detail.data.status === 'ok'
        ? detail.data.inventory.flatMap((item) => item.slot === null ? [] : [{ ...item, slot: item.slot }])
        : [];
    const { values, set } = useFormValues({ slot: '', count: '1', reason: '' });
    const schema = z.object({
        slot: wholeNumber('slot', 1, 500).refine((slot) => items.some((item) => item.slot === slot), 'Choose an item.'),
        count: wholeNumber('count', 1, 1000), reason: reasonSchema });
    return (
        <ActionForm
            title="Remove Item"
            submitLabel="Remove Item"
            destructive
            action={action}
            reason={values.reason}
            onReasonChange={set('reason')}
            onSubmit={() => submitParsed(action, schema, values, (parsed) => {
                const held = items.find((item) => item.slot === parsed.slot);
                return { kind: 'removeItem', slot: parsed.slot, item: { name: held?.name ?? '', count: parsed.count } };
            })}
        >
            <div className="grid grid-cols-[1fr_6rem] gap-4">
                <ChoiceField
                    label="Item"
                    value={values.slot}
                    onValueChange={set('slot')}
                    options={items.map((item) => ({
                        value: String(item.slot),
                        label: `Slot ${item.slot}: ${item.label ?? item.name} ×${numberFormatter.format(item.count)}`,
                    }))}
                    placeholder={detail.data ? (items.length ? 'Choose an item' : 'No items') : 'Loading...'}
                />
                <TextField label="Count" inputMode="numeric" value={values.count} onValueChange={set('count')} />
            </div>
        </ActionForm>
    );
}

function GiveVehicleForm({ action }: FormProps) {
    const { values, set } = useFormValues({ model: '', reason: '' });
    const schema = z.object({
        model: z.string().trim().min(1, 'Enter a vehicle model.').max(64).regex(/^[A-Za-z0-9_]+$/, 'Use the exact vehicle model name.'),
        reason: reasonSchema,
    });
    return (
        <ActionForm
            title="Give Vehicle"
            submitLabel="Give Vehicle"
            action={action}
            reason={values.reason}
            onReasonChange={set('reason')}
            onSubmit={() => submitParsed(action, schema, values, (parsed) => ({ kind: 'giveVehicle', model: parsed.model }))}
        >
            <TextField label="Model" placeholder="sultan" value={values.model} onValueChange={set('model')} />
        </ActionForm>
    );
}

// ef_garages states; 2 is a seizure here, unlike the impound shown in the vehicle list.
const vehicleStateOptions = [
    { value: '1', label: 'Garaged' },
    { value: '0', label: 'Out or Impounded' },
    { value: '2', label: 'Seized' },
];

function EditVehicleForm({ character, action }: FormProps) {
    const { vehicles, loading } = useCharacterVehicles(character.citizenId);
    const { values, set, setValues } = useFormValues({ vehicleId: '', state: '1', garage: '', depotPrice: '0', reason: '' });
    function chooseVehicle(vehicleId: string) {
        const vehicle = vehicles.find((entry) => String(entry.id) === vehicleId);
        if (!vehicle) return;
        setValues((current) => ({
            ...current,
            vehicleId,
            state: String(vehicle.state),
            garage: vehicle.garage,
            depotPrice: String(vehicle.depotPrice),
        }));
    }
    const schema = z.object({
        vehicleId: wholeNumber('vehicle', 1, 2_147_483_647),
        state: z.enum(['0', '1', '2']),
        garage: z.string().trim().min(1, 'Enter a garage.').max(50).regex(/^[A-Za-z0-9_-]+$/, 'Use the exact garage name.'),
        depotPrice: wholeNumber('depot fee', 0, moneyMax),
        reason: reasonSchema,
    });
    return (
        <ActionForm
            title="Edit Vehicle"
            submitLabel="Save Vehicle"
            action={action}
            reason={values.reason}
            onReasonChange={set('reason')}
            onSubmit={() => submitParsed(action, schema, values, (parsed) => ({
                kind: 'editVehicle',
                vehicleId: parsed.vehicleId,
                state: Number(parsed.state),
                garage: parsed.garage,
                depotPrice: parsed.depotPrice,
            }))}
        >
            <ChoiceField
                label="Vehicle"
                value={values.vehicleId}
                onValueChange={chooseVehicle}
                options={vehicleOptions(vehicles)}
                placeholder={loading ? 'Loading...' : vehicles.length ? 'Choose a vehicle' : 'No vehicles'}
            />
            <div className="grid grid-cols-2 gap-4">
                <ChoiceField label="Status" value={values.state} onValueChange={set('state')} options={vehicleStateOptions} />
                <TextField label="Garage" value={values.garage} onValueChange={set('garage')} />
            </div>
            <TextField label="Depot Fee" inputMode="numeric" value={values.depotPrice} onValueChange={set('depotPrice')} />
        </ActionForm>
    );
}

function TransferVehicleForm({ character, action }: FormProps) {
    const { vehicles, loading } = useCharacterVehicles(character.citizenId);
    const { values, set } = useFormValues({ vehicleId: '', destinationCitizenId: '', reason: '' });
    const schema = z.object({
        vehicleId: wholeNumber('vehicle', 1, 2_147_483_647),
        destinationCitizenId: z.string().trim().min(1, 'Enter a citizen ID.').max(50)
            .refine((value) => value.toUpperCase() !== character.citizenId.toUpperCase(), 'The vehicle already belongs to this character.'),
        reason: reasonSchema,
    });
    return (
        <ActionForm
            title="Transfer Vehicle"
            submitLabel="Transfer Vehicle"
            action={action}
            reason={values.reason}
            onReasonChange={set('reason')}
            onSubmit={() => submitParsed(action, schema, values, (parsed) => ({
                kind: 'transferVehicle', vehicleId: parsed.vehicleId, destinationCitizenId: parsed.destinationCitizenId.toUpperCase(),
            }))}
        >
            <ChoiceField
                label="Vehicle"
                value={values.vehicleId}
                onValueChange={set('vehicleId')}
                options={vehicleOptions(vehicles)}
                placeholder={loading ? 'Loading...' : vehicles.length ? 'Choose a vehicle' : 'No vehicles'}
            />
            <TextField
                label="New Owner's Citizen ID"
                placeholder="ABC12345"
                value={values.destinationCitizenId}
                onValueChange={set('destinationCitizenId')}
            />
        </ActionForm>
    );
}

const bulkVehicleOptions = [
    { value: 'unDepotAll', label: 'Un-Depot All' },
    { value: 'unSeizeAll', label: 'Un-Seize All' },
    { value: 'depotAll', label: 'Depot All' },
    { value: 'seizeAll', label: 'Seize All' },
];

function BulkVehiclesForm({ action }: FormProps) {
    const { values, set } = useFormValues({ bulkAction: 'unDepotAll', reason: '' });
    const schema = z.object({ bulkAction: z.enum(['unDepotAll', 'unSeizeAll', 'depotAll', 'seizeAll']), reason: reasonSchema });
    return (
        <ActionForm
            title="Move All Vehicles"
            submitLabel={bulkVehicleOptions.find((option) => option.value === values.bulkAction)?.label ?? 'Move'}
            action={action}
            reason={values.reason}
            onReasonChange={set('reason')}
            onSubmit={() => submitParsed(action, schema, values, (parsed) => ({ kind: 'bulkVehicles', bulkAction: parsed.bulkAction }))}
        >
            <ChoiceField label="Action" value={values.bulkAction} onValueChange={set('bulkAction')} options={bulkVehicleOptions} />
        </ActionForm>
    );
}

const stateLimits = { health: 200, armor: 100, hunger: 100, thirst: 100, stress: 100 } as const;
const stateKeys = ['health', 'armor', 'hunger', 'thirst', 'stress'] as const;

function EditStateForm({ action }: FormProps) {
    const { values, set } = useFormValues({ key: 'health', value: '', reason: '' });
    const limit = stateLimits[pick(stateKeys, values.key) ?? 'health'];
    const schema = z.object({ key: z.enum(stateKeys), value: wholeNumber('value', 0, limit), reason: reasonSchema });
    return (
        <ActionForm
            title="Edit Condition"
            submitLabel="Set Value"
            action={action}
            reason={values.reason}
            onReasonChange={set('reason')}
            onSubmit={() => submitParsed(action, schema, values, (parsed) => ({ kind: 'editState', key: parsed.key, value: parsed.value }))}
        >
            <div className="grid grid-cols-2 gap-4">
                <ChoiceField
                    label="Stat"
                    value={values.key}
                    onValueChange={set('key')}
                    options={stateKeys.map((key) => ({ value: key, label: key[0].toUpperCase() + key.slice(1) }))}
                />
                <TextField label={`Value (0 to ${limit})`} inputMode="numeric" value={values.value} onValueChange={set('value')} />
            </div>
        </ActionForm>
    );
}

const playerActionTitles = {
    revive: 'Revive',
    clothingMenu: 'Give Clothing Menu',
    characterMenu: 'Give Character Menu',
};

function PlayerActionForm({ action, kind }: FormProps & { kind: keyof typeof playerActionTitles }) {
    const { values, set } = useFormValues({ reason: '' });
    const title = playerActionTitles[kind];
    return (
        <ActionForm
            title={title}
            submitLabel={title}
            action={action}
            reason={values.reason}
            onReasonChange={set('reason')}
            onSubmit={() => submitParsed(action, z.object({ reason: reasonSchema }), values, () => ({ kind }))}
        />
    );
}

function EditMetadataForm({ action }: FormProps) {
    const { values, set } = useFormValues({ key: '', value: '', reason: '' });
    const schema = z.object({
        key: z.string().trim().min(1, 'Enter a key.').max(64, 'Keys are at most 64 characters.')
            .regex(/^[A-Za-z0-9_.-]+$/, 'Keys use letters, numbers, dots, dashes and underscores.'),
        value: z.string().max(8000, 'That metadata value is too large.').transform((value, context): unknown => {
            try {
                return JSON.parse(value);
            } catch {
                context.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter the value as JSON.' });
                return z.NEVER;
            }
        }),
        reason: reasonSchema,
    });
    return (
        <ActionForm
            title="Edit Raw Metadata"
            submitLabel="Set Key"
            action={action}
            reason={values.reason}
            onReasonChange={set('reason')}
            onSubmit={() => submitParsed(action, schema, values, (parsed) => ({ kind: 'editMetadata', key: parsed.key, value: parsed.value }))}
        >
            <TextField label="Key" placeholder="hunger" value={values.key} onValueChange={set('key')} />
            <Field label="Value (JSON)">
                {(id) => (
                    <Textarea
                        id={id}
                        rows={4}
                        className="font-mono text-xs"
                        value={values.value}
                        onChange={(event) => set('value')(event.target.value)}
                    />
                )}
            </Field>
        </ActionForm>
    );
}

function RepairSlotForm({ character, action }: FormProps) {
    const { values, set } = useFormValues({ slot: '', reason: '' });
    const schema = z.object({
        slot: wholeNumber('slot', 1, 20).refine((slot) => slot !== character.slot, 'The character is already in that slot.'),
        reason: reasonSchema,
    });
    return (
        <ActionForm
            title="Change Slot"
            submitLabel="Move Character"
            action={action}
            reason={values.reason}
            onReasonChange={set('reason')}
            onSubmit={() => submitParsed(action, schema, values, (parsed) => ({ kind: 'repairSlot', slot: parsed.slot }))}
        >
            <TextField label="New Slot (1 to 20)" inputMode="numeric" value={values.slot} onValueChange={set('slot')} />
        </ActionForm>
    );
}

function DeleteCharacterForm({ character, action }: FormProps) {
    const { values, set } = useFormValues({ confirmName: '', reason: '' });
    const schema = z.object({
        confirmName: z.string().trim().refine((name) => name === character.fullName.trim(), 'Type the character\'s full name exactly.'),
        reason: reasonSchema,
    });
    return (
        <ActionForm
            title={`Delete ${character.fullName}`}
            submitLabel="Delete Character"
            destructive
            action={action}
            reason={values.reason}
            onReasonChange={set('reason')}
            onSubmit={() => submitParsed(action, schema, values, (parsed) => ({
                kind: 'deleteCharacter', confirmCitizenId: character.citizenId, confirmName: parsed.confirmName,
            }))}
        >
            <TextField
                label="Type the Full Name to Confirm"
                placeholder={character.fullName}
                value={values.confirmName}
                onValueChange={set('confirmName')}
            />
        </ActionForm>
    );
}


// =============================================
// Progression, opened from a Progression section row
// =============================================

const wholeMax = 2_147_483_647;
const skillMax = 100.9999;
type ProgressionField = { label: string; max: number; integer: boolean };

// The editable sources and fields (progressionEditDefinitions in ef_administration sv_characters.lua).
const progressionSources = {
    skills: { label: 'Skills', rowId: true, fields: {} },
    racing: {
        label: 'Racing', rowId: true, fields: {
            mmr: { label: 'MMR', max: wholeMax, integer: true },
            completed: { label: 'Completed Races', max: wholeMax, integer: true },
            wins: { label: 'Wins', max: wholeMax, integer: true },
            averagePosition: { label: 'Average Position', max: wholeMax, integer: true },
            timeSpentRacing: { label: 'Time Spent Racing', max: wholeMax, integer: true },
        },
    },
    boosting: {
        label: 'Boosting', rowId: true, fields: {
            level: { label: 'Level', max: wholeMax, integer: true },
            hacks: { label: 'Hacks', max: wholeMax, integer: true },
            deliveries: { label: 'Deliveries', max: wholeMax, integer: true },
        },
    },
    fishing: {
        label: 'Fishing', rowId: false, fields: {
            totalFishCaught: { label: 'Total Fish Caught', max: wholeMax, integer: true },
            biggestFishWeight: { label: 'Biggest Fish Weight', max: wholeMax, integer: false },
            totalWeight: { label: 'Total Caught Weight', max: wholeMax, integer: false },
            timeSpentFishing: { label: 'Time Spent Fishing', max: wholeMax, integer: true },
        },
    },
    'fishing-skills': { label: 'Fishing Skills', rowId: false, fields: { xp: { label: 'XP', max: wholeMax, integer: true } } },
    mining: {
        label: 'Mining', rowId: false, fields: {
            level: { label: 'Level', max: wholeMax, integer: true },
            exp: { label: 'Experience', max: wholeMax, integer: true },
            mined: { label: 'Items Mined', max: wholeMax, integer: true },
            smelted: { label: 'Items Smelted', max: wholeMax, integer: true },
            earned: { label: 'Total Earned', max: wholeMax, integer: true },
        },
    },
    trucking: {
        label: 'Trucking', rowId: false, fields: {
            experience: { label: 'XP', max: 4_294_967_295, integer: true },
            reputation: { label: 'Reputation', max: 1000, integer: true },
        },
    },
    prison: { label: 'Prison', rowId: false, fields: { jailtime: { label: 'Jail Time', max: 10_000_000, integer: true } } },
    'drug-progression': { label: 'Drug Progression', rowId: true, fields: { experience: { label: 'Experience', max: wholeMax, integer: true } } },
} satisfies Record<string, { label: string; rowId: boolean; fields: Record<string, ProgressionField> }>;

export type ProgressionSource = keyof typeof progressionSources;
const progressionSourceIds = [
    'skills', 'racing', 'boosting', 'fishing', 'fishing-skills', 'mining', 'trucking', 'prison', 'drug-progression',
] as const satisfies readonly ProgressionSource[];

/** The progression source a section source edits, or undefined when it is read-only. */
export function progressionSource(sourceId: string) {
    return pick(progressionSourceIds, sourceId);
}

type ProgressionEditField = ProgressionField & { key: string; value: number };

function skillFields(raw: unknown): ProgressionEditField[] {
    let skills: unknown = raw;
    if (typeof raw === 'string') {
        try {
            skills = JSON.parse(raw);
        } catch {
            return [];
        }
    }
    if (typeof skills !== 'object' || skills === null) return [];
    return Object.entries(skills).flatMap(([key, value]) => typeof value === 'number' && Number.isFinite(value)
        ? [{ key, label: key, max: skillMax, integer: false, value }]
        : []);
}

function progressionFields(adapterId: ProgressionSource, row: Record<string, unknown>): ProgressionEditField[] {
    if (adapterId === 'skills') return skillFields(row.skills);
    const fields: Record<string, ProgressionField> = progressionSources[adapterId].fields;
    return Object.entries(fields).flatMap(([key, field]) => {
        const value = row[key];
        return typeof value === 'number' && Number.isFinite(value) ? [{ key, ...field, value }] : [];
    });
}

function progressionNumber(input: string, field: ProgressionEditField) {
    const value = input.trim() === '' ? Number.NaN : Number(input);
    if (!Number.isFinite(value) || value < 0 || value > field.max) return null;
    return field.integer && !Number.isInteger(value) ? null : value;
}

function EditProgressionForm({ action, adapterId, row }: FormProps & { adapterId: ProgressionSource; row: Record<string, unknown> }) {
    const source = progressionSources[adapterId];
    const fields = progressionFields(adapterId, row);
    const { values, set } = useFormValues<Record<string, string>>({
        ...Object.fromEntries(fields.map((field) => [`field:${field.key}`, String(field.value)])),
        reason: '',
    });
    const rowId = source.rowId && typeof row.id === 'number' ? row.id : undefined;
    const schema = z.object({
        reason: reasonSchema.max(adapterId === 'trucking' ? 100 : 240, 'Trucking changes need a reason of 100 characters or fewer.'),
    }).passthrough().superRefine((_, context) => {
        for (const field of fields) {
            if (progressionNumber(values[`field:${field.key}`] ?? '', field) === null) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `${field.label} must be ${field.integer ? 'a whole number' : 'a number'} from 0 to ${field.max.toLocaleString('en-US')}.`,
                });
            }
        }
        if (!changedValues().length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Change at least one value.' });
    });
    function changedValues() {
        return fields.flatMap((field) => {
            const value = progressionNumber(values[`field:${field.key}`] ?? '', field);
            return value === null || value === field.value ? [] : [[field.key, value] as const];
        });
    }
    return (
        <ActionForm
            title={`Edit ${source.label}`}
            submitLabel="Save Progression"
            action={action}
            reason={values.reason ?? ''}
            onReasonChange={set('reason')}
            onSubmit={() => submitParsed(action, schema, values, () => ({
                kind: 'editProgression',
                adapterId,
                ...(rowId === undefined ? {} : { rowId }),
                values: Object.fromEntries(changedValues()),
            }))}
        >
            {!fields.length && <p className="text-sm text-muted-foreground">This record has no values to edit.</p>}
            {(source.rowId && rowId === undefined) && <p className="text-sm text-destructive-inline">This record cannot be edited.</p>}
            <div className="grid grid-cols-2 gap-4">
                {fields.map((field) => (
                    <TextField
                        key={field.key}
                        label={field.label}
                        inputMode="decimal"
                        value={values[`field:${field.key}`] ?? ''}
                        onValueChange={set(`field:${field.key}`)}
                    />
                ))}
            </div>
        </ActionForm>
    );
}


// =============================================
// The dialog
// =============================================

function ActionBody({ character, open, onClose }: { character: PlayerCharacter; open: OpenCharacterAction; onClose: () => void }) {
    const action = useCharacterAction(character.citizenId, onClose);
    const props = { character, action };
    switch (open.kind) {
        case 'setMoney': return <SetMoneyForm {...props} />;
        case 'setGroupGrade': return <SetGroupGradeForm {...props} />;
        case 'updateGroup': return <UpdateGroupForm {...props} />;
        case 'editIdentity': return <EditIdentityForm {...props} />;
        case 'giveItem': return <GiveItemForm {...props} />;
        case 'removeItem': return <RemoveItemForm {...props} />;
        case 'giveVehicle': return <GiveVehicleForm {...props} />;
        case 'editVehicle': return <EditVehicleForm {...props} />;
        case 'transferVehicle': return <TransferVehicleForm {...props} />;
        case 'bulkVehicles': return <BulkVehiclesForm {...props} />;
        case 'editState': return <EditStateForm {...props} />;
        case 'revive': return <PlayerActionForm {...props} kind="revive" />;
        case 'clothingMenu': return <PlayerActionForm {...props} kind="clothingMenu" />;
        case 'characterMenu': return <PlayerActionForm {...props} kind="characterMenu" />;
        case 'editMetadata': return <EditMetadataForm {...props} />;
        case 'repairSlot': return <RepairSlotForm {...props} />;
        case 'deleteCharacter': return <DeleteCharacterForm {...props} />;
        case 'editProgression': return <EditProgressionForm {...props} adapterId={open.adapterId} row={open.row} />;
    }
}

/** The open action's dialog. Its form mounts on open, so each opening starts from a clean form. */
export function CharacterActionDialog({ character, open, onClose }: {
    character: PlayerCharacter;
    open: OpenCharacterAction | null;
    onClose: () => void;
}) {
    return (
        <Dialog open={open !== null} onOpenChange={(isOpen) => !isOpen && onClose()}>
            {open && (
                <DialogContent className="sm:max-w-md">
                    <ActionBody character={character} open={open} onClose={onClose} />
                </DialogContent>
            )}
        </Dialog>
    );
}
