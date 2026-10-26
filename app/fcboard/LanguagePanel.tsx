import { useEffect, useRef, useState } from "react";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import CircularProgress from "@mui/material/CircularProgress";
import { getLanguage, t, useI18n } from "@excalidraw/excalidraw/i18n";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { MaterialPanel } from "./MaterialPanel";
import { TransientMessage } from "./TransientMessage";
import { classroomCommands } from "./commands";
import { boardInk } from "./digitalInk";
import {
  explainLanguage,
  languageInkSignature,
  parseLanguageStudy,
} from "./languageStudy";

import type { InkStroke } from "./documents";
import type { LanguageInk, LanguageStudy } from "./languageStudy";

/** Only the visible surface owns a card. Its source ink is checked on every change. */
export const readLanguageCard = (api: ExcalidrawImperativeAPI, id: string) => {
  const doc = classroomCommands.read("document") as
    | { name: string; page: number; ink: InkStroke[] }
    | undefined;
  let metadata: LanguageInk | undefined;
  let signature = "";
  if (doc) {
    const group = doc.ink.find((stroke) => stroke.id === id)?.language?.group;
    if (!group) {
      return;
    }
    const source = doc.ink.filter(
      (stroke) => stroke.language?.group === group && stroke.language.source,
    );
    metadata = source.find((stroke) => stroke.language?.study)?.language;
    signature = languageInkSignature(source.map((stroke) => stroke.points));
  } else {
    const scene = api
      .getSceneElements()
      .filter((element) => !element.isDeleted);
    const group = scene.find((element) => element.id === id)?.customData
      ?.fcLanguage?.group;
    if (!group) {
      return;
    }
    const source = scene.filter(
      (element) =>
        element.customData?.fcLanguage?.group === group &&
        element.customData?.fcLanguage?.source,
    );
    metadata = source.find((element) => element.customData?.fcLanguage?.study)
      ?.customData?.fcLanguage;
    signature = languageInkSignature(boardInk(source));
  }
  if (!metadata?.study || !signature || metadata.signature !== signature) {
    return;
  }
  try {
    return {
      study: parseLanguageStudy(JSON.stringify(metadata.study)),
      targetLanguage: metadata.targetLanguage,
      token: JSON.stringify([
        doc ? [doc.name, doc.page] : api.id,
        metadata.group,
        signature,
      ]),
    };
  } catch {}
};

export const LanguagePanel = ({ api }: { api: ExcalidrawImperativeAPI }) => {
  const { langCode } = useI18n();
  const [card, setCard] = useState<{
    id: string;
    token: string;
    study: LanguageStudy;
  }>();
  const [tab, setTab] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | undefined>(undefined);
  const translations = useRef(new Map<string, LanguageStudy>());
  const close = () => {
    request.current?.abort();
    setCard(undefined);
    setBusy(false);
  };
  useEffect(() => {
    close();
    return () => request.current?.abort();
  }, [langCode, api]);
  useEffect(() =>
    classroomCommands.register(
      "language.card",
      "Open the learning card for an existing language-pen object. args.id is its visible object id.",
      async (args) => {
        const id = typeof args.id === "string" ? args.id : "";
        const source = readLanguageCard(api, id);
        if (!source) {
          throw new Error(
            t("fcboard.circle_the_word_or_sentence_to_study_first"),
          );
        }
        request.current?.abort();
        const controller = new AbortController();
        request.current = controller;
        const target = getLanguage().code;
        const key = `${source.token}:${target}`;
        setError("");
        setCard({ id, token: source.token, study: source.study });
        setBusy(
          source.targetLanguage !== target && !translations.current.has(key),
        );
        try {
          const study =
            source.targetLanguage === target
              ? source.study
              : translations.current.get(key) ||
                (await explainLanguage(
                  source.study.term,
                  controller.signal,
                  target,
                ));
          controller.signal.throwIfAborted();
          if (
            readLanguageCard(api, id)?.token !== source.token ||
            target !== getLanguage().code
          ) {
            throw new DOMException("Language ink changed", "AbortError");
          }
          if (translations.current.size >= 16) {
            translations.current.clear();
          }
          translations.current.set(key, study);
          setTab(0);
          setCard({ id, token: source.token, study });
          setBusy(false);
          return study;
        } catch (failure) {
          if (
            !controller.signal.aborted &&
            !(failure instanceof DOMException && failure.name === "AbortError")
          ) {
            setError(
              failure instanceof Error ? failure.message : String(failure),
            );
          }
          if (request.current === controller) {
            close();
          }
          throw failure;
        }
      },
    ),
  );
  useEffect(() => {
    const changed = () => {
      if (card && readLanguageCard(api, card.id)?.token !== card.token) {
        close();
      }
    };
    const stops = [
      api.onChange(changed),
      classroomCommands.watch("document", changed),
      classroomCommands.onInvalidate(close),
    ];
    return () => stops.forEach((stop) => stop());
  }, [api, card]);
  return (
    <>
      {card && (
        <MaterialPanel
          centered
          role="dialog"
          aria-label={t("fcboard.language_study")}
          onDismiss={close}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            close();
          }}
        >
          <Box
            sx={{
              width: "min(660px, calc(100vw - 64px))",
              boxSizing: "border-box",
              maxHeight: "calc(100dvh - 64px)",
              overflow: "auto",
              p: { xs: 2, sm: 3 },
              overflowWrap: "anywhere",
            }}
          >
            <Box sx={{ display: "flex", alignItems: "start", gap: 2, mb: 1 }}>
              <h2
                style={{
                  flex: 1,
                  margin: 0,
                  fontSize: "1.25rem",
                  whiteSpace: "pre-wrap",
                }}
              >
                {card.study.term}
              </h2>
              <Button onClick={close}>{t("buttons.close")}</Button>
            </Box>
            {busy ? (
              <Box sx={{ py: 3, textAlign: "center" }}>
                <CircularProgress
                  size={24}
                  aria-label={t("fcboard.analyzing_language")}
                />
              </Box>
            ) : (
              <>
                <p style={{ whiteSpace: "pre-wrap" }}>
                  {card.study.translation}
                </p>
                <Tabs
                  value={tab}
                  onChange={(_, value) => setTab(value)}
                  variant="scrollable"
                  allowScrollButtonsMobile
                >
                  <Tab label={t("fcboard.language_study")} />
                  <Tab label={t("fcboard.word_and_sentence_structure")} />
                  <Tab label={t("fcboard.example")} />
                </Tabs>
                <Box
                  role="tabpanel"
                  sx={{ py: 2, lineHeight: 1.7, whiteSpace: "pre-wrap" }}
                >
                  {tab === 0 && (
                    <>
                      {card.study.pronunciation && (
                        <p>
                          {t("fcboard.pronunciation")}:{" "}
                          {card.study.pronunciation}
                        </p>
                      )}
                      {card.study.syllables && (
                        <p>
                          {t("fcboard.syllables")}: {card.study.syllables}
                        </p>
                      )}
                      {card.study.meanings.map((meaning, index) => (
                        <p key={index}>
                          <b>{meaning.partOfSpeech}</b> {meaning.definition}
                        </p>
                      ))}
                    </>
                  )}
                  {tab === 1 && (
                    <>
                      <p>{card.study.grammar}</p>
                      <p>{card.study.usage}</p>
                    </>
                  )}
                  {tab === 2 &&
                    card.study.examples.map((example, index) => (
                      <p key={index}>
                        {example.text}
                        <br />
                        {example.translation}
                      </p>
                    ))}
                </Box>
              </>
            )}
          </Box>
        </MaterialPanel>
      )}
      {error && <TransientMessage message={error} />}
    </>
  );
};
