import React, { FormEventHandler, useState } from "react";
import {
  Box,
  Button,
  DialogContent,
  IconButton,
  TextField,
  Typography,
  useTheme,
} from "@mui/material";
import { DeleteOutline } from "@mui/icons-material";
import {
  useForcePlayerRefresh,
  usePlayerDetailsValue,
} from "../../../state/playerDetails.state";
import { fetchWebPipe } from "../../../utils/fetchWebPipe";
import { useSnackbar } from "notistack";
import { useTranslate } from "react-polyglot";
import { DialogLoadError } from "./DialogLoadError";
import { GenericApiErrorResp, GenericApiResp } from "@shared/genericApiTypes";
import humanizeDuration, { Unit } from "humanize-duration";
import { ButtonXS } from "../../misc/ButtonXS";
import { tsToLocaleDate, tsToLocaleDateTime, userHasPerm } from "@nui/src/utils/miscUtils";
import {
  PlayerModalTabs,
  useSetPlayerModalTab,
} from "@nui/src/state/playerModal.state";
import { usePermissionsValue } from "@nui/src/state/permissions.state";

const DialogInfoView: React.FC = () => {
  const [note, setNote] = useState("");
  const { enqueueSnackbar } = useSnackbar();
  const playerDetails = usePlayerDetailsValue();
  const forceRefresh = useForcePlayerRefresh();
  const setTab = useSetPlayerModalTab();
  const t = useTranslate();
  const theme = useTheme();
  const userPerms = usePermissionsValue();
  if ("error" in playerDetails) return <DialogLoadError />;
  const player = playerDetails.player;

  //Prepare vars
  const language = t("$meta.humanizer_language");
  function minsToDuration(seconds: number) {
    return humanizeDuration(seconds * 60_000, {
      language,
      round: true,
      units: ["d", "h", "m"] as Unit[],
      fallbacks: ["en"],
    });
  }

  const handleSaveNote: FormEventHandler = async (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    try {
      const result = await fetchWebPipe<GenericApiResp>(
        `/player/save_note?mutex=current&netid=${player.netid}`,
        {
          method: "POST",
          data: { note: note.trim() },
        }
      );
      if ("success" in result && result.success === true) {
        setNote("");
        forceRefresh((val) => val + 1);
        enqueueSnackbar(t(`nui_menu.player_modal.info.notes_changed`), {
          variant: "success",
        });
      } else {
        enqueueSnackbar(
          (result as GenericApiErrorResp).error ?? t("nui_menu.misc.unknown_error"),
          { variant: "error" }
        );
      }
    } catch (e) {
      enqueueSnackbar(t("nui_menu.misc.unknown_error"), { variant: "error" });
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    try {
      const result = await fetchWebPipe<GenericApiResp>(
        `/player/delete_note?mutex=current&netid=${player.netid}`,
        {
          method: "POST",
          data: { noteId },
        }
      );
      if ("success" in result && result.success === true) {
        forceRefresh((val) => val + 1);
        enqueueSnackbar("Note deleted.", { variant: "success" });
      } else {
        enqueueSnackbar(
          "error" in result ? result.error : t("nui_menu.misc.unknown_error"),
          { variant: "error" }
        );
      }
    } catch (error) {
      enqueueSnackbar(t("nui_menu.misc.unknown_error"), { variant: "error" });
    }
  };

  //Whitelist button
  const btnChangeWhitelistStatus = async () => {
    try {
      const result = await fetchWebPipe<GenericApiResp>(
        `/player/whitelist?mutex=current&netid=${player.netid}`,
        {
          method: "POST",
          data: { status: !player.tsWhitelisted },
        }
      );
      if ("success" in result && result.success === true) {
        forceRefresh((val) => val + 1);
        enqueueSnackbar(t(`nui_menu.player_modal.info.btn_wl_success`), {
          variant: "success",
        });
      } else {
        enqueueSnackbar(
          (result as GenericApiErrorResp).error ?? t("nui_menu.misc.unknown_error"),
          { variant: "error" }
        );
      }
    } catch (error) {
      enqueueSnackbar((error as Error).message, { variant: "error" });
    }
  };

  //Log stuff
  const counts = { ban: 0, warn: 0 };
  for (const action of player.actionHistory) {
    counts[action.type]++;
  }
  const btnLogDetails = () => {
    setTab(PlayerModalTabs.HISTORY);
  };

  return (
    <DialogContent>
      <Typography variant="h6">
        {t("nui_menu.player_modal.info.title")}
      </Typography>
      <Typography>
        {t("nui_menu.player_modal.info.session_time")}:{" "}
        <span style={{ color: theme.palette.text.secondary }}>
          {player.sessionTime ? minsToDuration(player.sessionTime) : "--"}
        </span>
      </Typography>
      <Typography>
        {t("nui_menu.player_modal.info.play_time")}:{" "}
        <span style={{ color: theme.palette.text.secondary }}>
          {player.playTime ? minsToDuration(player.playTime) : "--"}
        </span>
      </Typography>
      <Typography>
        {t("nui_menu.player_modal.info.joined")}:{" "}
        <span style={{ color: theme.palette.text.secondary }}>
          {player.tsJoined ? tsToLocaleDate(player.tsJoined) : "--"}
        </span>
      </Typography>
      <Typography>
        {t("nui_menu.player_modal.info.whitelisted_label")}:{" "}
        <span style={{ color: theme.palette.text.secondary }}>
          {player.tsWhitelisted
            ? tsToLocaleDate(player.tsWhitelisted)
            : t("nui_menu.player_modal.info.whitelisted_notyet")}
        </span>{" "}
        <ButtonXS
          color={player.tsWhitelisted ? "error" : "success"}
          variant="outlined"
          onClick={btnChangeWhitelistStatus as any}
          disabled={!userHasPerm('players.whitelist', userPerms) || !player.license}
        >
          {player.tsWhitelisted
            ? t("nui_menu.player_modal.info.btn_wl_remove")
            : t("nui_menu.player_modal.info.btn_wl_add")}
        </ButtonXS>
      </Typography>
      <Typography>
        {t("nui_menu.player_modal.info.log_label")}:{" "}
        <span style={{ color: theme.palette.text.secondary }}>
          {!counts.ban && !counts.warn ? (
            t("nui_menu.player_modal.info.log_empty")
          ) : (
            <>
              <span style={{ color: theme.palette.error.main }}>
                {t("nui_menu.player_modal.info.log_ban_count", {
                  smart_count: counts.ban,
                })}
              </span>
              ,&nbsp;
              <span style={{ color: theme.palette.warning.main }}>
                {t("nui_menu.player_modal.info.log_warn_count", {
                  smart_count: counts.warn,
                })}
              </span>
            </>
          )}
        </span>{" "}
        <ButtonXS
          color="info"
          variant="outlined"
          onClick={btnLogDetails as any}
        >
          {t("nui_menu.player_modal.info.log_btn")}
        </ButtonXS>
      </Typography>
      <form onSubmit={handleSaveNote} style={{marginBlockEnd: 0}}>
        <Box pt={1}>
          <TextField
            autoFocus
            margin="dense"
            id="name"
            label={t("nui_menu.player_modal.info.notes_placeholder")}
            type="text"
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
            variant="outlined"
            multiline
            minRows={2}
            fullWidth
            disabled={!player.license}
            inputProps={{ maxLength: 4096 }}
          />
          <Button
            type="submit"
            color="primary"
            variant="outlined"
            disabled={!player.license || !note.trim()}
          >
            Add Note
          </Button>
        </Box>
      </form>
      {player.noteHistory?.map((entry) => (
        <Box
          key={entry.id}
          mt={1}
          pl={1}
          display="flex"
          alignItems="flex-start"
          gap={1}
          style={{ borderLeft: `3px solid ${theme.palette.divider}` }}
        >
          <Box flexGrow={1} minWidth={0}>
            <Typography style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {entry.text}
            </Typography>
            <Typography
              variant="caption"
              title={tsToLocaleDateTime(entry.ts)}
              style={{ color: theme.palette.text.secondary }}
            >
              {entry.author} · {tsToLocaleDate(entry.ts, "medium")}
            </Typography>
          </Box>
          <IconButton
            size="small"
            title="Delete Note"
            onClick={() => handleDeleteNote(entry.id)}
          >
            <DeleteOutline fontSize="small" />
          </IconButton>
        </Box>
      ))}
    </DialogContent>
  );
};

export default DialogInfoView;
