/**
 * Shared veg-mode helpers for the Food user module.
 * When vegMode is ON, non-veg categories/dishes must never surface in browse UI.
 * When option is "pure-vegan", only explicitly Vegan dishes / pure-vegan restaurants.
 */

export const normalizeVegModeOption = (value) => {
  if (value === "pure-veg" || value === "pure-vegan") return value
  return "all"
}

export const isVegMenuItem = (item) => {
  if (!item || typeof item !== "object") return false

  const foodType = String(
    item.foodType || item.categoryDishFoodType || item.type || "",
  )
    .trim()
    .toLowerCase()

  if (foodType === "veg" || foodType === "vegan") return true
  if (
    foodType === "non-veg" ||
    foodType === "non veg" ||
    foodType === "nonveg" ||
    foodType.includes("non")
  ) {
    return false
  }

  if (item.isVeg === true) return true
  if (item.isVeg === false) return false

  // Unknown diet — hide in veg mode rather than showing chicken/non-veg by mistake
  return false
}

/** Fail-closed: only explicit Vegan foodType (or isVegan true) counts. */
export const isVeganMenuItem = (item) => {
  if (!item || typeof item !== "object") return false

  const foodType = String(
    item.foodType || item.categoryDishFoodType || item.type || "",
  )
    .trim()
    .toLowerCase()

  if (foodType === "vegan") return true
  if (item.isVegan === true) return true
  return false
}

export const isNonVegCategoryScope = (cat) => {
  const scope = String(cat?.foodTypeScope || cat?.type || cat?.foodType || "")
    .toLowerCase()
    .trim()
  if (scope === "non-veg" || scope === "nonveg" || scope === "non veg") return true

  const name = String(cat?.name || cat?.label || cat?.title || "")
    .toLowerCase()
    .trim()
  return /\b(chicken|mutton|non[\s-]?veg|seafood|fish|prawn|meat|keema|egg)\b/.test(
    name,
  )
}

export const filterCategoriesForVegMode = (
  categories = [],
  vegMode = false,
  vegModeOption = "all",
) => {
  if (!vegMode) return Array.isArray(categories) ? categories : []
  return (Array.isArray(categories) ? categories : []).filter(
    (cat) => !isNonVegCategoryScope(cat),
  )
}

export const filterDishesForVegMode = (
  dishes = [],
  vegMode = false,
  vegModeOption = "all",
) => {
  if (!vegMode) return Array.isArray(dishes) ? dishes : []
  const option = normalizeVegModeOption(vegModeOption)
  if (option === "pure-vegan") {
    return (Array.isArray(dishes) ? dishes : []).filter(isVeganMenuItem)
  }
  return (Array.isArray(dishes) ? dishes : []).filter(isVegMenuItem)
}

/**
 * Restaurant visibility for vegMode + vegModeOption.
 * - vegMode OFF → all restaurants
 * - option "all" → all restaurants (dishes filtered elsewhere)
 * - option "pure-veg" → pure-veg OR pure-vegan restaurants (menu evidence wins)
 * - option "pure-vegan" → only pure-vegan restaurants
 */
export const matchesVegRestaurantFilter = (
  restaurant,
  { vegMode = false, vegModeOption = "all" } = {},
) => {
  if (!vegMode) return true
  const option = normalizeVegModeOption(vegModeOption)

  if (option === "pure-vegan") {
    if (restaurant?.isPureVegan === false) return false
    if (restaurant?.isPureVegan === true) return true
    return (
      restaurant?.pureVeganRestaurant === true ||
      restaurant?.diningSettings?.pureVeganRestaurant === true
    )
  }

  if (option !== "pure-veg") return true

  if (restaurant?.hasNonVegMenu === true) return false
  if (restaurant?.isPureVeg === true) return true
  if (restaurant?.isPureVegan === true) return true
  if (restaurant?.hasNonVegMenu === false) return true

  return (
    restaurant?.pureVegRestaurant === true ||
    restaurant?.pureVeganRestaurant === true ||
    restaurant?.diningSettings?.pureVegRestaurant === true ||
    restaurant?.diningSettings?.pureVeganRestaurant === true
  )
}

export const filterRestaurantsForVegMode = (
  restaurants = [],
  { vegMode = false, vegModeOption = "all" } = {},
) => {
  const list = Array.isArray(restaurants) ? restaurants : []
  if (!vegMode) return list
  return list.filter((r) =>
    matchesVegRestaurantFilter(r, { vegMode, vegModeOption }),
  )
}
