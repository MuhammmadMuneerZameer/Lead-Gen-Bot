import mongoose, { Document, Schema } from 'mongoose';

export type PromptType = 'analysis' | 'outreach_email' | 'outreach_linkedin' | 'batch_analysis';
export type PromptStatus = 'active' | 'testing' | 'retired';

export interface IPromptTemplate extends Document {
  name: string;
  type: PromptType;
  version: number;
  template: string;
  targetIndustry?: string;
  targetService?: string;
  status: PromptStatus;
  timesUsed: number;
  replyRate: number;
  conversionRate: number;
  parentVersion?: number;
  generatedBy: 'system' | 'ai_optimizer';
  retiredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PromptTemplateSchema = new Schema<IPromptTemplate>(
  {
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['analysis', 'outreach_email', 'outreach_linkedin', 'batch_analysis'],
      required: true,
    },
    version: { type: Number, required: true, default: 1 },
    template: { type: String, required: true }, // prompt text with {placeholder} variables
    targetIndustry: { type: String }, // null = all industries
    targetService: { type: String }, // null = all services
    status: {
      type: String,
      enum: ['active', 'testing', 'retired'],
      default: 'active',
    },
    timesUsed: { type: Number, default: 0 },
    replyRate: { type: Number, default: 0, min: 0, max: 1 }, // 0.0-1.0 rolling average
    conversionRate: { type: Number, default: 0, min: 0, max: 1 },
    parentVersion: { type: Number }, // which version this was generated from
    generatedBy: { type: String, enum: ['system', 'ai_optimizer'], default: 'system' },
    retiredAt: { type: Date },
  },
  { timestamps: true },
);

PromptTemplateSchema.index({ name: 1, version: 1 }, { unique: true });
PromptTemplateSchema.index({ type: 1, status: 1 });
PromptTemplateSchema.index({ status: 1, replyRate: -1 });

export const PromptTemplate = mongoose.model<IPromptTemplate>('PromptTemplate', PromptTemplateSchema);
