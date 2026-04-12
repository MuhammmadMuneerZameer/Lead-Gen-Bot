import mongoose, { Document, Schema } from 'mongoose';

export interface ILead extends Document {
  businessName: string;
  domain: string;
  website: string;
  industry: string;
  industryTier: 1 | 2 | 3;
  location: { city: string; country: string };
  source: 'gmaps' | 'linkedin' | 'instagram' | 'manual';
  sourceId?: string;
  fingerprint: string;
  score: number;
  scoreBreakdown: Record<string, number>;
  scoringConfigVersion: number;
  confidenceScore: number;
  leadType: 'website' | 'automation' | 'software' | 'hybrid';
  priority: 'hot' | 'warm' | 'cold';
  status: 'new' | 'enriched' | 'reviewed' | 'contacted' | 'won' | 'lost' | 'archived';
  tags: string[];
  createdAt: Date;
  enrichedAt?: Date;
  lastSeenAt?: Date;
}

const LeadSchema = new Schema<ILead>(
  {
    businessName: { type: String, required: true, trim: true },
    domain: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    website: { type: String, trim: true },
    industry: { type: String, trim: true },
    industryTier: { type: Number, enum: [1, 2, 3], default: 2 },
    location: {
      city: { type: String, trim: true },
      country: { type: String, trim: true, maxlength: 2 },
    },
    source: {
      type: String,
      enum: ['gmaps', 'linkedin', 'instagram', 'manual'],
      required: true,
    },
    sourceId: { type: String },
    fingerprint: { type: String, required: true, unique: true, index: true },
    score: { type: Number, default: 0, min: 0, max: 100 },
    scoreBreakdown: { type: Schema.Types.Mixed, default: {} },
    scoringConfigVersion: { type: Number, default: 1 },
    confidenceScore: { type: Number, default: 0, min: 0, max: 1 },
    leadType: {
      type: String,
      enum: ['website', 'automation', 'software', 'hybrid'],
      default: 'website',
    },
    priority: {
      type: String,
      enum: ['hot', 'warm', 'cold'],
      default: 'cold',
    },
    status: {
      type: String,
      enum: ['new', 'enriched', 'reviewed', 'contacted', 'won', 'lost', 'archived'],
      default: 'new',
    },
    tags: [{ type: String }],
    enrichedAt: { type: Date },
    lastSeenAt: { type: Date },
  },
  { timestamps: true },
);

// Compound index for efficient list queries
LeadSchema.index({ score: -1, status: 1, industry: 1, createdAt: -1 });
LeadSchema.index({ priority: 1, status: 1 });
LeadSchema.index({ source: 1, createdAt: -1 });

export const Lead = mongoose.model<ILead>('Lead', LeadSchema);
