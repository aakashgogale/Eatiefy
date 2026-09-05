/**
 * Detects likely non-vegan ingredients from dish name/description.
 * Fail-closed guard when foodType is set to Vegan.
 */

const NON_VEGAN_PATTERNS = [
  /\bbutter\s*milk\b/i,
  /\bbutter\b/i,
  /\bmilk\b/i,
  /\bcream\b/i,
  /\bcheese\b/i,
  /\bpaneer\b/i,
  /\bghee\b/i,
  /\bcurd\b/i,
  /\byogurt\b/i,
  /\byoghurt\b/i,
  /\bdahi\b/i,
  /\bdoodh\b/i,
  /\bmakkhan\b/i,
  /\bmalai\b/i,
  /\bkhoa\b/i,
  /\bkhoya\b/i,
  /\bmawa\b/i,
  /\brabri\b/i,
  /\blass[iī]\b/i,
  /\braita\b/i,
  /\bchenna\b/i,
  /\bchhena\b/i,
  /\bwhey\b/i,
  /\bcasein\b/i,
  /\bice[\s-]?cream\b/i,
  /\bcustard\b/i,
  /\bhoney\b/i,
  /\bshahad\b/i,
  /\begg\b/i,
  /\banda\b/i,
  /\bchicken\b/i,
  /\bmutton\b/i,
  /\bmeat\b/i,
  /\bfish\b/i,
  /\bprawn\b/i,
  /\bseafood\b/i,
  /\bkeema\b/i,
  /\bgelatin\b/i,
  /\blard\b/i,
];

export const findNonVeganKeyword = (text = '') => {
  const raw = String(text || '').trim();
  if (!raw) return { blocked: false, matched: null };

  for (const pattern of NON_VEGAN_PATTERNS) {
    const match = raw.match(pattern);
    if (match?.[0]) {
      return { blocked: true, matched: match[0] };
    }
  }
  return { blocked: false, matched: null };
};

export const getVeganFoodTypeBlockReason = (item = {}) => {
  const nameCheck = findNonVeganKeyword(item.name);
  if (nameCheck.blocked) {
    return { blocked: true, matched: nameCheck.matched, field: 'name' };
  }
  const descCheck = findNonVeganKeyword(item.description);
  if (descCheck.blocked) {
    return { blocked: true, matched: descCheck.matched, field: 'description' };
  }
  return { blocked: false, matched: null, field: null };
};

export const formatVeganBlockMessage = (reason) => {
  if (!reason?.blocked || !reason.matched) {
    return 'This item cannot be marked as Vegan because it appears to contain animal/dairy products';
  }
  return `Cannot mark as Vegan: "${reason.matched}" is not allowed in vegan dishes (dairy/animal products)`;
};
