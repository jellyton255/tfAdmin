/**
 * everfall: the rule link of the punishment preset an action was issued from, or null when the
 * action has no preset, the preset was deleted, or it has no link.
 */
export const presetRuleUrl = (presetId: string | undefined) => {
    if (!presetId) return null;
    return txConfig.banlist.templates.find((preset) => preset.id === presetId)?.ruleUrl ?? null;
};
