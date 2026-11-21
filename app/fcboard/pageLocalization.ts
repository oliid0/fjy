import { getLanguage, t } from "@fcboard/fcboard/i18n";

export type PageLocalization = {
  language: string;
  strings: Record<string, string>;
};
export const pageLocalization = (): PageLocalization => ({
  language: getLanguage().code,
  strings: {
    voteTitle: t("fcboard.remotePages.voteTitle"),
    connecting: t("fcboard.remotePages.connecting"),
    submit: t("fcboard.remotePages.submit"),
    requestFailed: t("fcboard.remotePages.requestFailed"),
    participants: t("fcboard.remotePages.participants"),
    ended: t("fcboard.remotePages.ended"),
    votes: t("fcboard.remotePages.votes"),
    multiple: t("fcboard.remotePages.multiple"),
    single: t("fcboard.remotePages.single"),
    chooseOption: t("fcboard.remotePages.chooseOption"),
    submitting: t("fcboard.remotePages.submitting"),
    submitted: t("fcboard.remotePages.submitted"),
    shareTitle: t("fcboard.remotePages.shareTitle"),
    password: t("fcboard.remotePages.password"),
    confirm: t("fcboard.remotePages.confirm"),
    incorrectPassword: t("fcboard.remotePages.incorrectPassword"),
    pageShareTitle: t("fcboard.remotePages.pageShareTitle"),
    shareExpiry: t("fcboard.remotePages.shareExpiry"),
    page: t("fcboard.remotePages.page"),
    downloadPage: t("fcboard.remotePages.downloadPage"),
    boardPage: t("fcboard.remotePages.boardPage"),
    transferTitle: t("fcboard.remotePages.transferTitle"),
    transferHint: t("fcboard.remotePages.transferHint"),
    chooseFiles: t("fcboard.remotePages.chooseFiles"),
    chooseFilesFirst: t("fcboard.remotePages.chooseFilesFirst"),
    fileTooLarge: t("fcboard.remotePages.fileTooLarge"),
    sending: t("fcboard.remotePages.sending"),
    sent: t("fcboard.remotePages.sent"),
    transferFailed: t("fcboard.remotePages.transferFailed"),
  },
});
