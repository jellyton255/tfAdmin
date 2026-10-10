import { DatabaseWhitelistApprovalsType, DatabaseWhitelistRequestsType } from "@modules/Database/databaseTypes";
import { GenericApiErrorResp } from "./genericApiTypes";

export type WhitelistApprovalsResp = DatabaseWhitelistApprovalsType[] | GenericApiErrorResp;

export type WhitelistRequestsResp = {
    cntTotal: number;
    cntFiltered: number;
    newest: number; //so deny all only removes requests the admin has seen
    totalPages: number;
    currPage: number;
    requests: DatabaseWhitelistRequestsType[];
} | GenericApiErrorResp;
