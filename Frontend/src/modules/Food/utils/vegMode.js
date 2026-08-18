/**
 * Shared veg-mode helpers for the Food user module.
 * When vegMode is ON, non-veg categories/dishes must never surface in browse UI.
 */

export const isVegMenuItem = (item) => {
  if (!item || typeof item !== "object") return false

  const foodType = String(
    item.foodType || item.categoryDishFoodType || item.type || "",
  )
    .trim()
    .toLowerCase()

  if (foodType === "veg") return true
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

export const filterCategoriesForVegMode = (categories = [], vegMode = false) => {
  if (!vegMode) return Array.isArray(categories) ? categories : []
  return (Array.isArray(categories) ? categories : []).filter(
    (cat) => !isNonVegCategoryScope(cat),
  )
}

export const filterDishesForVegMode = (dishes = [], vegMode = false) => {
  if (!vegMode) return Array.isArray(dishes) ? dishes : []
  return (Array.isArray(dishes) ? dishes : []).filter(isVegMenuItem)
}

/**
 * Restaurant visibility for vegMode + vegModeOption.
 * - vegMode OFF → all restaurants
 * - option "all" → all restaurants (dishes filtered elsewhere)
 * - option "pure-veg" → only pure-veg restaurants (menu evidence wins)
 */
export const matchesVegRestaurantFilter = (
  restaurant,
  { vegMode = false, vegModeOption = "all" } = {},
) => {
  if (!vegMode) return true
  if (vegModeOption !== "pure-veg") return true

  if (restaurant?.hasNonVegMenu === true) return false
  if (restaurant?.isPureVeg === true) return true
  if (restaurant?.hasNonVegMenu === false) return true

  return (
    restaurant?.pureVegRestaurant === true ||
    restaurant?.diningSettings?.pureVegRestaurant === true
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
