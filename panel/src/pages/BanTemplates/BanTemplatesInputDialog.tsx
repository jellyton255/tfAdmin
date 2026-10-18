import { useEffect, useRef, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AutosizeTextAreaRef, AutosizeTextarea } from "@/components/ui/autosize-textarea";
import { BanTemplatesInputData } from "./BanTemplatesPage";
import { BanDurationType, LadderStepType } from "@shared/otherTypes";
import { banDurationToString } from "@/lib/utils";
import { txToast } from "@/components/TxToaster";
import { ordinal } from "@shared/offenseLadder";
import { PlusIcon, XIcon } from "lucide-react";

//Default dropdown options
const dropdownOptions = [
    '2 hours',
    '8 hours',
    '1 days',
    '2 days',
    '1 weeks',
    '2 weeks',
    'permanent'
];
const maxLadderSteps = 10;

//One rung of the ladder while editing
type StepDraft = {
    choice: string; //'warn', a dropdown option or 'custom'
    customValue: string;
    customUnits: string;
};

const stepToDraft = (step: LadderStepType): StepDraft => {
    if (step === 'warn') return { choice: 'warn', customValue: '', customUnits: 'days' };
    const asString = banDurationToString(step);
    //the dropdown uses plural units, banDurationToString singularizes "1 day"
    const plural = typeof step === 'object' ? `${step.value} ${step.unit}` : asString;
    if (dropdownOptions.includes(plural)) return { choice: plural, customValue: '', customUnits: 'days' };
    if (typeof step === 'object') return { choice: 'custom', customValue: step.value.toString(), customUnits: step.unit };
    return { choice: 'permanent', customValue: '', customUnits: 'days' };
};

const draftToStep = (draft: StepDraft): LadderStepType | undefined => {
    if (draft.choice === 'warn' || draft.choice === 'permanent') return draft.choice;
    const [value, unit] = draft.choice === 'custom'
        ? [draft.customValue, draft.customUnits]
        : draft.choice.split(' ');
    const parsed = parseInt(value);
    if (!(parsed > 0)) return undefined;
    return { value: parsed, unit: unit as Exclude<BanDurationType, 'permanent'>['unit'] };
};

const defaultSteps = (reasonData?: BanTemplatesInputData) => {
    if (!reasonData) return [stepToDraft({ value: 2, unit: 'days' })];
    return (reasonData.ladder ?? [reasonData.duration]).map(stepToDraft);
};


type BanTemplatesInputDialogProps = {
    reasonData?: BanTemplatesInputData;
    onSave: (reasonData: BanTemplatesInputData) => void;
    isDialogOpen: boolean;
    setIsDialogOpen: (isOpen: boolean) => void;
}

export default function BanTemplatesInputDialog({
    reasonData,
    onSave,
    isDialogOpen,
    setIsDialogOpen
}: BanTemplatesInputDialogProps) {
    const reasonRef = useRef<AutosizeTextAreaRef>(null);
    const nameRef = useRef<HTMLInputElement>(null);
    const ruleUrlRef = useRef<HTMLInputElement>(null);
    const [steps, setSteps] = useState<StepDraft[]>(() => defaultSteps(reasonData));

    useEffect(() => {
        const timeout = setTimeout(() => {
            if (isDialogOpen) return;
            setSteps(defaultSteps(reasonData));
            if (reasonRef.current) reasonRef.current.textArea.value = '';
            if (nameRef.current) nameRef.current.value = '';
            if (ruleUrlRef.current) ruleUrlRef.current.value = '';
        }, 500);
        return () => clearTimeout(timeout);
    }, [isDialogOpen]);

    const updateStep = (index: number, change: Partial<StepDraft>) => {
        setSteps((prev) => prev.map((step, i) => i === index ? { ...step, ...change } : step));
    };

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const form = e.currentTarget;
        const id = reasonData?.id || null;
        const reason = form.reason.value.trim();
        form.reason.value = reason; //just to make sure the field is also trimmed
        if (reason.length < 3) {
            form.reason.focus();
            return txToast.warning('Reason must be at least 3 characters long');
        }
        const name = form.presetName.value.trim() || undefined;
        const ruleUrl = form.ruleUrl.value.trim() || undefined;
        if (ruleUrl && !/^https?:\/\/\S+$/i.test(ruleUrl)) {
            form.ruleUrl.focus();
            return txToast.warning('Rule Link must start with https://');
        }

        const ladder: LadderStepType[] = [];
        for (const draft of steps) {
            const step = draftToStep(draft);
            if (!step) return txToast.warning('Custom durations must be a positive number');
            ladder.push(step);
        }
        //`duration` is what older builds and the identifier ban page use: the first ban step
        const firstBan = ladder.find((step): step is BanDurationType => step !== 'warn');
        const duration = firstBan ?? { value: 1, unit: 'days' };
        const isPlainBan = ladder.length === 1 && ladder[0] !== 'warn';
        onSave({ id, reason, duration, name, ladder: isPlainBan ? undefined : ladder, ruleUrl });
    }

    return (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogContent className="md:max-w-xl">
                <form onSubmit={handleSubmit}>
                    <div className="space-y-4">
                        <DialogHeader>
                            <DialogTitle>{reasonData ? 'Edit' : 'Add'} Preset</DialogTitle>
                        </DialogHeader>
                        <div className="grid grid-cols-6 items-center gap-4">
                            <Label htmlFor="presetName" className="col-span-6 sm:col-auto">
                                Name
                            </Label>
                            <Input
                                id="presetName"
                                ref={nameRef}
                                placeholder="RDM"
                                className="col-span-full sm:col-span-5"
                                defaultValue={reasonData?.name}
                                maxLength={32}
                            />
                        </div>
                        <div className="grid grid-cols-6 items-center gap-4">
                            <Label htmlFor="reason" className="col-span-6 sm:col-auto">
                                Reason
                            </Label>
                            {/* the textarea renders inside its own wrapper, so the wrapper takes the grid span */}
                            <div className="col-span-full sm:col-span-5">
                                <AutosizeTextarea
                                    id="reason"
                                    placeholder="The reason for the ban, rule violated, etc."
                                    defaultValue={reasonData?.reason ?? ''}
                                    ref={reasonRef}
                                    maxHeight={160}
                                    minLength={3}
                                    autoFocus
                                    required
                                    onChangeCapture={(e) => {
                                        //prevent breaking line
                                        const target = e.target as HTMLInputElement;
                                        if (target.value.includes('\n')) {
                                            target.value = target.value.replace(/\s*\r*\n+\s*/g, ' ');
                                        }
                                    }}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-6 items-center gap-4">
                            <Label htmlFor="ruleUrl" className="col-span-6 sm:col-auto">
                                Rule Link
                            </Label>
                            <Input
                                id="ruleUrl"
                                ref={ruleUrlRef}
                                type="url"
                                placeholder="https://everfallcommunity.com/rules/general#roleplay-regulations-rule-1"
                                className="col-span-full sm:col-span-5"
                                defaultValue={reasonData?.ruleUrl}
                                maxLength={512}
                            />
                        </div>
                        <div className="grid grid-cols-6 items-start gap-4">
                            <Label className="col-span-6 sm:col-auto sm:pt-3">
                                Ladder
                            </Label>
                            <div className="col-span-full sm:col-span-5 space-y-2">
                                {steps.map((step, index) => (
                                    <div key={index} className="flex flex-row items-center gap-2">
                                        <span className="w-9 shrink-0 text-sm text-muted-foreground">{ordinal(index + 1)}</span>
                                        <Select
                                            value={step.choice}
                                            onValueChange={(choice) => updateStep(index, { choice })}
                                        >
                                            <SelectTrigger className="tracking-wide">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="tracking-wide">
                                                <SelectItem value="warn" className="font-bold">Warn</SelectItem>
                                                <SelectItem value="custom" className="font-bold">Custom</SelectItem>
                                                <SelectItem value="2 hours">2 HOURS</SelectItem>
                                                <SelectItem value="8 hours">8 HOURS</SelectItem>
                                                <SelectItem value="1 days">1 DAY</SelectItem>
                                                <SelectItem value="2 days">2 DAYS</SelectItem>
                                                <SelectItem value="1 weeks">1 WEEK</SelectItem>
                                                <SelectItem value="2 weeks">2 WEEKS</SelectItem>
                                                <SelectItem value="permanent" className="font-bold">Permanent</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        {step.choice === 'custom' && <>
                                            <Input
                                                type="number"
                                                placeholder="3"
                                                className="w-20 shrink-0"
                                                value={step.customValue}
                                                onChange={(e) => updateStep(index, { customValue: e.currentTarget.value })}
                                                min={1}
                                                max={99}
                                                required
                                            />
                                            <Select
                                                value={step.customUnits}
                                                onValueChange={(customUnits) => updateStep(index, { customUnits })}
                                            >
                                                <SelectTrigger className="tracking-wide w-32 shrink-0">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent className="tracking-wide">
                                                    <SelectItem value="hours">HOURS</SelectItem>
                                                    <SelectItem value="days">DAYS</SelectItem>
                                                    <SelectItem value="weeks">WEEKS</SelectItem>
                                                    <SelectItem value="months">MONTHS</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </>}
                                        <Button
                                            type="button"
                                            size="icon"
                                            variant="ghost"
                                            className="shrink-0"
                                            disabled={steps.length === 1}
                                            onClick={() => setSteps((prev) => prev.filter((_, i) => i !== index))}
                                        >
                                            <XIcon className="size-4" />
                                        </Button>
                                    </div>
                                ))}
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={steps.length >= maxLadderSteps}
                                    onClick={() => setSteps((prev) => [...prev, { ...prev[prev.length - 1] }])}
                                >
                                    <PlusIcon className="size-4 mr-1" /> Add Step
                                </Button>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button type="submit">Save Changes</Button>
                        </DialogFooter>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    )
}
