import apiClient from "./axios.js"

/**
 * Restaurant-run menu offers (backend: /food/restaurant/item-offers).
 * Kept apart from restaurantAPI.getPublicOffers, which lists admin coupons.
 */
const BASE = "/food/restaurant/item-offers"
const restaurantOnly = { contextModule: "restaurant" }

export const restaurantItemOffersAPI = {
  /** Restaurant's own offers (all states). */
  list: (params = {}) => apiClient.get(BASE, { ...restaurantOnly, params }),
  /** Dishes and categories the offer form can target. */
  getOptions: () => apiClient.get(`${BASE}/options`, restaurantOnly),
  create: (body) => apiClient.post(BASE, body ?? {}, restaurantOnly),
  update: (id, body) => apiClient.put(`${BASE}/${encodeURIComponent(String(id))}`, body ?? {}, restaurantOnly),
  /** Sets isActive explicitly, so a repeated tap can never flip it back. */
  setActive: (id, isActive) =>
    apiClient.patch(`${BASE}/${encodeURIComponent(String(id))}/toggle`, { isActive: Boolean(isActive) }, restaurantOnly),
  remove: (id) => apiClient.delete(`${BASE}/${encodeURIComponent(String(id))}`, restaurantOnly),
  /** Public: offers a customer can get from this restaurant right now. */
  getLive: (restaurantId, config = {}) =>
    apiClient.get(`${BASE}/public/${encodeURIComponent(String(restaurantId))}`, config),
}

export default restaurantItemOffersAPI
