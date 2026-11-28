import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import CircularProgress from "@mui/material/CircularProgress";
import { getLanguage, t, useI18n } from "@fcboard/fcboard/i18n";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { MaterialPanel } from "./MaterialPanel";
import { TransientMessage } from "./TransientMessage";
import { classroomCommands } from "./commands";
import { boardInk } from "./digitalInk";
import { selectionSignature } from "./selection";
import { languageInkSignature, parseLanguageStudy } from "./languageStudy";
import { createNarrator } from "./narration";
import { createStudyAudio } from "./studyAudio";

import type { InkStroke } from "./documents";
import type { LanguageInk, LanguageStudy } from "./languageStudy";

/** Only the visible surface owns a card. Its source ink is checked on every change. */
export const readLanguageCard = (api: FcboardImperativeAPI, id: string) => {
  const doc = classroomCommands.read("document") as
    | { name: string; page: number; ink: InkStroke[] }
    | undefined;
  let sourceIds: string[] = [];
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
    sourceIds = source.map((stroke) => stroke.id);
    metadata = source.find((stroke) => stroke.language?.signature)?.language;
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
    sourceIds = source.map((element) => element.id);
    metadata = source.find(
      (element) => element.customData?.fcLanguage?.signature,
    )?.customData?.fcLanguage;
    signature = languageInkSignature(boardInk(source));
  }
  if (!metadata || !signature || metadata.signature !== signature) {
    return;
  }
  try {
    return {
      sourceIds,
      study: metadata.study
        ? parseLanguageStudy(JSON.stringify(metadata.study), true)
        : undefined,
      targetLanguage: metadata.targetLanguage,
      token: JSON.stringify([
        doc ? [doc.name, doc.page] : api.id,
        metadata.group,
        signature,
      ]),
    };
  } catch {}
};

const selectionToken = (api: FcboardImperativeAPI, ids: string[]) => {
  const doc = classroomCommands.read("document") as
    | { name: string; page: number; ink: InkStroke[] }
    | undefined;
  const source = doc
    ? doc.ink.filter((item) => ids.includes(item.id))
    : api.getSceneElements().filter((item) => ids.includes(item.id));
  if (!ids.length || source.length !== new Set(ids).size) {
    return undefined;
  }
  return doc
    ? JSON.stringify([doc.name, doc.page, source])
    : selectionSignature(source as ReturnType<typeof api.getSceneElements>);
};

export const LanguagePanel = ({ api }: { api: FcboardImperativeAPI }) => {
  const { langCode } = useI18n();
  const [card, setCard] = useState<{
    id: string;
    token: string;
    study?: LanguageStudy;
    ids?: string[];
  }>();
  const [tab, setTab] = useState(0);
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [pronunciation] = useState(createNarrator);
  const [audio] = useState(createStudyAudio);
  const [error, setError] = useState("");
  const request = useRef<AbortController | undefined>(undefined);
  const translations = useRef(new Map<string, LanguageStudy>());
  const close = useCallback(() => {
    request.current?.abort();
    pronunciation.stop();
    audio.clear();
    setSpeaking(false);
    setCard(undefined);
    setBusy(false);
  }, [audio, pronunciation]);
  useEffect(() => {
    close();
    return () => {
      request.current?.abort();
      pronunciation.stop();
      audio.clear();
    };
  }, [langCode, api, close, audio, pronunciation]);
  useEffect(
    () =>
      classroomCommands.register(
        "language.card",
        "Open a language learning card for visible args.id or sourceIds; optional region limits OCR to the circled word or sentence. Reads actual source without inserting a translation.",
        async (args) => {
          const id = typeof args.id === "string" ? args.id : "";
          const ids =
            Array.isArray(args.sourceIds) &&
            args.sourceIds.every((value) => typeof value === "string")
              ? (args.sourceIds as string[])
              : [id];
          const linked =
            !args.region && args.sourceIds === undefined
              ? ids.map((id) => readLanguageCard(api, id))
              : [];
          const source =
            linked[0] &&
            linked.every((item) => item?.token === linked[0]?.token)
              ? linked[0]
              : undefined;
          const token = source?.token || selectionToken(api, ids);
          if (!token) {
            throw new Error(
              t("fcboard.circle_the_word_or_sentence_to_study_first"),
            );
          }
          close();
          const controller = new AbortController();
          const external =
            args.signal instanceof AbortSignal ? args.signal : undefined;
          external?.throwIfAborted();
          const abort = () => {
            controller.abort();
            if (request.current === controller) {
              close();
            }
          };
          external?.addEventListener("abort", abort, { once: true });
          request.current = controller;
          const target = getLanguage().code;
          const key = `${token}:${JSON.stringify(
            args.region || null,
          )}:${target}`;
          const readyStudy =
            source?.targetLanguage === target && !source.study?.backend
              ? source?.study
              : undefined;
          setError("");
          setCard({
            id: ids[0],
            token,
            study: readyStudy,
            ids: source ? undefined : ids,
          });
          setBusy(!readyStudy && !translations.current.has(key));
          try {
            let study: LanguageStudy;
            if (readyStudy) {
              study = readyStudy;
            } else if (translations.current.has(key)) {
              study = translations.current.get(key)!;
            } else {
              const result = (await classroomCommands.execute({
                name: "language.translate",
                args: {
                  sourceIds: source?.sourceIds || ids,
                  study: true,
                  region: args.region,
                  insert: false,
                  signal: controller.signal,
                  targetLanguage: target,
                },
              })) as { study: LanguageStudy };
              study = parseLanguageStudy(JSON.stringify(result.study), true);
            }
            controller.signal.throwIfAborted();
            if (
              (source
                ? readLanguageCard(api, ids[0])?.token
                : selectionToken(api, ids)) !== token ||
              target !== getLanguage().code
            ) {
              throw new DOMException("Language ink changed", "AbortError");
            }
            if (translations.current.size >= 16) {
              translations.current.clear();
            }
            translations.current.set(key, study);
            setTab(0);
            setCard({
              id: ids[0],
              token,
              study,
              ids: source ? undefined : ids,
            });
            setBusy(false);
            return study;
          } catch (failure) {
            if (
              !controller.signal.aborted &&
              !(
                failure instanceof DOMException && failure.name === "AbortError"
              )
            ) {
              setError(
                failure instanceof Error ? failure.message : String(failure),
              );
            }
            if (request.current === controller) {
              close();
            }
            throw failure;
          } finally {
            external?.removeEventListener("abort", abort);
          }
        },
      ),
    [api, close],
  );
  useEffect(() => {
    const changed = () => {
      if (
        card &&
        (card.ids
          ? selectionToken(api, card.ids)
          : readLanguageCard(api, card.id)?.token) !== card.token
      ) {
        close();
      }
    };
    const stops = [
      api.onChange(changed),
      classroomCommands.watch("document", changed),
      classroomCommands.onInvalidate(close),
    ];
    return () => stops.forEach((stop) => stop());
  }, [api, card, close]);
  return (
    <>
      {card && (
        <MaterialPanel
          centered
          role="dialog"
          aria-label={t("fcboard.language_study")}
          onDismiss={close}
          style={{ borderRadius: 24, overflow: "hidden" }}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            close();
          }}
        >
          <Box
            sx={{
              width: "min(460px, calc(100vw - 40px))",
              boxSizing: "border-box",
              maxHeight: "min(560px, calc(100dvh - 64px))",
              overflow: "auto",
              p: { xs: 2, sm: 3 },
              overflowWrap: "anywhere",
              fontSize: 14,
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
                {card.study?.term || t("fcboard.analyzing_language")}
              </h2>
              <Button onClick={close}>{t("buttons.close")}</Button>
            </Box>
            {busy || !card.study ? (
              <Box sx={{ py: 3, textAlign: "center" }}>
                <CircularProgress
                  size={24}
                  aria-label={t("fcboard.analyzing_language")}
                />
              </Box>
            ) : (
              <>
                <p
                  style={{
                    whiteSpace: "pre-wrap",
                    fontSize: 16,
                    lineHeight: 1.6,
                    margin: "14px 0",
                  }}
                >
                  {card.study.translation}
                </p>
                {!card.study.backend && (
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
                )}
                {!card.study.backend && (
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
                            <Button
                              disabled={speaking}
                              aria-busy={speaking}
                              onClick={async () => {
                                const study = card.study!;
                                const owner = request.current;
                                setSpeaking(true);
                                setError("");
                                try {
                                  await pronunciation.speak(study.term, {
                                    language: study.language,
                                    audio: (signal) =>
                                      audio.generate(
                                        study.term,
                                        study.language,
                                        signal,
                                      ),
                                  });
                                  await pronunciation.finished;
                                } catch (failure) {
                                  if (
                                    !owner?.signal.aborted &&
                                    request.current === owner
                                  ) {
                                    setError(
                                      failure instanceof Error
                                        ? failure.message
                                        : String(failure),
                                    );
                                  }
                                } finally {
                                  if (request.current === owner) {
                                    setSpeaking(false);
                                  }
                                }
                              }}
                            >
                              {speaking && <CircularProgress size={14} />}
                              {t("fcboard.pronunciation")}
                            </Button>
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
                        {!!card.study.synonyms?.length && (
                          <p>
                            {t("fcboard.synonyms")}:{" "}
                            {card.study.synonyms.join(" · ")}
                          </p>
                        )}
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
                )}
              </>
            )}
          </Box>
        </MaterialPanel>
      )}
      {error && <TransientMessage message={error} />}
    </>
  );
};
