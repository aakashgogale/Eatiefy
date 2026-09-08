/**
 * Shared veg-mode helpers for the Food user module.
 * Only Veg, Non-Veg and Mixed (Veg + Non-Veg) are supported.
 */

export const VEGAN_OPTION_ENABLED = false

export const normalizeVegModeOption = (value) => {
  if (value === "pure-vegan") return "pure-veg"
  if (value === "pure-veg" || value === "non-veg") return value
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
    item.foodType === "Veg" ||
    item.pureVegRestaurant === true ||
    item.isPureVeg === true ||
    item.restaurant?.foodType === "Veg" ||
    item.restaurant?.pureVegRestaurant === true ||
    item.restaurant?.isPureVeg === true ||
    context?.foodType === "Veg" ||
    context?.pureVegRestaurant === true ||
    context?.isPureVeg === true

  if (isPureVegRestaurant) {
    return true
  }

  return false
}

/** Legacy fail-safe: maps any remaining legacy check to false or safe veg status */
export const isVeganMenuItem = (item) => {
  return false
}

export const getCanonicalFoodType = (item, context = {}) => {
  if (isVegMenuItem(item, context)) return "Veg"
  return "Non-Veg"
}

export const getRestaurantFoodType = (restaurant = {}) => {
  if (!restaurant || typeof restaurant !== "object") return "Mixed"
  const raw = String(restaurant.foodType || "").trim().toLowerCase()
  if (raw === "veg" || raw === "pure-veg" || raw === "pure veg" || restaurant.pureVegRestaurant === true || restaurant.isPureVeg === true) {
    return "Veg"
  }
  if (raw === "non-veg" || raw === "non veg" || restaurant.hasNonVegMenuOnly === true) {
    return "Non-Veg"
  }
  return "Mixed"
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
  if (option === "non-veg") {
    return (Array.isArray(dishes) ? dishes : []).filter((d) => !isVegMenuItem(d))
  }
  return (Array.isArray(dishes) ? dishes : []).filter(isVegMenuItem)
}

/**
 * Restaurant visibility for vegMode + vegModeOption.
 * - vegMode OFF → all restaurants
 * - option "all" → all restaurants
 * - option "pure-veg" → Veg restaurants and mixed restaurants serving veg dishes
 * - option "non-veg" → Non-Veg and mixed restaurants serving non-veg dishes
 */
export const matchesVegRestaurantFilter = (
  restaurant,
  { vegMode = false, vegModeOption = "all" } = {},
) => {
  if (!vegMode) return true
  if (!restaurant || typeof restaurant !== "object") return false
  const option = normalizeVegModeOption(vegModeOption)
  const ft = getRestaurantFoodType(restaurant)

  if (option === "pure-veg") {
    if (ft === "Non-Veg" || restaurant?.hasNonVegMenuOnly === true) return false
    if (ft === "Veg") return true
    return restaurant?.pureVegRestaurant === true || restaurant?.isPureVeg === true
  }

  if (option === "non-veg") {
    if (ft === "Veg" || restaurant?.pureVegRestaurant === true || restaurant?.isPureVeg === true) return false
    return true
  }

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
