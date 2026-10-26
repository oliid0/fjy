import { useEffect, useRef, useState } from "react";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import LinearProgress from "@mui/material/LinearProgress";
import { t, useI18n } from "@excalidraw/excalidraw/i18n";
import {
  microphoneIcon,
  playerPlayIcon,
  playerStopFilledIcon,
} from "@excalidraw/excalidraw/components/icons";

import { SummaryText } from "./SummaryText";
import { RecordingActions } from "./RecordingActions";
import { timestamp } from "./recording";

import type { Recording, RecordingMode } from "./recording";
import type { TranscriptLine } from "./speech";

export type RecordingPhase =
  | "idle"
  | "starting"
  | "recording"
  | "paused"
  | "stopping"
  | "summarizing"
  | "ready";

export const RecordingPanel = (props: {
  phase: RecordingPhase;
  recording: boolean;
  paused: boolean;
  elapsed: number;
  mode: RecordingMode;
  onMode: (mode: RecordingMode) => void;
  records: Recording[];
  activeId: string;
  onSelect: (id: string) => void;
  transcript: TranscriptLine[];
  busy: boolean;
  controlBusy: boolean;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onTranscribe: () => void;
  onSummary: () => void;
  onDelete: () => void;
  onNotes: (value: string) => void;
  onRead: () => void;
  onStopRead: () => void;
}) => {
  useI18n();
  const [tab, setTab] = useState("transcript");
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState("");
  const [url, setUrl] = useState<string>();
  const player = useRef<HTMLVideoElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const active = props.records.find((item) => item.id === props.activeId);
  const processing = ["starting", "stopping", "summarizing"].includes(
    props.phase,
  );
  const live = props.recording || processing;
  const lines = live ? props.transcript : active?.transcript || [];
  const activeBlob = active?.blob;
  useEffect(() => {
    setEditing(false);
    setMenu(null);
  }, [props.activeId]);
  useEffect(() => {
    if (!activeBlob) {
      setUrl(undefined);
      return;
    }
    const value = URL.createObjectURL(activeBlob);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [activeBlob]);
  useEffect(() => {
    if (live && following.current && log.current) {
      log.current.scrollTop = log.current.scrollHeight;
    }
  }, [live, lines.length]);
  const controls = (
    <div
      className="fc-recording-commandbar"
      role="toolbar"
      aria-label={t("fcboard.recording")}
    >
      {props.recording ? (
        <>
          <span className="fc-recording-clock" data-paused={props.paused}>
            <i />
            {props.paused
              ? t("fcboard.recording_paused")
              : t("fcboard.recording")}{" "}
            · {timestamp(props.elapsed)}
          </span>
          <Tooltip
            title={t(
              props.paused
                ? "fcboard.recording_resume"
                : "fcboard.recording_pause",
            )}
          >
            <span>
              <IconButton
                disabled={processing || props.controlBusy}
                aria-label={t(
                  props.paused
                    ? "fcboard.recording_resume"
                    : "fcboard.recording_pause",
                )}
                onClick={props.onPause}
              >
                {props.paused ? (
                  playerPlayIcon
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="currentColor" d="M6 4h4v16H6zm8 0h4v16h-4z" />
                  </svg>
                )}
              </IconButton>
            </span>
          </Tooltip>
          <Button
            color="error"
            variant="contained"
            disableElevation
            disabled={processing}
            startIcon={playerStopFilledIcon}
            onClick={props.onStop}
          >
            {t("fcboard.stop_recording")}
          </Button>
        </>
      ) : processing ? (
        <span role="status">
          {t("fcboard.processing")}{" "}
          {props.phase === "summarizing" ? t("fcboard.ai_summary") : ""}
        </span>
      ) : (
        <Button
          variant="contained"
          color="error"
          disableElevation
          startIcon={microphoneIcon}
          disabled={props.busy}
          onClick={props.onStart}
        >
          {t("fcboard.start_recording")}
        </Button>
      )}
    </div>
  );
  return (
    <div className="fc-recording-workspace">
      <nav
        className="fc-recordings-list"
        aria-label={t("fcboard.local_recordings")}
      >
        <Button
          disabled={live || props.busy}
          onClick={() => props.onSelect("")}
        >
          {t("fcboard.new_recording")}
        </Button>
        <List disablePadding>
          {props.records.map((item) => (
            <ListItemButton
              component="button"
              key={item.id}
              disabled={live || props.busy}
              selected={item.id === props.activeId}
              onClick={() => props.onSelect(item.id)}
            >
              <span>
                {new Date(item.created).toLocaleString()}
                <small>{timestamp(item.duration)}</small>
              </span>
            </ListItemButton>
          ))}
        </List>
      </nav>
      <main className="fc-recording-main">
        <div className="fc-recording-topbar">
          {!active && !live && (
            <ToggleButtonGroup
              exclusive
              size="small"
              value={props.mode}
              aria-label={t("fcboard.recording_mode")}
              onChange={(_, mode) => {
                if (mode) {
                  props.onMode(mode);
                }
              }}
            >
              {(
                [
                  ["audio", "microphone"],
                  ["camera", "microphone_camera"],
                  ["screen", "microphone_board"],
                  ["combined", "microphone_camera_board"],
                ] as const
              ).map(([mode, key]) => (
                <ToggleButton key={mode} value={mode}>
                  {t(`fcboard.${key}`)}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          )}
          {active && !live ? (
            <>
              <strong>{new Date(active.created).toLocaleString()}</strong>
              <RecordingActions recording={active} />
              <IconButton
                disabled={props.busy}
                aria-label={t("buttons.edit")}
                onClick={(event) => setMenu(event.currentTarget)}
              >
                ⋮
              </IconButton>
            </>
          ) : (
            controls
          )}
        </div>
        {processing && <LinearProgress aria-label={t("fcboard.processing")} />}
        {!live && !active ? (
          <div className="fc-recording-empty">
            {microphoneIcon}
            <p>{t("fcboard.recording_mode")}</p>
            <small>
              {t(
                "fcboard.close_this_panel_to_keep_writing_while_recording_board_mode_captures_the_canvas_combined_mode",
              )}
            </small>
          </div>
        ) : (
          <>
            {!live && (
              <Tabs
                className="fc-recording-mobile-tabs"
                value={tab}
                onChange={(_, value) => setTab(value)}
                aria-label={t("fcboard.recording")}
              >
                <Tab
                  value="transcript"
                  label={t("fcboard.transcript_timeline")}
                />
                <Tab value="summary" label={t("fcboard.ai_summary")} />
              </Tabs>
            )}
            <div className={`fc-recording-panes${live ? " is-live" : ""}`}>
              <section
                className="fc-recording-transcript-pane"
                data-active={live || tab === "transcript"}
                aria-label={t("fcboard.transcript_timeline")}
              >
                <div className="fc-recording-pane-header">
                  <strong>{t("fcboard.transcript_timeline")}</strong>
                  {!live && (
                    <Button disabled={props.busy} onClick={props.onTranscribe}>
                      {t("fcboard.transcribe_transcribe_again")}
                    </Button>
                  )}
                </div>
                <div
                  ref={log}
                  className="fc-recording-lines"
                  role={live ? "log" : undefined}
                  onScroll={() => {
                    const node = log.current;
                    if (node) {
                      following.current =
                        node.scrollHeight - node.scrollTop - node.clientHeight <
                        48;
                    }
                  }}
                >
                  {lines.length ? (
                    lines.map((line, index) => (
                      <Button
                        key={index}
                        className="fc-recording-line"
                        disabled={live}
                        onClick={() => {
                          if (player.current) {
                            player.current.currentTime = line.time;
                            void player.current.play().catch(() => {});
                          }
                        }}
                      >
                        <time>{timestamp(line.time)}</time>
                        <span>{line.text}</span>
                      </Button>
                    ))
                  ) : (
                    <p className="fc-recording-empty-text">
                      {t(
                        live
                          ? "fcboard.listening"
                          : "fcboard.no_transcript_yet_use_a_custom_speech_service_or_add_notes_manually",
                      )}
                    </p>
                  )}
                </div>
              </section>
              {!live && active && (
                <section
                  className="fc-recording-summary-pane"
                  data-active={tab === "summary"}
                  aria-label={t("fcboard.ai_summary")}
                >
                  <div className="fc-recording-pane-header">
                    <strong>{t("fcboard.ai_summary")}</strong>
                    <Button
                      disabled={props.busy || !lines.length}
                      onClick={props.onSummary}
                    >
                      {t("fcboard.generate_ai_summary")}
                    </Button>
                    {active.summary && (
                      <>
                        <IconButton
                          disabled={props.busy}
                          aria-label={t("fcboard.read_summary_aloud")}
                          onClick={props.onRead}
                        >
                          {playerPlayIcon}
                        </IconButton>
                        <IconButton
                          aria-label={t("fcboard.stop_playback")}
                          onClick={props.onStopRead}
                        >
                          {playerStopFilledIcon}
                        </IconButton>
                      </>
                    )}
                  </div>
                  <div className="fc-recording-summary-content">
                    <SummaryText
                      value={active.summary}
                      placeholder={t(
                        "fcboard.no_summary_yet_generate_one_below",
                      )}
                    />
                  </div>
                </section>
              )}
            </div>
            {!live && active && (
              <div className="fc-recording-playback">
                <video
                  ref={player}
                  controls
                  src={url}
                  aria-label={t("fcboard.recording_playback")}
                  className={active.mode === "audio" ? "is-audio" : ""}
                />
                <a
                  href={url}
                  download={`Fcboard-${active.id}.${
                    active.blob.type.includes("mp4") ? "mp4" : "webm"
                  }`}
                >
                  {t("fcboard.download_recording")}
                </a>
              </div>
            )}
          </>
        )}
        <Menu
          anchorEl={menu}
          open={!!menu}
          onClose={() => setMenu(null)}
          disablePortal
        >
          <MenuItem
            onClick={() => {
              setNotes(
                lines
                  .map((line) => `${timestamp(line.time)} ${line.text}`)
                  .join("\n"),
              );
              setEditing(true);
              setMenu(null);
            }}
          >
            {t("buttons.edit")}
          </MenuItem>
          <MenuItem
            onClick={() => {
              setMenu(null);
              props.onDelete();
            }}
          >
            {t("fcboard.delete_recording")}
          </MenuItem>
        </Menu>
        {editing && (
          <div className="fc-recording-notes">
            <TextField
              multiline
              minRows={3}
              maxRows={6}
              fullWidth
              label={t(
                "fcboard.add_transcript_one_paragraph_per_line_optional_00_30_timestamp",
              )}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
            <Button
              disabled={props.busy || !notes.trim()}
              onClick={() => {
                props.onNotes(notes);
                setEditing(false);
              }}
            >
              {t("fcboard.save_transcript_notes")}
            </Button>
            <Button onClick={() => setEditing(false)}>
              {t("buttons.cancel")}
            </Button>
          </div>
        )}
      </main>
    </div>
  );
};
