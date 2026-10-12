import { LocaleType } from "@shared/localeMap";
import { atom, useRecoilValue, useSetRecoilState } from "recoil";
import config from "../utils/config.json";
import type { MenuSentryConfig } from "../utils/sentry";

interface OneSyncCtx {
  type: null | string;
  status: boolean;
}


export interface ServerCtx {
  oneSync: OneSyncCtx;
  projectName: null | string;
  maxClients: number;
  locale: string;
  localeData: LocaleType | boolean;
  switchPageKey: string;
  txAdminVersion: string;
  alignRight: boolean;
  sentry?: MenuSentryConfig;
}

const serverCtx = atom<ServerCtx>({
  key: "serverCtx",
  default: config.serverCtx,
});

export const useServerCtxValue = () => useRecoilValue(serverCtx);

export const useSetServerCtx = () => useSetRecoilState(serverCtx);
