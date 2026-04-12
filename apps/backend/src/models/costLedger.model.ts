import mongoose, { Document, Schema, Types } from 'mongoose';

export type AIModel = 'claude-sonnet-4-20250514' | 'claude-haiku-4-5-20251001';
export type AICallPurpose = 'lead_analysis' | 'outreach_gen' | 'batch_analysis' | 'prompt_optimization';

export interface ICostLedger extends Document {
  aiModel: AIModel;
  leadId?: Types.ObjectId;
  purpose: AICallPurpose;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  cacheHit: boolean;
  timestamp: Date;
}

// Pricing per token (as of 2025)
export const MODEL_PRICING: Record<AIModel, { in: number; out: number }> = {
  'claude-sonnet-4-20250514': { in: 0.000003, out: 0.000015 },
  'claude-haiku-4-5-20251001': { in: 0.00000025, out: 0.00000125 },
};

export function calculateCost(
  model: AIModel,
  inputTokens: number,
  outputTokens: number,
  cacheHit: boolean,
): number {
  if (cacheHit) return 0;
  const pricing = MODEL_PRICING[model];
  return inputTokens * pricing.in + outputTokens * pricing.out;
}

const CostLedgerSchema = new Schema<ICostLedger>(
  {
    aiModel: {
      type: String,
      enum: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001'],
      required: true,
    },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead' }, // nullable for batch calls
    purpose: {
      type: String,
      enum: ['lead_analysis', 'outreach_gen', 'batch_analysis', 'prompt_optimization'],
      required: true,
    },
    inputTokens: { type: Number, required: true },
    outputTokens: { type: Number, required: true },
    costUSD: { type: Number, required: true }, // calculated: tokens * model rate
    cacheHit: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false },
);

// Index for daily aggregation queries
CostLedgerSchema.index({ timestamp: -1 });
CostLedgerSchema.index({ aiModel: 1, timestamp: -1 });

export const CostLedger = mongoose.model<ICostLedger>('CostLedger', CostLedgerSchema);
