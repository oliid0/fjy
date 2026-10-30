import { t } from "@fcboard/fcboard/i18n";

import type { TranslationKeys } from "@fcboard/fcboard/i18n";

import source from "./factory-resource-menus.json";

export type ResourceMenu = {
  id: string;
  titleKey: string;
  action?: string;
  items?: string[];
  sections?: ResourceMenu[];
  tabs?: ResourceMenu[];
  groups?: { titleKey: string; items: string[] }[];
};
/** TeachingResWindow's visible order and TeachingResDataProvider's actual lists. */
export const factoryResourceSubjects: ResourceMenu[] = source.subjects;
export const resourceMenuTitle = (key: string) =>
  t(`fcboard.resourceMenu.${key}` as TranslationKeys);

export const resourceMenuSelection = (
  category: string,
  sectionId?: string,
  tabId?: string,
) => {
  const subject = factoryResourceSubjects.find((item) => item.id === category);
  const section =
    subject?.sections?.find((item) => item.id === sectionId) ??
    subject?.sections?.[0];
  const tab =
    section?.tabs?.find((item) => item.id === tabId) ?? section?.tabs?.[0];
  return { subject, section, tab, content: tab ?? section ?? subject };
};
