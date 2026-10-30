import catalogue from "./factory-resources.json";
import source from "./factory-resource-menus.json";
import {
  factoryResourceSubjects,
  resourceMenuSelection,
} from "./resourceMenus";

import type { ResourceMenu } from "./resourceMenus";

it("places all 242 original resources in exactly one original section, tab or biological stage group", () => {
  const assigned: string[] = [];
  const visit = (menu: ResourceMenu) => {
    assigned.push(...(menu.items ?? []));
    menu.groups?.forEach((group) => assigned.push(...group.items));
    menu.sections?.forEach(visit);
    menu.tabs?.forEach(visit);
  };
  factoryResourceSubjects.forEach(visit);
  expect(assigned).toHaveLength(242);
  expect(new Set(assigned).size).toBe(assigned.length);
  expect(new Set(assigned)).toEqual(
    new Set(catalogue.items.map((item) => item.id)),
  );
  expect(source.source.providerSha256).toBe(catalogue.source.providerSha256);
  expect(factoryResourceSubjects.map((item) => item.id)).toEqual([
    "math",
    "physics",
    "chemistry",
    "biology",
    "geography_weather",
    "other",
    "function",
    "web",
  ]);
});

it("retains the original seven physics experiment tabs and keeps the chemistry quantum list in chemistry", () => {
  const physics = resourceMenuSelection("physics");
  expect(physics.section?.id).toBe("experiment");
  expect(physics.tab?.id).toBe("1");
  expect(physics.section?.tabs?.map((tab) => tab.items?.length)).toEqual([
    10, 7, 7, 2, 9, 3, 12,
  ]);
  const chemistry = resourceMenuSelection("chemistry", "experiment", "2");
  expect(chemistry.content?.items).toEqual([
    "chemistry:teach_res_item_blackbody_radiation__09de1388",
  ]);
  expect(
    catalogue.items.find((item) => item.id === chemistry.content?.items?.[0])
      ?.category,
  ).toBe("chemistry");
});

it("keeps repeated biological stage names attached to their actual distinct diagrams", () => {
  const division = resourceMenuSelection("biology", "division").content!;
  expect(division.groups?.map((group) => group.items.length)).toEqual([
    5, 5, 4,
  ]);
  expect(
    division.groups?.map((group) =>
      group.items.find((id) => id.includes("_prophase__")),
    ),
  ).toEqual([
    "biology:teach_res_item_prophase__cell_division_mitosis_prophase",
    "biology:teach_res_item_prophase__cell_division_meiosis1_prophase",
    "biology:teach_res_item_prophase__cell_division_meiosis2_prophase",
  ]);
  expect(
    resourceMenuSelection("biology", "natural").content?.groups?.map(
      (group) => group.items.length,
    ),
  ).toEqual([6, 4, 7]);
  expect(
    resourceMenuSelection("biology", "digestive").content?.items,
  ).toContain("biology:teach_res_item_stomach__digestive_stomach");
  expect(resourceMenuSelection("biology", "organs").content?.items).toContain(
    "biology:teach_res_item_stomach__body_stomach",
  );
});
