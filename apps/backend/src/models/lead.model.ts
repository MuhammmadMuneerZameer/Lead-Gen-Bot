import mongoose, { Document, Schema } from 'mongoose';

export interface ILead extends Document {
  businessName: string;
  domain: string;
  website: string;
  industry: string;
  industryTier: 1 | 2 | 3;
  location: { city: string; country: string };
  phone?: string;
  email?: string;
  socialLinks: string[];
  websiteQuality: 'outdated' | 'basic' | 'modern' | 'unknown';
  source: 'gmaps' | 'yellowpages' | 'yelp' | 'bing' | 'linkedin' | 'instagram' | 'manual' | 'duckduckgo';
  sourceId?: string;
  fingerprint: string;
  opportunityScore: number;
  scoreBreakdown: Record<string, number>;
  scoringConfigVersion: number;
  confidenceScore: number;
  opportunityLevel: 'high' | 'medium' | 'low';
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
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    socialLinks: [{ type: String }],
    websiteQuality: {
      type: String,
      enum: ['outdated', 'basic', 'modern', 'unknown'],
      default: 'unknown',
    },
    source: {
      type: String,
      enum: ['gmaps', 'yellowpages', 'yelp', 'bing', 'linkedin', 'instagram', 'manual', 'duckduckgo'],
      required: true,
    },
    sourceId: { type: String },
    fingerprint: { type: String, required: true, unique: true, index: true },
    opportunityScore: { type: Number, default: 0, min: 0, max: 100 },
    scoreBreakdown: { type: Schema.Types.Mixed, default: {} },
    scoringConfigVersion: { type: Number, default: 1 },
    confidenceScore: { type: Number, default: 0, min: 0, max: 1 },
    opportunityLevel: {
      type: String,
      enum: ['high', 'medium', 'low'],
      default: 'low',
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
LeadSchema.index({ opportunityScore: -1, status: 1, industry: 1, createdAt: -1 });
LeadSchema.index({ opportunityLevel: 1, status: 1 });
LeadSchema.index({ source: 1, createdAt: -1 });

export const Lead = mongoose.model<ILead>('Lead', LeadSchema);
