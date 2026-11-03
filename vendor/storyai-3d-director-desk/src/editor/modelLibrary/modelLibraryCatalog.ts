import { createTranslator, t, type MessageKey } from '../../i18n';
export type ModelLibraryCategoryId = "convenience" | "home" | "outdoor" | "tools" | "my-models";

export type ModelLibraryCategory = {
  directoryName: string;
  id: ModelLibraryCategoryId;
  label: string;
};

export type ModelLibraryItem = {
  categoryId: ModelLibraryCategoryId;
  fileName: string;
  id: string;
  name: string;
  thumbUrl?: string;
  url: string;
};

export const MODEL_LIBRARY_CATEGORIES: ModelLibraryCategory[] = [
  { id: "convenience", label: t("director.modelCategory.convenience"), directoryName: "便利生活" },
  { id: "home", label: t("director.modelCategory.home"), directoryName: "生活家居" },
  { id: "outdoor", label: t("director.modelCategory.outdoor"), directoryName: "户外出行" },
  { id: "tools", label: t("director.modelCategory.tools"), directoryName: "工具配件" },
  { id: "my-models", label: t("director.modelCategory.my-models"), directoryName: "" },
];

const modelLibraryModules = import.meta.glob("../../../../模型库/**/*.fbx", {
  eager: true,
  import: "default",
  query: "?url",
}) as Record<string, string>;

const convenienceThumbnailModules = import.meta.glob(
  [
    "../../../../模型库/便利生活/缩略图/*.png",
    "../../../../模型库/便利生活/缩略图/*.jpg",
    "../../../../模型库/便利生活/缩略图/*.jpeg",
    "../../../../模型库/便利生活/缩略图/*.webp",
  ],
  {
    eager: true,
    import: "default",
    query: "?url",
  }
) as Record<string, string>;

const homeThumbnailModules = import.meta.glob(
  [
    "../../../../模型库/生活家居/缩略图/*.png",
    "../../../../模型库/生活家居/缩略图/*.jpg",
    "../../../../模型库/生活家居/缩略图/*.jpeg",
    "../../../../模型库/生活家居/缩略图/*.webp",
  ],
  {
    eager: true,
    import: "default",
    query: "?url",
  }
) as Record<string, string>;

const outdoorThumbnailModules = import.meta.glob(
  [
    "../../../../模型库/户外出行/缩略图/*.png",
    "../../../../模型库/户外出行/缩略图/*.jpg",
    "../../../../模型库/户外出行/缩略图/*.jpeg",
    "../../../../模型库/户外出行/缩略图/*.webp",
  ],
  {
    eager: true,
    import: "default",
    query: "?url",
  }
) as Record<string, string>;

const toolsThumbnailModules = import.meta.glob(
  [
    "../../../../模型库/工具配件/缩略图/*.png",
    "../../../../模型库/工具配件/缩略图/*.jpg",
    "../../../../模型库/工具配件/缩略图/*.jpeg",
    "../../../../模型库/工具配件/缩略图/*.webp",
  ],
  {
    eager: true,
    import: "default",
    query: "?url",
  }
) as Record<string, string>;

const MODEL_LIBRARY_NAME_MAP: Partial<Record<string, MessageKey>> = {
  "2_liter_low.fbx": "director.model.2_liter_low",
  "A_sign_low.fbx": "director.model.A_sign_low",
  "ATM_low.fbx": "director.model.ATM_low",
  "arcade_low.fbx": "director.model.arcade_low",
  "back_saw_low.fbx": "director.model.back_saw_low",
  "backpack_low.fbx": "director.model.backpack_low",
  "bandsaw_low.fbx": "director.model.bandsaw_low",
  "basket_low.fbx": "director.model.basket_low",
  "basketball_hoop_low.fbx": "director.model.basketball_hoop_low",
  "bathroom_sink_low.fbx": "director.model.bathroom_sink_low",
  "bathtub_low.fbx": "director.model.bathtub_low",
  "bed_low.fbx": "director.model.bed_low",
  "beer_bottles_low.fbx": "director.model.beer_bottles_low",
  "beer_cans_low.fbx": "director.model.beer_cans_low",
  "belt_sander_low.fbx": "director.model.belt_sander_low",
  "big_gulper_low.fbx": "director.model.big_gulper_low",
  "binoculars_low.fbx": "director.model.binoculars_low",
  "bleach_low.fbx": "director.model.bleach_low",
  "book_shelf_low.fbx": "director.model.book_shelf_low",
  "bucket_low.fbx": "director.model.bucket_low",
  "bunk_bed_low.fbx": "director.model.bunk_bed_low",
  "bunny_low.fbx": "director.model.bunny_low",
  "cabinet_low.fbx": "director.model.cabinet_low",
  "cactus_low.fbx": "director.model.cactus_low",
  "camper_low.fbx": "director.model.camper_low",
  "camping_stove_low.fbx": "director.model.camping_stove_low",
  "canoe_low.fbx": "director.model.canoe_low",
  "canteen_low.fbx": "director.model.canteen_low",
  "carton_low.fbx": "director.model.carton_low",
  "cash_register_low.fbx": "director.model.cash_register_low",
  "cat_low.fbx": "director.model.cat_low",
  "ceiling_fan_low.fbx": "director.model.ceiling_fan_low",
  "cereal_box_low.fbx": "director.model.cereal_box_low",
  "chair_low.fbx": "director.model.chair_low",
  "charcoal_grill_low.fbx": "director.model.charcoal_grill_low",
  "cigarettes_and_lighter_low.fbx": "director.model.cigarettes_and_lighter_low",
  "cleaner_spray_low.fbx": "director.model.cleaner_spray_low",
  "coffee_carafe_low.fbx": "director.model.coffee_carafe_low",
  "coffee_cup_low.fbx": "director.model.coffee_cup_low",
  "coffee_maker_low.fbx": "director.model.coffee_maker_low",
  "coffee_table_low.fbx": "director.model.coffee_table_low",
  "computer_low.fbx": "director.model.computer_low",
  "condiment_dispenser_low.fbx": "director.model.condiment_dispenser_low",
  "cooking_pot_low.fbx": "director.model.cooking_pot_low",
  "cooler_low.fbx": "director.model.cooler_low",
  "couch_low.fbx": "director.model.couch_low",
  "credit_card_machine_low.fbx": "director.model.credit_card_machine_low",
  "crowbar_low.fbx": "director.model.crowbar_low",
  "cup_dispenser_low.fbx": "director.model.cup_dispenser_low",
  "deer_skull_low.fbx": "director.model.deer_skull_low",
  "desk_chair_low.fbx": "director.model.desk_chair_low",
  "desk_lamp_low.fbx": "director.model.desk_lamp_low",
  "desk_low.fbx": "director.model.desk_low",
  "detergent_low.fbx": "director.model.detergent_low",
  "dishwasher_low.fbx": "director.model.dishwasher_low",
  "display_cooler_low.fbx": "director.model.display_cooler_low",
  "door_low.fbx": "director.model.door_low",
  "dresser_low.fbx": "director.model.dresser_low",
  "drill_press_low.fbx": "director.model.drill_press_low",
  "drink_fridge_low.fbx": "director.model.drink_fridge_low",
  "dryer_low.fbx": "director.model.dryer_low",
  "energy_can_low.fbx": "director.model.energy_can_low",
  "entertainment_system_low.fbx": "director.model.entertainment_system_low",
  "fence_low.fbx": "director.model.fence_low",
  "fire_low.fbx": "director.model.fire_low",
  "fish_low.fbx": "director.model.fish_low",
  "fish_tank_low.fbx": "director.model.fish_tank_low",
  "fishing_pole_low.fbx": "director.model.fishing_pole_low",
  "flashlight_low.fbx": "director.model.flashlight_low",
  "folding_chair_low.fbx": "director.model.folding_chair_low",
  "foosball_table_low.fbx": "director.model.foosball_table_low",
  "french_press_low.fbx": "director.model.french_press_low",
  "glass_soda_bottle_low.fbx": "director.model.glass_soda_bottle_low",
  "grill_low.fbx": "director.model.grill_low",
  "Guitar_low.fbx": "director.model.Guitar_low",
  "hammer_low.fbx": "director.model.hammer_low",
  "hand_saw_low.fbx": "director.model.hand_saw_low",
  "hatchet_low.fbx": "director.model.hatchet_low",
  "hotdog_roaster_low.fbx": "director.model.hotdog_roaster_low",
  "Ice_cream_machine_low.fbx": "director.model.Ice_cream_machine_low",
  "Icebox_low.fbx": "director.model.Icebox_low",
  "Jar_low.fbx": "director.model.Jar_low",
  "juice_bottle_low.fbx": "director.model.juice_bottle_low",
  "juice_machine_low.fbx": "director.model.juice_machine_low",
  "kayak_low.fbx": "director.model.kayak_low",
  "ketchup_bottle_low.fbx": "director.model.ketchup_bottle_low",
  "kettle_low.fbx": "director.model.kettle_low",
  "kitchen_sink_low.fbx": "director.model.kitchen_sink_low",
  "lantern_low.fbx": "director.model.lantern_low",
  "laundry_basket_low.fbx": "director.model.laundry_basket_low",
  "lighter_fluid_low.fbx": "director.model.lighter_fluid_low",
  "lounge_chair_low.fbx": "director.model.lounge_chair_low",
  "magazine_rack_low.fbx": "director.model.magazine_rack_low",
  "mailbox_low.fbx": "director.model.mailbox_low",
  "metal_canister_low.fbx": "director.model.metal_canister_low",
  "microwave_low.fbx": "director.model.microwave_low",
  "milk_low.fbx": "director.model.milk_low",
  "mixer_low.fbx": "director.model.mixer_low",
  "motor_oil_low.fbx": "director.model.motor_oil_low",
  "mustard_low.fbx": "director.model.mustard_low",
  "nightstand_low.fbx": "director.model.nightstand_low",
  "oil_additive_low.fbx": "director.model.oil_additive_low",
  "open_sign_low.fbx": "director.model.open_sign_low",
  "paint_can_low.fbx": "director.model.paint_can_low",
  "paint_roller_low.fbx": "director.model.paint_roller_low",
  "pastry_case_low.fbx": "director.model.pastry_case_low",
  "picnic_table_low.fbx": "director.model.picnic_table_low",
  "picture_frame_low.fbx": "director.model.picture_frame_low",
  "pipe_wrench_low.fbx": "director.model.pipe_wrench_low",
  "plant_low.fbx": "director.model.plant_low",
  "plastic_bottle_low.fbx": "director.model.plastic_bottle_low",
  "plastic_water_bottle_low.fbx": "director.model.plastic_water_bottle_low",
  "pliers_low.fbx": "director.model.pliers_low",
  "popcicle_freezer_low.fbx": "director.model.popcicle_freezer_low",
  "power_drill_low.fbx": "director.model.power_drill_low",
  "pretzel_warmer_low.fbx": "director.model.pretzel_warmer_low",
  "radiator_low.fbx": "director.model.radiator_low",
  "record_low.fbx": "director.model.record_low",
  "refrigerator_low.fbx": "director.model.refrigerator_low",
  "rotisserie_chicken_low.fbx": "director.model.rotisserie_chicken_low",
  "rubber_ducky_low.fbx": "director.model.rubber_ducky_low",
  "saw_horse_low.fbx": "director.model.saw_horse_low",
  "scratch_awl_low.fbx": "director.model.scratch_awl_low",
  "screw_drivers_low.fbx": "director.model.screw_drivers_low",
  "security_camera_low.fbx": "director.model.security_camera_low",
  "shelf_1_low.fbx": "director.model.shelf_1_low",
  "shelf_2_low.fbx": "director.model.shelf_2_low",
  "shelf_low.fbx": "director.model.shelf_low",
  "shop_broom_low.fbx": "director.model.shop_broom_low",
  "shop_drawer_low.fbx": "director.model.shop_drawer_low",
  "shop_light_low.fbx": "director.model.shop_light_low",
  "shop_vac_low.fbx": "director.model.shop_vac_low",
  "shovel_low.fbx": "director.model.shovel_low",
  "shower_low.fbx": "director.model.shower_low",
  "skewers_low.fbx": "director.model.skewers_low",
  "skull_n_bones_low.fbx": "director.model.skull_n_bones_low",
  "sledge_hammer_low.fbx": "director.model.sledge_hammer_low",
  "sleeping_bags_low.fbx": "director.model.sleeping_bags_low",
  "slurpy_cup_low.fbx": "director.model.slurpy_cup_low",
  "slurpy_machine_low.fbx": "director.model.slurpy_machine_low",
  "small_clamp_low.fbx": "director.model.small_clamp_low",
  "soap_low.fbx": "director.model.soap_low",
  "soda_can_low.fbx": "director.model.soda_can_low",
  "soda_cup_low.fbx": "director.model.soda_cup_low",
  "soda_machine_low.fbx": "director.model.soda_machine_low",
  "speaker_low.fbx": "director.model.speaker_low",
  "spraypaint_low.fbx": "director.model.spraypaint_low",
  "standing_lamp_low.fbx": "director.model.standing_lamp_low",
  "stool_low.fbx": "director.model.stool_low",
  "stove_low.fbx": "director.model.stove_low",
  "straw_dispenser_low.fbx": "director.model.straw_dispenser_low",
  "stump_low.fbx": "director.model.stump_low",
  "syrup_bottle_low.fbx": "director.model.syrup_bottle_low",
  "table_&_chairs_low.fbx": "director.model.table_&_chairs_low",
  "table_clamp_low.fbx": "director.model.table_clamp_low",
  "table_lamp_low.fbx": "director.model.table_lamp_low",
  "tape_measure_low.fbx": "director.model.tape_measure_low",
  "telescope_low.fbx": "director.model.telescope_low",
  "tent_1_low.fbx": "director.model.tent_1_low",
  "tent_2_low.fbx": "director.model.tent_2_low",
  "tent_3_low.fbx": "director.model.tent_3_low",
  "tent_4_low.fbx": "director.model.tent_4_low",
  "thermus_low.fbx": "director.model.thermus_low",
  "Tin_Can_low.fbx": "director.model.Tin_Can_low",
  "tin_mug_low.fbx": "director.model.tin_mug_low",
  "toilet_low.fbx": "director.model.toilet_low",
  "trashcan_low.fbx": "director.model.trashcan_low",
  "tree_saw_low.fbx": "director.model.tree_saw_low",
  "tuna_can_low.fbx": "director.model.tuna_can_low",
  "tv_low.fbx": "director.model.tv_low",
  "vacuum_low.fbx": "director.model.vacuum_low",
  "vending_machine_low.fbx": "director.model.vending_machine_low",
  "vice_low.fbx": "director.model.vice_low",
  "washer_low.fbx": "director.model.washer_low",
  "water_tank_low.fbx": "director.model.water_tank_low",
  "watering_can_low.fbx": "director.model.watering_can_low",
  "window_low.fbx": "director.model.window_low",
  "wood_chizel_low.fbx": "director.model.wood_chizel_low",
  "workbench_low.fbx": "director.model.workbench_low",
  "wrench_low.fbx": "director.model.wrench_low",
};

const MODEL_LIBRARY_THUMB_NAME_MAP: Record<string, string> = {
  "condiment_dispenser_low.fbx": "配料分配器",
  "detergent_low.fbx": "洗调剂",
  "display_cooler_low.fbx": "展示冰柜",
};

function createModelName(fileName: string) {
  const mappedName = MODEL_LIBRARY_NAME_MAP[fileName];
  if (mappedName) return t(mappedName);

  return fileName
    .replace(/\.(fbx|obj)$/i, "")
    .replace(/_low$/i, "")
    .replace(/_/g, " ")
    .replace(/\b[a-z]/g, (match) => match.toUpperCase());
}

function createModelThumbnailName(fileName: string) {
  const key = MODEL_LIBRARY_NAME_MAP[fileName];
  // Thumbnail basenames are physical Chinese asset names, independent of display locale.
  return MODEL_LIBRARY_THUMB_NAME_MAP[fileName] ?? (key ? createTranslator('zh-CN')(key) : createModelName(fileName));
}

export function getModelLibraryItems() {
  const categoriesByDirectory = new Map(
    MODEL_LIBRARY_CATEGORIES.map((category) => [category.directoryName, category])
  );
  const createThumbnailsByName = (thumbnailModules: Record<string, string>) =>
    new Map(
      Object.entries(thumbnailModules).map(([path, url]) => {
        const fileName = path.split("/").pop() ?? path;
        const thumbnailName = fileName.replace(/\.(png|jpe?g|webp)$/i, "");

        return [thumbnailName, url];
      })
    );
  const thumbnailsByCategoryId = new Map<ModelLibraryCategoryId, Map<string, string>>([
    ["convenience", createThumbnailsByName(convenienceThumbnailModules)],
    ["home", createThumbnailsByName(homeThumbnailModules)],
    ["outdoor", createThumbnailsByName(outdoorThumbnailModules)],
    ["tools", createThumbnailsByName(toolsThumbnailModules)],
  ]);

  return Object.entries(modelLibraryModules)
    .map(([path, url]) => {
      const [, directoryName, fileName] = path.match(/模型库\/([^/]+)\/([^/]+)$/) ?? [];
      if (!directoryName) return null;
      const category = categoriesByDirectory.get(directoryName);

      if (!category || !fileName) return null;
      const name = createModelName(fileName);
      const thumbUrl = thumbnailsByCategoryId.get(category.id)?.get(createModelThumbnailName(fileName));

      return {
        categoryId: category.id,
        fileName,
        id: `${category.id}:${fileName}`,
        name,
        url,
        ...(thumbUrl ? { thumbUrl } : {}),
      } satisfies ModelLibraryItem;
    })
    .filter((item): item is ModelLibraryItem => item !== null)
    .sort((a, b) => {
      const categoryIndexA = MODEL_LIBRARY_CATEGORIES.findIndex((category) => category.id === a.categoryId);
      const categoryIndexB = MODEL_LIBRARY_CATEGORIES.findIndex((category) => category.id === b.categoryId);

      if (categoryIndexA !== categoryIndexB) return categoryIndexA - categoryIndexB;

      return a.name.localeCompare(b.name);
    });
}
