import mongoose from 'mongoose';
import { actionPerformerSchema } from '../../../../core/models/actionPerformer.schema.js';

/**
 * Centralized Other Price rules.
 * Scope priority at apply-time: MENU_ITEM > RESTAURANT > GLOBAL.
 * Stored FoodItem.price is never mutated by these rules.
 */
const foodPricingRuleSchema = new mongoose.Schema(
  {
    zoneId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FoodZone',
      default: null,
      index: true,
    },
    scope: {
      type: String,
      enum: ['GLOBAL', 'RESTAURANT', 'MENU_ITEM'],
      required: true,
      index: true,
    },
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FoodRestaurant',
      default: null,
      index: true,
    },
    menuItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FoodItem',
      default: null,
      index: true,
    },
    type: {
      type: String,
      enum: ['PERCENTAGE', 'FIXED'],
      required: true,
    },
    value: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
      index: true,
    },
    priority: {
      type: Number,
      default: 0,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    createdBy: { type: actionPerformerSchema, default: null },
    updatedBy: { type: actionPerformerSchema, default: null },
  },
  {
    collection: 'food_pricing_rules',
    timestamps: true,
  },
);

foodPricingRuleSchema.index(
  { scope: 1, restaurantId: 1, menuItemId: 1, isDeleted: 1, status: 1 },
  { name: 'pricing_scope_lookup' },
);

foodPricingRuleSchema.index(
  { scope: 1, zoneId: 1 },
  {
    unique: true,
    name: 'uniq_active_global_pricing_per_zone',
    partialFilterExpression: {
      scope: 'GLOBAL',
      isDeleted: false,
      status: 'active',
    },
  },
);

foodPricingRuleSchema.index(
  { restaurantId: 1 },
  {
    unique: true,
    name: 'uniq_active_restaurant_pricing',
    partialFilterExpression: {
      scope: 'RESTAURANT',
      isDeleted: false,
      status: 'active',
    },
  },
);

foodPricingRuleSchema.index(
  { menuItemId: 1 },
  {
    unique: true,
    name: 'uniq_active_menu_item_pricing',
    partialFilterExpression: {
      scope: 'MENU_ITEM',
      isDeleted: false,
      status: 'active',
    },
  },
);

export const FoodPricingRule = mongoose.model(
  'FoodPricingRule',
  foodPricingRuleSchema,
  'food_pricing_rules',
);

const foodPricingRuleAuditSchema = new mongoose.Schema(
  {
    ruleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FoodPricingRule',
      required: true,
      index: true,
    },
    action: {
      type: String,
      enum: ['CREATE', 'UPDATE', 'DELETE', 'ACTIVATE', 'DEACTIVATE'],
      required: true,
    },
    scope: { type: String, enum: ['GLOBAL', 'RESTAURANT', 'MENU_ITEM'] },
    zoneId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodZone', default: null },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodRestaurant', default: null },
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodItem', default: null },
    oldValue: { type: mongoose.Schema.Types.Mixed, default: null },
    newValue: { type: mongoose.Schema.Types.Mixed, default: null },
    performedBy: { type: actionPerformerSchema, default: null },
  },
  {
    collection: 'food_pricing_rule_audits',
    timestamps: { createdAt: true, updatedAt: false },
  },
);

foodPricingRuleAuditSchema.index({ createdAt: -1 });
foodPricingRuleAuditSchema.index({ restaurantId: 1, createdAt: -1 });

export const FoodPricingRuleAudit = mongoose.model(
  'FoodPricingRuleAudit',
  foodPricingRuleAuditSchema,
  'food_pricing_rule_audits',
);
