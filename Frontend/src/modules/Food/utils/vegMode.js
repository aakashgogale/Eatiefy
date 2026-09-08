/**
 * Shared veg-mode helpers for the Food user module.
 * When vegMode is ON, non-veg categories/dishes must never surface in browse UI.
 * When option is "pure-vegan", only explicitly Vegan dishes / pure-vegan restaurants.
 */

/**
 * Vegan is currently DISABLED as a selectable food/menu preference.
 * Only Veg, Non-Veg and Mixed (Veg + Non-Veg) are offered.
 *
 * Nothing Vegan-related has been deleted — the matching helpers below and the
 * stored values in the database are left intact so existing Vegan records keep
 * reading correctly. Flip this back to `true` to re-enable the option.
 */
export const VEGAN_OPTION_ENABLED = false

export const normalizeVegModeOption = (value) => {
  // A "pure-vegan" value can still be sitting in localStorage from before the
  // option was disabled. Fold it back to "pure-veg" so it cannot reappear as a
  // selected mode after a refresh, instead of dropping the user to "all".
  if (!VEGAN_OPTION_ENABLED && value === "pure-vegan") return "pure-veg"
  if (value === "pure-veg" || value === "pure-vegan" || value === "non-veg") return value
  return "all"
}

export const isVegMenuItem = (item, context = {}) => {
  if (!item || typeof item !== "object") return false

  const foodType = String(
    item.foodType ||
      item.categoryDishFoodType ||
      item.matchedDishFoodType ||
      item.type ||
      item.food_type ||
      "",
  )
    .trim()
    .toLowerCase()

  if (
    foodType === "veg" ||
    foodType === "vegan" ||
    foodType === "vegetarian" ||
    foodType === "pure-veg" ||
    foodType === "pure veg" ||
    foodType === "pure-vegan" ||
    foodType === "pure vegan"
  ) {
    return true
  }

  if (
    foodType === "non-veg" ||
    foodType === "non veg" ||
    foodType === "nonveg" ||
    foodType === "egg" ||
    foodType.includes("non")
  ) {
    return false
  }

  if (
    item.isVeg === true ||
    item.isVeg === "true" ||
    item.isVeg === 1 ||
    item.isVegetarian === true ||
    item.isVegetarian === "true" ||
    item.isVegetarian === 1 ||
    item.isVegan === true ||
    item.isVegan === "true" ||
    item.isVegan === 1
  ) {
    return true
  }

  if (
    item.isVeg === false ||
    item.isVeg === "false" ||
    item.isVeg === 0 ||
    item.isVegetarian === false ||
    item.isVegetarian === "false" ||
    item.isVegetarian === 0
  ) {
    return false
  }

  const catScope = String(
    item.categoryFoodType ||
      item.foodTypeScope ||
      item.category?.foodTypeScope ||
      item.categoryScope ||
      "",
  )
    .trim()
    .toLowerCase()

  if (
    catScope === "veg" ||
    catScope === "vegan" ||
    catScope === "vegetarian" ||
    catScope === "pure-veg" ||
    catScope === "pure veg"
  ) {
    return true
  }
  if (
    catScope === "non-veg" ||
    catScope === "non veg" ||
    catScope === "nonveg"
  ) {
    return false
  }

  const isPureVegRestaurant =
    item.pureVegRestaurant === true ||
    item.isPureVeg === true ||
    item.pureVeganRestaurant === true ||
    item.isPureVegan === true ||
    item.restaurant?.pureVegRestaurant === true ||
    item.restaurant?.isPureVeg === true ||
    context?.pureVegRestaurant === true ||
    context?.isPureVeg === true ||
    context?.pureVeganRestaurant === true ||
    context?.isPureVegan === true

  if (isPureVegRestaurant) {
    return true
  }

  // Unknown diet — hide in veg mode rather than showing chicken/non-veg by mistake
  return false
}

/** Fail-closed: only explicit Vegan foodType (or isVegan true) counts. */
export const isVeganMenuItem = (item) => {
  if (!item || typeof item !== "object") return false

  const foodType = String(
    item.foodType ||
      item.categoryDishFoodType ||
      item.matchedDishFoodType ||
      item.type ||
      item.food_type ||
      "",
  )
    .trim()
    .toLowerCase()

  if (
    foodType === "vegan" ||
    foodType === "pure-vegan" ||
    foodType === "pure vegan"
  ) {
    return true
  }

  if (
    item.isVegan === true ||
    item.isVegan === "true" ||
    item.isVegan === 1
  ) {
    return true
  }

  return false
}

export const getCanonicalFoodType = (item, context = {}) => {
  if (isVeganMenuItem(item)) return "Vegan"
  if (isVegMenuItem(item, context)) return "Veg"
  return "Non-Veg"
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
  const option = normalizeVegModeOption(vegModeOption)
  if (option === "non-veg") return Array.isArray(categories) ? categories : []
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
  if (option === "non-veg") {
    return (Array.isArray(dishes) ? dishes : []).filter((d) => !isVegMenuItem(d))
  }
  return (Array.isArray(dishes) ? dishes : []).filter(isVegMenuItem)
}

/**
 * Restaurant visibility for vegMode + vegModeOption.
 * - vegMode OFF → all restaurants
 * - option "all" → all restaurants serving vegetarian food
 * - option "pure-veg" → pure-veg OR pure-vegan restaurants
 * - option "pure-vegan" → only pure-vegan restaurants
 * - option "non-veg" → restaurants serving non-veg food
 */
export const matchesVegRestaurantFilter = (
  restaurant,
  { vegMode = false, vegModeOption = "all" } = {},
) => {
  if (!vegMode) return true
  if (!restaurant || typeof restaurant !== "object") return false
  const option = normalizeVegModeOption(vegModeOption)

  if (option === "pure-vegan") {
    if (restaurant?.isPureVegan === false) return false
    if (restaurant?.isPureVegan === true) return true
    return (
      restaurant?.pureVeganRestaurant === true ||
      restaurant?.diningSettings?.pureVeganRestaurant === true
    )
  }

  if (option === "pure-veg") {
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

  if (option === "non-veg") {
    if (restaurant?.pureVegRestaurant === true) return false
    if (restaurant?.pureVeganRestaurant === true) return false
    if (restaurant?.isPureVeg === true) return false
    if (restaurant?.isPureVegan === true) return false
    if (restaurant?.diningSettings?.pureVegRestaurant === true) return false
    if (restaurant?.diningSettings?.pureVeganRestaurant === true) return false
    return true
  }

  // option === "all": Show all restaurants offering veg options
  if (restaurant?.hasNonVegMenuOnly === true) return false
  return true
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
