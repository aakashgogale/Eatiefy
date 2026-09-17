const toAmount = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
};

/**
 * Splits a rider payout into the zone payout and the Eatiefy incentive.
 * Works with socket offer payloads (eatiefyIncentiveAmount) and full order
 * documents (eatiefyIncentive.amount). Returns null when no incentive applies,
 * so callers render exactly as before.
 */
export function getEatiefyIncentiveBreakdown(order, totalEarning) {
  if (!order) return null;
  const incentive = toAmount(order.eatiefyIncentiveAmount ?? order.eatiefyIncentive?.amount);
  if (incentive <= 0) return null;

  const percent = toAmount(order.eatiefyIncentivePercent ?? order.eatiefyIncentive?.percent);
  const total = toAmount(totalEarning ?? order.earnings ?? order.riderEarning ?? order.deliveryEarning);
  const explicitBase = order.riderBaseEarning ?? order.baseEarningAmount;
  const base =
    explicitBase != null ? toAmount(explicitBase) : Math.max(0, Math.round((total - incentive) * 100) / 100);

  return { base, incentive, percent };
}

export function formatEatiefyIncentiveLine(breakdown) {
  if (!breakdown) return '';
  const percentLabel = breakdown.percent > 0 ? ` (${breakdown.percent}% of order)` : '';
  return `₹${breakdown.base.toFixed(2)} + ₹${breakdown.incentive.toFixed(2)} Eatiefy${percentLabel}`;
}
