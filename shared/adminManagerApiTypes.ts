import { GenericApiErrorResp, GenericApiOkResp } from "./genericApiTypes";

export type AdminManagerPermission = {
    id: string;
    label: string;
    dangerous: boolean;
    //game = player and in-game menu actions, panel = everything else
    group: 'panel' | 'game';
};

export type AdminManagerGroup = {
    id: string;
    name: string;
    description: string;
    permissions: string[];
    members: string[]; //admin names
    canEdit: boolean; //false when it has permissions the viewing admin doesn't have
};

export type AdminManagerAdmin = {
    name: string;
    isMaster: boolean;
    isSelf: boolean;
    groups: string[]; //group ids
    permissions: string[]; //resolved from the groups
    citizenfxId: string | null; //forum username, as typed in the form
    citizenfxIdentifier: string | null;
    discordId: string | null;
    canEdit: boolean;
    canDelete: boolean;
    passkeyCount: number;
};

export type AdminManagerListResp = {
    admins: AdminManagerAdmin[];
    groups: AdminManagerGroup[];
    permissions: AdminManagerPermission[];
} | GenericApiErrorResp;

export type AdminManagerSaveReq = {
    name: string;
    citizenfxID: string;
    discordID: string;
    groups: string[]; //group ids
};
export type AdminManagerAddResp = {
    success: true;
    password: string;
} | GenericApiErrorResp;
export type AdminManagerEditResp = GenericApiOkResp;

export type AdminManagerDeleteReq = {
    name: string;
};
export type AdminManagerDeleteResp = GenericApiOkResp;

export type AdminManagerRemovePasskeysReq = {
    name: string;
};
export type AdminManagerRemovePasskeysResp = GenericApiOkResp;

export type AdminManagerGroupSaveReq = {
    id?: string; //creates a new group when missing
    name: string;
    description: string;
    permissions: string[];
    members?: string[]; //admin names, replaces the group's members when set
};
export type AdminManagerGroupSaveResp = {
    success: true;
    id: string;
} | GenericApiErrorResp;

export type AdminManagerGroupDeleteReq = {
    id: string;
};
export type AdminManagerGroupDeleteResp = GenericApiOkResp;
