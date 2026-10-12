import React from "react";
import { useSnackbar } from "notistack";
import { useNuiEvent } from "./useNuiEvent";
import { useTranslate } from "react-polyglot";
import { shouldHelpAlertShow } from "../utils/shouldHelpAlertShow";
import { debugData } from "../utils/debugData";
import {
  usePlayersState,
  useSetPlayerFilter,
  useSetPlayersFilterIsTemp,
} from "../state/players.state";
import { useSetAssociatedPlayer } from "../state/playerDetails.state";
import { txAdminMenuPage, useSetPage } from "../state/page.state";
import { useSetPlayerModalVisibility } from "@nui/src/state/playerModal.state";
import cleanPlayerName from "@shared/cleanPlayerName";
import { usePlayerModalContext } from "../provider/PlayerModalProvider";
import { fetchNui } from "../utils/fetchNui";

type SnackbarAlertSeverities = "success" | "error" | "warning" | "info";

interface SnackbarAlert {
  level: SnackbarAlertSeverities;
  message: string;
  isTranslationKey?: boolean;
  tOptions?: object;
}

debugData(
  [
    {
      action: "showMenuHelpInfo",
      data: {},
    },
  ],
  5000
);

export const useHudListenersService = () => {
  const { enqueueSnackbar } = useSnackbar();
  const t = useTranslate();
  const onlinePlayers = usePlayersState();
  const setAssocPlayer = useSetAssociatedPlayer();
  const setModalOpen = useSetPlayerModalVisibility();
  const setPlayerFilter = useSetPlayerFilter();
  const setPlayersFilterIsTemp = useSetPlayersFilterIsTemp();
  const setPage = useSetPage();
  const { closeMenu } = usePlayerModalContext();

  const snackFormat = (m: string) => (
    <span style={{ whiteSpace: "pre-wrap" }}>{m}</span>
  );

  useNuiEvent<SnackbarAlert>(
    "setSnackbarAlert",
    ({ level, message, isTranslationKey, tOptions }) => {
      if (isTranslationKey) {
        message = t(message, tOptions);
      }
      enqueueSnackbar(
        snackFormat(message),
        { variant: level }
      );
    }
  );

  useNuiEvent("showMenuHelpInfo", () => {
    const showAlert = shouldHelpAlertShow();
    if (showAlert) {
      enqueueSnackbar(snackFormat(t("nui_menu.misc.help_message")), {
        variant: "info",
        anchorOrigin: {
          horizontal: "center",
          vertical: "bottom",
        },
        autoHideDuration: 10000,
      });
    }
  });

  // Handler for dynamically opening the player page & player modal with target
  useNuiEvent<string>("openPlayerModal", (target) => {
    let targetPlayer;

    //Search by ID
    const targetId = parseInt(target);
    if (!isNaN(targetId)) {
      targetPlayer = onlinePlayers.find(
        (playerData) => playerData.id === targetId
      );
    }

    //Search by pure name
    if (!targetPlayer && typeof target === "string") {
      const searchInput = cleanPlayerName(target).pureName;
      const foundPlayers = onlinePlayers.filter((playerData) =>
        playerData.pureName?.includes(searchInput)
      );

      if (foundPlayers.length === 1) {
        targetPlayer = foundPlayers[0];
      } else if (foundPlayers.length > 1) {
        setPlayerFilter(target);
        setPage(txAdminMenuPage.Players);
        setPlayersFilterIsTemp(true);
        return;
      }
    }

    if (targetPlayer) {
      setPage(txAdminMenuPage.PlayerModalOnly);
      setAssocPlayer(targetPlayer);
      setModalOpen(true);
    } else {
      closeMenu();
      setModalOpen(false);
      enqueueSnackbar(
        t("nui_menu.player_modal.misc.target_not_found", { target }),
        { variant: "error" }
      );
    }
  });
};
