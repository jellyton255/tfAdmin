import type { GenericApiErrorResp } from "./genericApiTypes";

export type ResourceItemType = {
    name: string;
    status: string;
    version: string | null;
    author: string | null;
    description: string | null;
};

export type ResourceGroupType = {
    subPath: string;
    resources: ResourceItemType[];
};

export type ResourcesListResp = {
    groups: ResourceGroupType[];
} | GenericApiErrorResp;
