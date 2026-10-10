import { GenericApiErrorResp, GenericApiOkResp } from "./genericApiTypes";

export type AdminManagerPermission = {
    id: string;
    label: string;
    dangerous: boolean;
    //game = player and in-game menu actions, panel = everything else
    group: 'panel' | 'game';
};

export type AdminManagerAdmin = {
    name: string;
    isMaster: boolean;
    isSelf: boolean;
    permissions: string[];
    citizenfxId: string | null; //forum username, as typed in the form
    citizenfxIdentifier: string | null;
    discordId: string | null;
    canEdit: boolean;
    canDelete: boolean;
};

export type AdminManagerListResp = {
    admins: AdminManagerAdmin[];
    permissions: AdminManagerPermission[];
} | GenericApiErrorResp;

export type AdminManagerSaveReq = {
    name: string;
    citizenfxID: string;
    discordID: string;
    permissions: string[];
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
